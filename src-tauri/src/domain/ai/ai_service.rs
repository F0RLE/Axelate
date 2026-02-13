//! AI Service implementation for handling LLM provider communication.
//!
//! This module provides the backend logic for interacting with various AI API providers
//! (OpenAI, Gemini, etc.) and managing their lifecycle within the Axelate.

use crate::models::config::ApiProvider;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;

// ==================================================================================
// DTOs (Data Transfer Objects)
// ==================================================================================

/// AI chat message with role and content
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ChatMessage {
    /// Role ("user", "assistant", "system")
    pub role: String,
    /// Message content (text or structured data)
    pub content: serde_json::Value,
    /// Optional signature for extended thinking
    pub thought_signature: Option<String>,
}

/// AI chat request parameters
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ChatRequest {
    /// AI provider ("openai", "gemini", "local")
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
// Session Management
// ==================================================================================

/// Manages persistence and retrieval of chat sessions
struct ChatSessionManager;

/// Global storage for active sessions
static SESSIONS: LazyLock<Mutex<HashMap<String, ChatSession>>> =
    LazyLock::new(|| Mutex::new(ChatSessionManager::load_from_disk().unwrap_or_default()));

impl ChatSessionManager {
    /// Loads session history from disk
    fn load_from_disk() -> Result<HashMap<String, ChatSession>, crate::errors::AppError> {
        let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
        if !path.exists() {
            return Ok(HashMap::new());
        }

        let content = std::fs::read_to_string(path)?;
        let sessions: HashMap<String, ChatSession> =
            serde_json::from_str(&content).map_err(|e| {
                crate::errors::AppError::Internal(format!("Failed to parse chat history: {e}"))
            })?;

        Ok(sessions)
    }

    /// Saves current sessions to disk
    fn save_to_disk() -> Result<(), crate::errors::AppError> {
        if let Ok(sessions) = SESSIONS.lock() {
            let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
            let content = serde_json::to_string_pretty(&*sessions).map_err(|e| {
                crate::errors::AppError::Internal(format!("Failed to serialize chat history: {e}"))
            })?;
            std::fs::write(path, content)?;
        }
        Ok(())
    }

    /// Retrieves or creates a session, updating it with new user messages
    fn get_or_create_session(session_id: &str, new_messages: &[ChatMessage]) -> Vec<ChatMessage> {
        if let Ok(mut sessions) = SESSIONS.lock() {
            let session = sessions
                .entry(session_id.to_string())
                .or_insert_with(|| ChatSession {
                    history: Vec::new(),
                    last_updated: Self::current_timestamp(),
                });

            session.history.extend(new_messages.iter().cloned());
            session.last_updated = Self::current_timestamp();

            // Return full history
            return session.history.clone();
        }
        // Fallback if lock fails (shouldn't happen)
        new_messages.to_vec()
    }

    /// Appends an assistant response to the session
    fn append_response(session_id: &str, reply: &ChatReply, signature: Option<String>) {
        if let Ok(mut sessions) = SESSIONS.lock()
            && let Some(session) = sessions.get_mut(session_id)
        {
            session.history.push(ChatMessage {
                role: reply.role.clone(),
                content: serde_json::Value::String(reply.text.clone()),
                thought_signature: signature,
            });
            session.last_updated = Self::current_timestamp();
        }
        let _ = Self::save_to_disk();
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
    if let Ok(sessions) = SESSIONS.lock()
        && let Some(session) = sessions.get(session_id)
    {
        return session.history.clone();
    }
    Vec::new()
}

/// Clears history for a session
pub fn clear_chat_history(session_id: &str) {
    if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.remove(session_id);
    }
    let _ = ChatSessionManager::save_to_disk();
}

// ==================================================================================
// AI Providers Abstraction
// ==================================================================================

/// Trait representing a generic AI provider
trait AIProvider: Send + Sync {
    /// Generates a streaming response
    fn generate_stream(
        &self,
        window: tauri::Window,
        request: ChatRequest,
    ) -> impl std::future::Future<Output = Result<ChatResponse, crate::errors::AppError>> + Send;
}

/// OpenAI Provider Implementation
struct OpenAIProvider {
    base_url: String,
}

impl OpenAIProvider {
    fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
        }
    }
}

impl AIProvider for OpenAIProvider {
    async fn generate_stream(
        &self,
        window: tauri::Window,
        req: ChatRequest,
    ) -> Result<ChatResponse, crate::errors::AppError> {
        let api_key = req
            .api_key
            .clone()
            .ok_or_else(|| crate::errors::AppError::Config("No API key provided".to_string()))?;
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| crate::errors::AppError::External(e.to_string()))?;

        let mut payload = serde_json::Map::new();
        payload.insert(
            "model".to_string(),
            serde_json::Value::String(req.model.clone()),
        );
        payload.insert("messages".to_string(), serde_json::json!(req.messages));
        payload.insert("stream".to_string(), serde_json::Value::Bool(true));

        // Thinking params
        if let Some(level) = &req.thinking_level {
            match level.as_str() {
                "low" | "high" => {
                    payload.insert(
                        "reasoning_effort".to_string(),
                        serde_json::Value::String(level.clone()),
                    );
                    let budget = if level == "high" { 16384 } else { 4096 };
                    payload.insert(
                        "thinking".to_string(),
                        serde_json::json!({
                            "type": "enabled",
                            "budget_tokens": budget
                        }),
                    );
                    payload.insert("max_tokens".to_string(), serde_json::json!(budget + 8192));
                }
                _ => {}
            }
        } else {
            payload.insert("max_tokens".to_string(), serde_json::json!(8192));
        }

        let endpoint = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        let res = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| crate::errors::AppError::External(format!("Request failed: {e}")))?;

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_default();
            return Ok(ChatResponse {
                ok: false,
                reply: None,
                error: Some(format!("API Error {status}: {error_text}")),
                model: Some(req.model),
                thought_signature: None,
            });
        }

        let mut stream = res.bytes_stream();
        let mut full_content = String::new();
        let mut buffer = String::new();

        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| crate::errors::AppError::External(e.to_string()))?;
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

                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data)
                        && let Some(choices) = json.get("choices").and_then(|c| c.as_array())
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
                            let _ = window.emit("ai:thought:chunk", reasoning);
                        }

                        // Content extraction
                        if let Some(content) = delta
                            .and_then(|d| d.get("content"))
                            .and_then(|v| v.as_str())
                        {
                            full_content.push_str(content);
                            let _ = window.emit("ai:chat:chunk", content);
                        }
                    }
                }
            }
        }

        Ok(ChatResponse {
            ok: true,
            reply: Some(ChatReply {
                text: full_content,
                role: "assistant".to_string(),
            }),
            error: None,
            model: Some(req.model),
            thought_signature: None,
        })
    }
}

/// Gemini Provider Implementation
struct GeminiProvider;

impl AIProvider for GeminiProvider {
    async fn generate_stream(
        &self,
        window: tauri::Window,
        req: ChatRequest,
    ) -> Result<ChatResponse, crate::errors::AppError> {
        let api_key = req
            .api_key
            .clone()
            .ok_or_else(|| crate::errors::AppError::Config("No API key provided".to_string()))?;
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| crate::errors::AppError::External(e.to_string()))?;

        // Prepare contents logic (extracted for clarity could be better but keeping inline for struct encapsulation)
        let contents: Vec<serde_json::Value> = req.messages.iter().map(|msg| {
            let role = if msg.role == "assistant" { "model" } else { "user" };
            let mut parts_array: Vec<serde_json::Value> = match &msg.content {
                serde_json::Value::String(text) => vec![serde_json::json!({ "text": text })],
                serde_json::Value::Array(items) => items.iter().filter_map(|item| {
                     let type_str = item.get("type").and_then(|t| t.as_str())?;
                     match type_str {
                         "text" => Some(serde_json::json!({ "text": item.get("text")?.as_str()? })),
                         "image_url" => {
                             let url = item.get("image_url")?.get("url")?.as_str()?;
                             let (mime, data) = parse_data_uri(url)?;
                             Some(serde_json::json!({ "inline_data": { "mime_type": mime, "data": data } }))
                         }
                         _ => None,
                     }
                }).collect(),
                _ => vec![serde_json::json!({ "text": "" })],
            };

            if let Some(sig) = &msg.thought_signature
                && let Some(obj) = parts_array.get_mut(0).and_then(|p| p.as_object_mut())
            {
                obj.insert("thoughtSignature".to_string(), serde_json::Value::String(sig.clone()));
            }

            serde_json::json!({ "role": role, "parts": parts_array })
        }).collect();

        let mut generation_config = serde_json::Map::new();
        if let Some(level) = &req.thinking_level {
            let mut thinking_config = serde_json::Map::new();
            thinking_config.insert(
                "thinkingLevel".to_string(),
                serde_json::Value::String(level.clone()),
            );
            thinking_config.insert("includeThoughts".to_string(), serde_json::Value::Bool(true));
            generation_config.insert(
                "thinkingConfig".to_string(),
                serde_json::Value::Object(thinking_config),
            );
        }

        let payload =
            serde_json::json!({ "contents": contents, "generationConfig": generation_config });
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
            req.model, api_key
        );

        let max_retries = 3;
        let mut retry_count = 0;

        loop {
            let res = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await;

            match res {
                Ok(response) => {
                    if !response.status().is_success() {
                        let status = response.status();
                        if status == reqwest::StatusCode::TOO_MANY_REQUESTS
                            && retry_count < max_retries
                        {
                            let wait = std::time::Duration::from_secs(2u64.pow(retry_count + 1));
                            let _ = window.emit("ai:status:retry", serde_json::json!({ "code": "GEMINI_QUOTA_RETRY", "wait_seconds": wait.as_secs() }).to_string());
                            tokio::time::sleep(wait).await;
                            retry_count += 1;
                            continue;
                        }
                        let err_msg = if status == reqwest::StatusCode::FORBIDDEN
                            || status == reqwest::StatusCode::UNAUTHORIZED
                        {
                            "ui.gemini.error.auth".to_string()
                        } else if status == reqwest::StatusCode::SERVICE_UNAVAILABLE {
                            "ui.gemini.error.unavailable".to_string()
                        } else {
                            response
                                .text()
                                .await
                                .unwrap_or_else(|_| "Unknown error".to_string())
                        };
                        return Ok(ChatResponse {
                            ok: false,
                            reply: None,
                            error: Some(err_msg),
                            model: Some(req.model),
                            thought_signature: None,
                        });
                    }

                    let mut stream = response.bytes_stream();
                    let mut full_content = String::new();
                    let mut thought_signature = None;
                    let mut buffer = String::new();

                    while let Some(item) = stream.next().await {
                        let chunk =
                            item.map_err(|e| crate::errors::AppError::External(e.to_string()))?;
                        buffer.push_str(&String::from_utf8_lossy(&chunk));

                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim().to_string();
                            buffer.drain(..=pos);

                            if line.starts_with("data: ") {
                                let data = line.trim_start_matches("data: ");
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data)
                                    && let Some(parts) = json
                                        .get("candidates")
                                        .and_then(|c| c.get(0))
                                        .and_then(|c| c.get("content"))
                                        .and_then(|c| c.get("parts"))
                                        .and_then(|p| p.as_array())
                                {
                                    for part in parts {
                                        let is_thought = part
                                            .get("thought")
                                            .and_then(serde_json::Value::as_bool)
                                            .unwrap_or(false);
                                        if is_thought {
                                            if let Some(t) =
                                                part.get("text").and_then(|v| v.as_str())
                                            {
                                                let _ = window.emit("ai:thought:chunk", t);
                                            }
                                        } else if let Some(t) =
                                            part.get("thought").and_then(|v| v.as_str())
                                        {
                                            let _ = window.emit("ai:thought:chunk", t);
                                        } else if let Some(t) =
                                            part.get("text").and_then(|v| v.as_str())
                                        {
                                            full_content.push_str(t);
                                            let _ = window.emit("ai:chat:chunk", t);
                                        }

                                        if let Some(sig) =
                                            part.get("thoughtSignature").and_then(|s| s.as_str())
                                        {
                                            thought_signature = Some(sig.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }

                    return Ok(ChatResponse {
                        ok: true,
                        reply: Some(ChatReply {
                            text: full_content,
                            role: "model".to_string(),
                        }),
                        error: None,
                        model: Some(req.model),
                        thought_signature,
                    });
                }
                Err(e) => {
                    return Ok(ChatResponse {
                        ok: false,
                        reply: None,
                        error: Some(format!("Request failed: {e}")),
                        model: Some(req.model),
                        thought_signature: None,
                    });
                }
            }
        }
    }
}

// ==================================================================================
// Service Orchestrator
// ==================================================================================

/// Dispatches a chat request to the appropriate AI provider.
pub async fn process_chat_request(
    window: tauri::Window,
    request: ChatRequest,
) -> Result<ChatResponse, crate::errors::AppError> {
    // 1. Session Management
    let mut messages_context = request.messages.clone();
    if let Some(sid) = &request.session_id {
        messages_context = ChatSessionManager::get_or_create_session(sid, &request.messages);
        // Save just in case user added new messages
        let _ = ChatSessionManager::save_to_disk();
    }

    // 2. Resolve Provider Configuration (URL, Models, etc)
    let mut base_url = "https://api.openai.com/v1".to_string();
    let mut provider_type = "openai".to_string();
    let mut effective_model = request.model.clone();

    // Standard provider resolution logic
    match request.provider.as_str() {
        "gemini" => provider_type = "gemini".to_string(),
        "gpt" => {
            provider_type = "openai".to_string();
            base_url = "https://api.openai.com/v1".to_string();
        }
        _ => {}
    }

    // Config lookup
    let providers_path = crate::utils::paths::RESOURCES_DIR.join("api_providers.json");
    if providers_path.exists()
        && let Ok(content) = std::fs::read_to_string(&providers_path)
        && let Ok(providers) = serde_json::from_str::<Vec<ApiProvider>>(&content)
        && let Some(p) = providers.iter().find(|p| p.id == request.provider)
    {
        provider_type = p.provider_type.clone();
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
            && let Some(tm) = &def.text
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

    // 3. Dispatch to Provider
    let response = match provider_type.as_str() {
        "openai" => {
            let provider = OpenAIProvider::new(&base_url);
            provider.generate_stream(window, effective_request).await
        }
        "gemini" => {
            let provider = GeminiProvider;
            provider.generate_stream(window, effective_request).await
        }
        _ => Ok(ChatResponse {
            ok: false,
            reply: None,
            error: Some(format!("Unknown provider type: {provider_type}")),
            model: Some(request.model),
            thought_signature: None,
        }),
    };

    // 4. Save Response to History
    if let Ok(res) = &response
        && res.ok
        && let Some(reply) = &res.reply
        && let Some(sid) = &request.session_id
    {
        ChatSessionManager::append_response(sid, reply, res.thought_signature.clone());
    }

    response
}

// ==================================================================================
// Helpers
// ==================================================================================

/// Validates an API key against the specified provider.
pub async fn validate_api_key(
    provider: String,
    key: String,
) -> Result<bool, crate::errors::AppError> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| crate::errors::AppError::External(e.to_string()))?;

    match provider.as_str() {
        "openai" | "gpt" => {
            let res = client
                .get("https://api.openai.com/v1/models")
                .header("Authorization", format!("Bearer {key}"))
                .send()
                .await
                .map_err(|e| crate::errors::AppError::External(e.to_string()))?;
            Ok(res.status().is_success())
        }
        "gemini" => {
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}");
            let res = client
                .get(&url)
                .send()
                .await
                .map_err(|e| crate::errors::AppError::External(e.to_string()))?;
            Ok(res.status().is_success())
        }
        _ => Ok(false),
    }
}

fn parse_data_uri(uri: &str) -> Option<(String, String)> {
    if !uri.starts_with("data:") {
        return None;
    }
    let parts: Vec<&str> = uri.splitn(2, ',').collect();
    if let [meta, data] = parts.as_slice() {
        let mime_part = meta.strip_prefix("data:")?;
        let mime = mime_part.split(';').next()?.to_string();
        Some((mime, data.to_string()))
    } else {
        None
    }
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
