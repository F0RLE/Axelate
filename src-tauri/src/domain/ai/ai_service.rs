//! AI Service implementation for handling LLM provider communication via OpenRouter.
//!
//! This module provides the backend logic for interacting with AI models
//! primarily through the OpenRouter API (which normalizes OpenAI, Gemini, Claude, etc.).

use crate::models::config::ApiProvider;
use async_trait::async_trait;
use dashmap::DashMap;
use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::sync::{
    Arc, LazyLock, Once,
    atomic::{AtomicBool, Ordering},
};
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::time::timeout;

// ==================================================================================
// DTOs (Data Transfer Objects)
// ==================================================================================

/// AI chat message with role and content
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ChatMessage {
    /// Unique message identifier (UUID v4)
    #[serde(default = "generate_uuid")]
    pub id: String,
    /// Role ("user", "assistant", "system")
    pub role: String,
    /// Message content (text or structured data)
    pub content: serde_json::Value,
    /// Optional signature for extended thinking
    pub thought_signature: Option<String>,
}

fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Token usage statistics
#[derive(Debug, Serialize, Deserialize, Clone, Type, Default)]
pub struct TokenUsage {
    /// Tokens in the prompt
    pub prompt_tokens: u32,
    /// Tokens in the completion
    pub completion_tokens: u32,
    /// Total tokens used
    pub total_tokens: u32,
}

/// AI chat request parameters
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ChatRequest {
    /// AI provider ("openai", "gemini", "local") - largely ignored now as we route via OpenRouter
    pub provider: String,
    /// Model identifier
    pub model: String,
    /// Chat history and new message
    pub messages: Vec<ChatMessage>,
    /// Optional API key
    pub api_key: Option<String>,
    /// Thinking level ("low", "high", "minimal")
    pub thinking_level: Option<String>,
    /// Session identifier for history tracking
    pub session_id: Option<String>,
}

/// AI chat response
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ChatResponse {
    /// Corresponding request identifier
    #[serde(default = "generate_uuid")]
    pub id: String,
    /// Whether request was successful
    pub ok: bool,
    /// AI reply content
    pub reply: Option<ChatReply>,
    /// Error message if failed
    pub error: Option<String>,
    /// Model used
    pub model: Option<String>,
    /// Thinking signature
    pub thought_signature: Option<String>,
    /// Token usage metrics
    pub usage: Option<TokenUsage>,
}

/// AI reply content
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ChatReply {
    /// Reply text
    pub text: String,
    /// Role (typically "assistant")
    pub role: String,
}

/// Chat session with message history
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ChatSession {
    /// Message history
    pub history: Vec<ChatMessage>,
    /// Last modification time (Unix timestamp)
    pub last_updated: f64,
}

// ==================================================================================
// Session Management (Scalable / DashMap)
// ==================================================================================

/// Manages persistence and retrieval of chat sessions
#[derive(Debug)]
pub struct ChatSessionManager;

/// Global storage for active sessions (DashMap for concurrency)
static SESSIONS: LazyLock<DashMap<String, ChatSession>> =
    LazyLock::new(|| ChatSessionManager::load_from_disk().unwrap_or_default());

/// Dirty flag for IO debounce
static DIRTY: AtomicBool = AtomicBool::new(false);
/// Ensure background saver is only spawned once
static SAVER_INIT: Once = Once::new();

impl ChatSessionManager {
    /// Loads session history from disk
    fn load_from_disk() -> Result<DashMap<String, ChatSession>, crate::errors::AppError> {
        let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
        let tmp_path = path.with_extension("tmp");

        // Atomic Crash Recovery (Senior Refinement #7)
        // If tmp exists but real is missing, it means we crashed between remove and rename
        if tmp_path.exists() && !path.exists() {
            log::warn!(
                "Detected crash/interruption during last save. Recovering history from .tmp..."
            );
            if let Err(e) = std::fs::rename(&tmp_path, path) {
                log::error!("Crash recovery failed: {e}");
            }
        }

        if !path.exists() {
            return Ok(DashMap::new());
        }

        let content = std::fs::read_to_string(path)?;
        let temp_map: HashMap<String, ChatSession> =
            serde_json::from_str(&content).map_err(|e| crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Failed to parse chat history: {e}"),
            })?;

        let dash_map = DashMap::new();
        for (k, mut session) in temp_map {
            // Migration Logic: Ensure every historical message has a UUID (Senior Refinement #5)
            for msg in &mut session.history {
                if msg.id.is_empty() || msg.id == "00000000-0000-0000-0000-000000000000" {
                    msg.id = uuid::Uuid::new_v4().to_string();
                }
            }
            dash_map.insert(k, session);
        }

        Ok(dash_map)
    }

    /// Saves current sessions to disk (Atomic Write)
    pub fn save_to_disk() -> Result<(), crate::errors::AppError> {
        let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
        let tmp_path = path.with_extension("tmp");

        let snapshot: HashMap<String, ChatSession> = SESSIONS
            .iter()
            .map(|entry| (entry.key().clone(), entry.value().clone()))
            .collect();

        let content = serde_json::to_string_pretty(&snapshot).map_err(|e| {
            crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Failed to serialize chat history: {e}"),
            }
        })?;

        // 1. Write to temporary file
        let mut file = std::fs::File::create(&tmp_path)?;
        use std::io::Write;
        file.write_all(content.as_bytes())?;

        // 1.1 Persist buffers to physical disk (Senior Refinement #4)
        file.sync_all()?;
        // Close file handle before rename
        drop(file);

        // 2. Atomic Rename (Windows-safe: remove then rename if rename errors)
        if let Err(e) = std::fs::rename(&tmp_path, path) {
            log::warn!("Standard rename failed ({e}), attempting fallback for Windows locks...");
            let _ = std::fs::remove_file(path);
            std::fs::rename(&tmp_path, path)?;
        }

        Ok(())
    }

    /// Ensures the background saver task is running
    fn ensure_saver_running() {
        SAVER_INIT.call_once(|| {
            tokio::spawn(async move {
                log::info!("Starting background chat session saver...");
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    if DIRTY.load(Ordering::Relaxed) {
                        if let Err(e) = Self::save_to_disk() {
                            log::error!("Failed to save chat history: {e}");
                        } else {
                            // Only clear dirty if save succeeded
                            DIRTY.store(false, Ordering::Relaxed);
                            log::debug!("Chat history saved to disk (debounced)");
                        }
                    }
                }
            });
        });
    }

    /// Manually triggers a save to disk, bypassing the debounce timer
    pub fn force_save() -> Result<(), crate::errors::AppError> {
        Self::save_to_disk()?;
        DIRTY.store(false, Ordering::Relaxed);
        Ok(())
    }

    /// Retrieves or creates a session, updating it with new user messages
    fn get_or_create_session(session_id: &str, new_messages: &[ChatMessage]) -> Vec<ChatMessage> {
        // Ensure saver is running on first write-access
        Self::ensure_saver_running();

        let mut entry = SESSIONS
            .entry(session_id.to_string())
            .or_insert_with(|| ChatSession {
                history: Vec::new(),
                last_updated: Self::current_timestamp(),
            });

        entry.history.extend(new_messages.iter().cloned());
        entry.last_updated = Self::current_timestamp();

        // Mark dirty
        DIRTY.store(true, Ordering::Relaxed);

        entry.history.clone()
    }

    /// Appends an assistant response to the session
    fn append_response(
        session_id: &str,
        message_id: String,
        reply: &ChatReply,
        signature: Option<String>,
    ) {
        Self::ensure_saver_running();

        if let Some(mut session) = SESSIONS.get_mut(session_id) {
            session.history.push(ChatMessage {
                id: message_id,
                role: reply.role.clone(),
                content: serde_json::Value::String(reply.text.clone()),
                thought_signature: signature,
            });
            session.last_updated = Self::current_timestamp();

            // Mark dirty
            DIRTY.store(true, Ordering::Relaxed);
        }
    }

    fn current_timestamp() -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
    }
}

/// Retrieves chat history for a session
pub fn get_chat_history(session_id: &str) -> Vec<ChatMessage> {
    if let Some(session) = SESSIONS.get(session_id) {
        return session.history.clone();
    }
    Vec::new()
}

/// Clears history for a session
pub fn clear_chat_history(session_id: &str) {
    if SESSIONS.remove(session_id).is_some() {
        // Force immediate save or mark dirty?
        // Marking dirty is safer for debounce consistency
        ChatSessionManager::ensure_saver_running();
        DIRTY.store(true, Ordering::Relaxed);
    }
}

/// Force immediate save of all chat history to disk (for shutdown or completion)
pub fn force_save_history() -> Result<(), crate::errors::AppError> {
    ChatSessionManager::force_save()
}

// ==================================================================================
// Traits & Abstractions
// ==================================================================================

/// Typed events for AI streaming (Platform-level Protocol)
#[derive(Debug)]
pub enum StreamEvent {
    /// A single text chunk for the chat conversation
    ChatChunk {
        /// ID of the message this chunk belongs to
        message_id: String,
        /// The text content
        content: String,
    },
    /// A single thinking/reasoning chunk
    ThoughtChunk {
        /// ID of the message this chunk belongs to
        message_id: String,
        /// The reasoning content
        content: String,
    },
    /// Stream termination event with final metadata
    Done {
        /// ID of the resulting message
        message_id: String,
        /// Final token usage (if provided by model)
        usage: Option<TokenUsage>,
    },
}

/// Abstraction for streaming AI output (Decouples UI from Infrastructure)
pub trait StreamSink: Send + Sync {
    /// Emit a stream event to the sink
    fn emit(&self, event: StreamEvent);
}

/// Tauri-specific implementation of StreamSink using a bounded channel
#[derive(Debug)]
pub struct WindowSink {
    tx: mpsc::Sender<StreamEvent>,
}

impl WindowSink {
    /// Creates a new WindowSink with the provided channel sender
    pub fn new(tx: mpsc::Sender<StreamEvent>) -> Self {
        Self { tx }
    }
}

impl StreamSink for WindowSink {
    fn emit(&self, event: StreamEvent) {
        // Use try_send to avoid blocking the provider if the UI consumer is slow.
        // In a Production scenario, we might coalesce chunks or drop oldest if full.
        if let Err(e) = self.tx.try_send(event) {
            log::warn!("[Sink] Failed to send event (channel full or closed): {e}");
        }
    }
}

/// Core interface for AI providers
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Generates a stream of responses for the given request
    async fn generate_stream(
        &self,
        request_id: String,
        message_id: String,
        req: ChatRequest,
        sink: Arc<dyn StreamSink>,
    ) -> Result<ChatResponse, crate::errors::AppError>;
}

// ==================================================================================
// AI Providers (OpenRouter Unified)
// ==================================================================================

/// OpenAI-Compatible Provider Implementation (OpenRouter)
#[derive(Debug)]
pub struct OpenAIProvider {
    base_url: String,
}

impl OpenAIProvider {
    /// Creates a new OpenAIProvider with the specified base URL
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
        }
    }
}

#[async_trait]
impl AiProvider for OpenAIProvider {
    async fn generate_stream(
        &self,
        request_id: String,
        message_id: String,
        req: ChatRequest,
        sink: Arc<dyn StreamSink>,
    ) -> Result<ChatResponse, crate::errors::AppError> {
        let api_key = req
            .api_key
            .clone()
            .ok_or_else(|| crate::errors::AppError::Config("No API key provided".to_string()))?;

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| crate::errors::AppError::External {
                request_id: Some(request_id.clone()),
                message: e.to_string(),
            })?;

        let mut payload = serde_json::Map::new();
        payload.insert(
            "model".to_string(),
            serde_json::Value::String(req.model.clone()),
        );
        payload.insert("messages".to_string(), serde_json::json!(req.messages));
        payload.insert("stream".to_string(), serde_json::Value::Bool(true));

        // Capability Based Routing
        // Note: Real implementation would check `model.capabilities` here
        // For now, we use the request's level but could refine based on provider-specific logic
        if let Some(level) = &req.thinking_level {
            payload.insert(
                "reasoning_effort".to_string(),
                serde_json::Value::String(level.clone()),
            );
        }

        payload.insert("max_tokens".to_string(), serde_json::json!(8192));

        let endpoint = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        let mut attempts = 0;
        const MAX_RETRIES: u32 = 3;

        let res: reqwest::Response = loop {
            attempts += 1;
            match client
                .post(&endpoint)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .header("HTTP-Referer", "https://github.com/F0RLE/Axelate")
                .header("X-Title", "Axelate")
                .header("X-Request-Id", &request_id) // Propagation for tracing
                .json(&payload)
                .send()
                .await
            {
                Ok(resp) => {
                    if resp.status().is_success() {
                        break resp; // Corrected break value for type inference
                    }
                    let status = resp.status();
                    if (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
                        && attempts <= MAX_RETRIES
                    {
                        let wait_secs = 2u64.pow(attempts);
                        tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
                        continue;
                    }
                    break resp; // Corrected break value
                }
                Err(e) => {
                    if attempts <= MAX_RETRIES {
                        let wait_secs = 2u64.pow(attempts);
                        tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
                        continue;
                    }
                    return Err(crate::errors::AppError::External {
                        request_id: Some(request_id),
                        message: format!("Request failed: {e}"),
                    });
                }
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_default();
            return Ok(ChatResponse {
                id: message_id,
                ok: false,
                reply: None,
                error: Some(format!("API Error {status}: {error_text}")),
                model: Some(req.model),
                thought_signature: None,
                usage: None,
            });
        }

        let mut stream = res.bytes_stream();
        let mut full_content = String::new();
        let mut buffer = String::new();
        let mut final_usage: Option<TokenUsage> = None;

        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| crate::errors::AppError::External {
                request_id: Some(request_id.clone()),
                message: e.to_string(),
            })?;
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if line.starts_with("data: ") {
                    let data = line.trim_start_matches("data: ");
                    if data == "[DONE]" {
                        break;
                    }

                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        // Extract usage if present in chunk
                        if let Some(usage_val) = json.get("usage") {
                            if let Ok(usage) =
                                serde_json::from_value::<TokenUsage>(usage_val.clone())
                            {
                                final_usage = Some(usage);
                            }
                        }

                        if let Some(choices) = json.get("choices").and_then(|c| c.as_array())
                            && let Some(choice) = choices.first()
                        {
                            let delta = choice.get("delta");
                            // Reasoning extraction
                            if let Some(reasoning) = delta
                                .and_then(|d| d.get("reasoning_content"))
                                .and_then(|v| v.as_str())
                                .or_else(|| {
                                    delta
                                        .and_then(|d| d.get("reasoning"))
                                        .and_then(|v| v.as_str())
                                })
                            {
                                sink.emit(StreamEvent::ThoughtChunk {
                                    message_id: message_id.clone(),
                                    content: reasoning.to_string(),
                                });
                            }

                            // Content extraction
                            if let Some(content) = delta
                                .and_then(|d| d.get("content"))
                                .and_then(|v| v.as_str())
                            {
                                full_content.push_str(content);
                                sink.emit(StreamEvent::ChatChunk {
                                    message_id: message_id.clone(),
                                    content: content.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // Final event
        sink.emit(StreamEvent::Done {
            message_id: message_id.clone(),
            usage: final_usage.clone(),
        });

        Ok(ChatResponse {
            id: message_id,
            ok: true,
            reply: Some(ChatReply {
                text: full_content,
                role: "assistant".to_string(),
            }),
            error: None,
            model: Some(req.model),
            thought_signature: None,
            usage: final_usage,
        })
    }
}

// ==================================================================================
// Service Orchestrator
// ==================================================================================

/// Dispatches a chat request to the OpenRouter provider.
pub async fn process_chat_request(
    window: tauri::Window,
    request: ChatRequest,
) -> Result<ChatResponse, crate::errors::AppError> {
    // 1. Session Management
    // For saving, we use the messages passed in explicitly + get_or_create logic
    let mut messages_context = request.messages.clone();
    if let Some(sid) = &request.session_id {
        // This implicitly starts the saver task if not running
        messages_context = ChatSessionManager::get_or_create_session(sid, &request.messages);
    }

    // 2. Resolve Provider Configuration (URL, Models, etc)
    // Default to OpenRouter
    let mut base_url = "https://openrouter.ai/api/v1".to_string();
    let mut effective_model = request.model.clone();

    // Config lookup
    let providers_path = crate::utils::paths::RESOURCES_DIR.join("api_providers.json");
    if providers_path.exists()
        && let Ok(content) = std::fs::read_to_string(&providers_path)
        && let Ok(providers) = serde_json::from_str::<Vec<ApiProvider>>(&content)
        && let Some(p) = providers.iter().find(|p| p.id == request.provider)
    {
        if let Some(url) = &p.base_url {
            base_url = url.clone();
        }

        // Resolve aliases
        if let Some(target) = p.model_aliases.as_ref().and_then(|m| m.get(&request.model)) {
            log::info!("Resolved model alias: {} -> {}", request.model, target);
            effective_model = target.clone();
        }

        // Resolve proper model ID
        if let Some(models) = &p.models
            && let Some(def) = models.get(&effective_model)
            && let Some(tm) = def.api_models.as_ref().and_then(|m| m.text.as_ref())
        {
            log::info!("Resolved API model ID: {effective_model} -> {tm}");
            effective_model = tm.clone();
        } else {
            // Check custom models
            let custom_path = crate::utils::paths::CONFIG_DIR.join("custom_models.json");
            if custom_path.exists()
                && let Ok(c) = std::fs::read_to_string(&custom_path)
                && let Ok(cc) =
                    serde_json::from_str::<crate::models::custom_models::CustomModelConfig>(&c)
                && let Some(custom) = cc
                    .models
                    .iter()
                    .find(|m| m.id == effective_model && m.provider_id == request.provider)
            {
                log::info!(
                    "Resolved Custom Model: {} -> {}",
                    effective_model,
                    custom.base_model_id
                );
                effective_model = custom.base_model_id.clone();
            }
        }
    }

    // Update request with resolved context
    let effective_request = ChatRequest {
        messages: messages_context,
        model: effective_model,
        ..request.clone()
    };

    // 3. Dispatch to Provider (Unified Trait Entry-point)
    let request_id = uuid::Uuid::new_v4().to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    log::info!(
        "[AI] Starting request {} (msg {}) for model {}",
        request_id,
        message_id,
        effective_request.model
    );

    // 3.1 Setup Bounded Infrastructure (mpsc)
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
    let sink = Arc::new(WindowSink::new(tx));
    let provider = OpenAIProvider::new(&base_url);

    // 3.2 Spawn Sink Processor (UI Bridge)
    let window_for_task = window.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::ChatChunk { content, .. } => {
                    let _ = window_for_task.emit("ai:chat:chunk", content);
                }
                StreamEvent::ThoughtChunk { content, .. } => {
                    let _ = window_for_task.emit("ai:thought:chunk", content);
                }
                StreamEvent::Done { .. } => {
                    // UI can use this to clear "generating" state
                    let _ = window_for_task.emit("ai:chat:done", ());
                }
            }
        }
    });

    // 3.3 Execute with Service-Level Timeout
    let response_res = timeout(
        std::time::Duration::from_secs(90), // 90s global timeout
        provider.generate_stream(
            request_id.clone(),
            message_id.clone(),
            effective_request,
            sink.clone(),
        ),
    )
    .await;

    let response = match response_res {
        Ok(res) => res,
        Err(_) => {
            // Emit Done on timeout to prevent UI hang (Senior Refinement #1)
            sink.emit(StreamEvent::Done {
                message_id: message_id.clone(),
                usage: None,
            });
            Err(crate::errors::AppError::Internal {
                request_id: Some(request_id),
                message: "AI Request timed out after 90 seconds.".to_string(),
            })
        }
    };

    // 4. Save Response to History
    if let Ok(res) = &response
        && res.ok
        && let Some(reply) = &res.reply
        && let Some(sid) = &request.session_id
    {
        ChatSessionManager::append_response(sid, message_id, reply, res.thought_signature.clone());
        // Immediate flush after stream completion (Senior Refinement #3)
        let _ = ChatSessionManager::force_save();
    }

    response
}

// ==================================================================================
// Helpers
// ==================================================================================

/// Validates an API key against OpenRouter (or generic OpenAI endpoint).
pub async fn validate_api_key(
    provider: String,
    key: String,
) -> Result<bool, crate::errors::AppError> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    // OpenRouter / OpenAI Standard validation
    // Try listing models, which is a cheap and standard way to check Auth
    let url = if provider == "gemini" && !key.starts_with("sk-or-") {
        // Fallback for legacy raw Gemini keys if user still tries to use them (though UI suggests OpenRouter)
        format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}")
    } else {
        "https://openrouter.ai/api/v1/models".to_string()
    };

    let mut req = client.get(&url);

    if !url.contains("key=") {
        req = req.header("Authorization", format!("Bearer {key}"));
    }

    let res = req
        .send()
        .await
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    Ok(res.status().is_success())
}

/// Counts tokens in text using tiktoken
pub fn count_tokens(text: &str, model: Option<&str>) -> Result<usize, String> {
    use tiktoken_rs::{cl100k_base, get_bpe_from_model};

    let bpe = if let Some(m) = model {
        get_bpe_from_model(m)
            .or_else(|_| cl100k_base())
            .map_err(|e| format!("Failed to load tokenizer: {e}"))?
    } else {
        cl100k_base().map_err(|e| format!("Failed to load cl100k_base tokenizer: {e}"))?
    };

    Ok(bpe.encode_with_special_tokens(text).len())
}
