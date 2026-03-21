//! AI Service implementation — Service Orchestrator
//!
//! Orchestrates chat requests: resolves provider config, dispatches via the
//! `AiProvider` trait, and bridges streaming events to the Tauri window.
//!
//! DTOs → [`types`] · Session management → [`session`] · Streaming → [`streaming`]

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

/// Dispatches a chat request to the appropriate provider (cloud or local engine).
pub async fn process_chat_request(
    window: tauri::Window,
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
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
    let mut is_local_engine = false;

    // 2a. Check if provider is a local engine (e.g. "llamacpp", "sdcpp")
    if let Some(def) = engine_manager.get_definition(&request.provider).await {
        tracing::info!(
            provider = %request.provider,
            "Detected local engine — routing through EngineManager"
        );

        // Slot empty, occupied by a different engine, or different model — start or reuse
        let mut config = crate::api::engine::load_engine_config_map()
            .ok()
            .and_then(|map| map.get(&def.id).cloned())
            .unwrap_or_else(|| crate::domain::engine::types::EngineConfig {
                engine_id: def.id.clone(),
                port: def.default_port,
                gpu_layers: def.default_gpu_layers,
                context_size: def.default_context_size,
                model_path: None,
                extra_args: vec![],
            });

        // Override model_path from request if frontend provided one
        if !request.model.is_empty() {
            config.model_path = Some(request.model.clone());
        }

        let status = engine_manager.start(config).await?;
        base_url = format!("{}/v1", status.endpoint);
        is_local_engine = true;

        tracing::info!(
            engine = %status.id,
            endpoint = %base_url,
            "Local engine ready"
        );
    }

    // 2b. Cloud provider resolution (skip if local engine)
    if !is_local_engine {
        if let Ok(config) = config_service.load_full_config() {
            if let Some(p) = config
                .api_providers
                .iter()
                .find(|p| p.id == request.provider)
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
                if let Some(models) = &p.models {
                    if let Some(def) = models.iter().find(|m| m.id == effective_model) {
                        model_max_tokens = def.max_output_tokens;
                        if let Some(tm) = def.api_models.as_ref().and_then(|m| m.text.as_ref()) {
                            tracing::info!("Resolved API model ID: {effective_model} -> {tm}");
                            effective_model = tm.clone();
                        }
                    }
                }
            }
        }

        // Check custom models
        if let Ok(cc) = config_service.load_custom_models() {
            if let Some(custom) = cc
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
                    let _ = window_for_task.emit("ai:thought:chunk", content);
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

/// Dispatches an image generation request to the appropriate provider (local engine).
pub async fn process_image_request(
    request: super::types::ImageGenerationRequest,
    sessions: &crate::domain::ai::session::ChatSessionManager,
    _config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
) -> Result<super::types::ImageGenerationResponse, crate::errors::AppError> {
    let base_url;

    // Route only local engines for now
    if let Some(def) = engine_manager.get_definition(&request.provider).await {
        tracing::info!(
            provider = %request.provider,
            "Detected local engine for image generation"
        );

        // Slot empty, occupied by a different engine, or different model — start or reuse
        let mut config = crate::api::engine::load_engine_config_map()
            .ok()
            .and_then(|map| map.get(&def.id).cloned())
            .unwrap_or_else(|| crate::domain::engine::types::EngineConfig {
                engine_id: def.id.clone(),
                port: def.default_port,
                gpu_layers: def.default_gpu_layers,
                context_size: def.default_context_size,
                model_path: None,
                extra_args: vec![],
            });

        // If the request provides a specific (valid) model path, override the config.
        // Frontend sends "default" when no specific model is selected in the chat UI,
        // so we must ignore "default" here and rely on the saved Config (from settings).
        if !request.model.is_empty() && request.model != "default" {
            config.model_path = Some(request.model.clone());
        }

        // Final sanity check: if model_path is still None or "default", the engine will fail.
        if config.model_path.as_deref() == Some("default") {
            config.model_path = None;
        }

        let status = engine_manager.start(config).await?;
        base_url = status.endpoint;
    } else {
        return Err(crate::errors::AppError::External {
            request_id: None,
            message: "Cloud image generation is not yet supported. Please use a local engine."
                .into(),
        });
    }

    let is_sdapi = request.provider == "sdcpp" || request.provider == "stable-diffusion";
    let url = if is_sdapi {
        format!("{base_url}/sdapi/v1/txt2img")
    } else {
        format!("{base_url}/v1/images/generations")
    };

    let normalized_sampler = if is_sdapi {
        normalize_sdcpp_sampler(request.sampler.as_deref())
    } else {
        request
            .sampler
            .clone()
            .unwrap_or_else(|| "euler_a".to_string())
    };
    let normalized_scheduler = if is_sdapi {
        normalize_sdcpp_scheduler(request.scheduler.as_deref())
    } else {
        request.scheduler.clone().unwrap_or_default()
    };

    // Convert our request to exactly what the endpoint expects
    let payload = serde_json::json!({
        "prompt": request.prompt,
        "steps": request.steps.unwrap_or(20),
        "cfg_scale": request.cfg_scale.unwrap_or(7.0),
        "width": request.width.unwrap_or(512),
        "height": request.height.unwrap_or(512),
        "sampler_name": normalized_sampler,
        "scheduler": normalized_scheduler,
        "seed": request.seed.unwrap_or(-1),
        "batch_size": request.batch_size.unwrap_or(1),
        "clip_skip": request.clip_skip.unwrap_or(-1),
        "negative_prompt": request.negative_prompt.unwrap_or_default()
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(999_999))
        .build()
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    tracing::info!("Sending image generation request to {}", url);
    let res = client.post(&url).json(&payload).send().await.map_err(|e| {
        crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        }
    })?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(crate::errors::AppError::External {
            request_id: None,
            message: format!("Image generation failed: {err_text}"),
        });
    }

    // The standardized response format usually looks like:
    // { "created": ..., "data": [ { "b64_json": "...", "url": "..." } ] }
    let body: serde_json::Value =
        res.json()
            .await
            .map_err(|e| crate::errors::AppError::External {
                request_id: None,
                message: format!("Failed to parse image response: {e}"),
            })?;

    let mut images = Vec::new();
    if is_sdapi {
        if let Some(imgs) = body.get("images").and_then(|i| i.as_array()) {
            for item in imgs {
                if let Some(b64) = item.as_str() {
                    images.push(format!("data:image/png;base64,{b64}"));
                }
            }
        }
    } else if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(b64) = item.get("b64_json").and_then(|s| s.as_str()) {
                images.push(format!("data:image/png;base64,{b64}"));
            } else if let Some(url) = item.get("url").and_then(|s| s.as_str()) {
                images.push(url.to_string());
            }
        }
    }

    if let Some(sid) = request.session_id.as_deref()
        && !images.is_empty()
    {
        let user_message = super::types::ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String(
                request
                    .original_prompt
                    .clone()
                    .unwrap_or_else(|| request.prompt.clone()),
            ),
            thought_signature: None,
        };
        let _ = sessions.get_or_create_session(sid, &[user_message]);

        let markdown_images = images
            .iter()
            .map(|image| format!("![Generated Image]({image})"))
            .collect::<Vec<_>>()
            .join("\n\n");

        let reply = super::types::ChatReply {
            text: markdown_images,
            role: "assistant".to_string(),
        };

        sessions.append_response(sid, uuid::Uuid::new_v4().to_string(), &reply, None);
        let _ = sessions.force_save().await;
    }

    Ok(super::types::ImageGenerationResponse {
        images,
        ok: true,
        error: None,
    })
}

fn normalize_sdcpp_sampler(value: Option<&str>) -> String {
    match value.unwrap_or("euler a").trim().to_lowercase().as_str() {
        "euler a" | "euler_a" => "euler_a".to_string(),
        "euler" => "euler".to_string(),
        "heun" => "heun".to_string(),
        "dpm2" => "dpm2".to_string(),
        "dpm2 a" | "dpm2_a" => "dpm2_a".to_string(),
        "dpm++ 2s a" | "dpm++2s_a" | "dpmpp_2s_a" => "dpm++2s_a".to_string(),
        "dpm++ 2m" | "dpm++2m" | "dpmpp_2m" => "dpm++2m".to_string(),
        "dpm++ 2m v2" | "dpm++2mv2" | "dpmpp_2mv2" => "dpm++2mv2".to_string(),
        "ipndm" => "ipndm".to_string(),
        "ipndm_v" => "ipndm_v".to_string(),
        "lcm" => "lcm".to_string(),
        "ddim trailing" | "ddim_trailing" => "ddim_trailing".to_string(),
        "tcd" => "tcd".to_string(),
        "res multistep" | "res_multistep" => "res_multistep".to_string(),
        "res 2s" | "res_2s" => "res_2s".to_string(),
        other => other.to_string(),
    }
}

fn normalize_sdcpp_scheduler(value: Option<&str>) -> String {
    match value.unwrap_or("discrete").trim().to_lowercase().as_str() {
        "default" | "normal" | "discrete" => "discrete".to_string(),
        "karras" => "karras".to_string(),
        "exponential" => "exponential".to_string(),
        "ays" => "ays".to_string(),
        "gits" => "gits".to_string(),
        "smoothstep" => "smoothstep".to_string(),
        "sgm uniform" | "sgm_uniform" | "ddim_uniform" => "sgm_uniform".to_string(),
        "simple" => "simple".to_string(),
        "kl optimal" | "kl_optimal" => "kl_optimal".to_string(),
        "lcm" => "lcm".to_string(),
        "bong tangent" | "bong_tangent" => "bong_tangent".to_string(),
        other => other.to_string(),
    }
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
