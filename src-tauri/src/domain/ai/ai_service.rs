//! AI Service implementation — Service Orchestrator
//!
//! Orchestrates chat requests: resolves provider config, dispatches via the
//! `AiProvider` trait, and bridges streaming events to the Tauri window.
//!
//! DTOs → [`types`] · Session management → [`session`] · Streaming → [`streaming`]

use crate::models::config::ApiProvider;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::mpsc;

use super::session::ChatSessionManager;
use super::streaming::{AiProvider, OpenRouterProvider, StreamEvent, WindowSink};
pub use super::types::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage,
};

// ==================================================================================
// Service Orchestrator
// ==================================================================================

/// Dispatches a chat request to the OpenRouter provider.
pub async fn process_chat_request(
    window: tauri::Window,
    request: ChatRequest,
    sessions: &ChatSessionManager,
) -> Result<ChatResponse, crate::errors::AppError> {
    // 1. Session Management
    let mut messages_context = request.messages.clone();
    if let Some(sid) = &request.session_id {
        messages_context = sessions.get_or_create_session(sid, &request.messages);
    }

    // 2. Resolve Provider Configuration
    let mut base_url = "https://openrouter.ai/api/v1".to_string();
    let mut effective_model = request.model.clone();
    let mut model_max_tokens: Option<u32> = None;

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
            tracing::info!("Resolved model alias: {} -> {}", request.model, target);
            effective_model = target.clone();
        }

        // Resolve proper model ID and limits
        if let Some(models) = &p.models
            && let Some(def) = models.get(&effective_model)
        {
            model_max_tokens = def.max_output_tokens;
            if let Some(tm) = def.api_models.as_ref().and_then(|m| m.text.as_ref()) {
                tracing::info!("Resolved API model ID: {effective_model} -> {tm}");
                effective_model = tm.clone();
            }
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
                tracing::info!(
                    "Resolved Custom Model: {} -> {}",
                    effective_model,
                    custom.base_model_id
                );
                effective_model = custom.base_model_id.clone();
            }
        }
    }

    // Dynamic Clamping
    let clamped_max_tokens = match (request.max_tokens, model_max_tokens) {
        (Some(req_limit), Some(mod_limit)) => Some(req_limit.min(mod_limit)),
        (None, Some(mod_limit)) => Some(mod_limit),
        (req_limit, None) => req_limit,
    };

    let effective_request = ChatRequest {
        messages: messages_context,
        model: effective_model,
        max_tokens: clamped_max_tokens,
        ..request.clone()
    };

    // 3. Dispatch to Provider
    let request_id = uuid::Uuid::new_v4().to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    tracing::info!(
        "[AI] Starting request {} (msg {}) for model {}",
        request_id,
        message_id,
        effective_request.model
    );

    // 3.1 Setup Bounded Channel
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
    let sink: Arc<dyn super::streaming::StreamSink> = Arc::new(WindowSink::new(tx));

    let provider: Box<dyn AiProvider> = Box::new(OpenRouterProvider::new(&base_url));

    // 3.2 Spawn Sink Processor (UI Bridge)
    let window_for_task = window.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::ChatChunk { content, .. } => {
                    let _ = window_for_task.emit("ai:chat:chunk", content);
                }
                StreamEvent::ThoughtChunk { content, .. } => {
                    let _ = window_for_task.emit("ai:thought_chunk", content);
                }
                StreamEvent::Done { usage, .. } => {
                    let _ = window_for_task.emit("ai:chat:done", usage);
                }
            }
        }
    });

    // 3.3 Execute with 90s Timeout
    let sink_clone = Arc::clone(&sink);
    let response_res = tokio::time::timeout(
        std::time::Duration::from_secs(90),
        provider.generate_stream(
            request_id.clone(),
            message_id.clone(),
            effective_request,
            sink_clone,
        ),
    )
    .await;

    let response = if let Ok(res) = response_res {
        res
    } else {
        // Emit Done on timeout to prevent UI hang
        sink.emit(StreamEvent::Done {
            message_id: message_id.clone(),
            usage: None,
        });
        Err(crate::errors::AppError::Internal {
            request_id: Some(request_id),
            message: "AI Request timed out after 90 seconds.".to_string(),
        })
    };

    // 4. Save Response to History
    if let Ok(res) = &response
        && res.ok
        && let Some(reply) = &res.reply
        && let Some(sid) = &request.session_id
    {
        sessions.append_response(sid, message_id, reply, res.thought_signature.clone());
        // Immediate flush after stream completion
        let _ = sessions.force_save().await;
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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    // OpenRouter / OpenAI Standard validation
    let url = if provider == "gemini" && !key.starts_with("sk-or-") {
        // Fallback for legacy raw Gemini keys
        format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}")
    } else {
        "https://openrouter.ai/api/v1/models".to_string()
    };

    let mut req = client.get(&url);

    if !url.contains("key=") {
        req = req.header("Authorization", format!("Bearer {key}"));
    }

    // Explicitly drop key after building request
    std::mem::drop(key);

    let res = req
        .send()
        .await
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    if !res.status().is_success() {
        return Ok(false);
    }

    let body = res.json::<serde_json::Value>().await.map_err(|e| {
        tracing::error!("[Validation] Failed to parse response JSON: {e}");
        crate::errors::AppError::External {
            request_id: None,
            message: "Malformed API response during validation".to_string(),
        }
    })?;

    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        return Ok(!data.is_empty());
    }

    // Legacy Gemini fallback
    if body.get("models").is_some() {
        return Ok(true);
    }

    Ok(false)
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

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]
    use super::*;

    #[test]
    fn test_count_tokens_basic() {
        // cl100k_base tokenizer: "Hello world" → typically 2 tokens
        let count = count_tokens("Hello world", None).expect("count_tokens should not fail");
        assert!(count > 0, "Should count at least 1 token");
        assert!(
            count < 10,
            "Should not count more than 10 tokens for 2 words"
        );
    }

    #[test]
    fn test_count_tokens_empty() {
        let count = count_tokens("", None).expect("count_tokens empty should not fail");
        assert_eq!(count, 0, "Empty string should produce 0 tokens");
    }

    #[test]
    fn test_count_tokens_with_model_fallback() {
        // Unknown model should fall back to cl100k_base without error
        let count = count_tokens(
            "Testing an unknown model tokenizer",
            Some("unknown-model-xyz"),
        )
        .expect("Should fall back to cl100k_base");
        assert!(count > 0);
    }

    #[test]
    fn test_count_tokens_longer_text() {
        let text = "The quick brown fox jumps over the lazy dog";
        let count = count_tokens(text, None).expect("count_tokens longer text");
        // 9 words, likely 9-11 tokens with cl100k_base
        assert!(count >= 9, "Should produce at least 9 tokens for 9 words");
        assert!(count <= 15, "Should not wildly over-count 9 words");
    }
}
