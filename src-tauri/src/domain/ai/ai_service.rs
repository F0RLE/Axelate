//! AI Service implementation — Service Orchestrator
//!
//! Orchestrates chat requests: resolves provider config, dispatches via the
//! `AiProvider` trait, and emits streaming events through an abstract sink.
//!
//! DTOs → [`types`] · Session management → [`session`] · Streaming → [`streaming`]

use std::sync::Arc;

use crate::domain::engine::config::{build_default_engine_config, merge_user_engine_config};
use crate::infrastructure::config::engine_settings::load_engine_config_map;

use super::session::ChatSessionManager;
use super::streaming::{AiProvider, OpenRouterProvider, StreamEvent, StreamSink};
pub use super::types::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage,
};

// ==================================================================================
// Service Orchestrator
// ==================================================================================

/// Dispatches a chat request to the appropriate provider (cloud or local engine).
pub async fn process_chat_request(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    sink: Arc<dyn StreamSink>,
) -> Result<ChatResponse, crate::errors::AppError> {
    // 1. Session Management
    let mut messages_context = request.messages.clone();
    if let Some(sid) = &request.session_id {
        messages_context = sessions.merge_request_messages(sid, &request.messages);
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
        let mut config = build_engine_config(&def).await?;

        // Override model_path from request if frontend provided one
        if !request.model.is_empty() && request.model != "default" {
            config.model_path = Some(request.model.clone());
        }

        if config.model_path.as_deref() == Some("default") {
            config.model_path = None;
        }

        let local_context_size = usize::try_from(config.context_size.max(4096)).unwrap_or(4096);
        let local_model_for_context = config
            .model_path
            .clone()
            .unwrap_or_else(|| request.model.clone());
        let status = engine_manager.start(config).await?;
        base_url = format!("{}/v1", status.endpoint);
        is_local_engine = true;

        if let Some(sid) = &request.session_id {
            messages_context =
                sessions.build_local_context(sid, local_context_size, &local_model_for_context);
        }

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
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let message_id = uuid::Uuid::new_v4().to_string();
    tracing::info!(
        "[AI] Starting request {} (msg {}) for model {}",
        request_id,
        message_id,
        effective_request.model
    );

    // 3.1 Setup Bounded Channel
    let provider: Box<dyn AiProvider> = Box::new(OpenRouterProvider::new(&base_url));

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

/// Builds the outbound validation request without leaking secrets into the URL.
fn build_validation_request(
    client: &reqwest::Client,
    provider: &str,
    key: &str,
) -> Result<reqwest::Request, crate::errors::AppError> {
    let request = if provider == "gemini" && !key.starts_with("sk-or-") {
        client
            .get("https://generativelanguage.googleapis.com/v1beta/models")
            .header("x-goog-api-key", key)
    } else {
        client
            .get("https://openrouter.ai/api/v1/models")
            .header("Authorization", format!("Bearer {key}"))
    };

    request
        .build()
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })
}

/// Validates an API key against OpenRouter (or generic OpenAI endpoint).
pub async fn validate_api_key(
    provider: String,
    key: String,
) -> Result<bool, crate::errors::AppError> {
    let key = key.trim().to_string();
    if key.is_empty()
        || key.chars().any(char::is_whitespace)
        || key.contains("://")
        || key.contains('/')
        || key.contains('?')
        || key.contains('&')
    {
        return Ok(false);
    }

    let is_openrouter_key = key.starts_with("sk-or-");
    if provider == "gemini" && !is_openrouter_key && !key.starts_with("AIza") {
        return Ok(false);
    }

    if provider != "gemini" && !is_openrouter_key {
        return Ok(false);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    let request = build_validation_request(&client, &provider, &key)?;

    // Explicitly drop key after building request
    std::mem::drop(key);

    let res = client
        .execute(request)
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
    settings_service: &crate::infrastructure::config::settings::SettingsService,
) -> Result<super::types::ImageGenerationResponse, crate::errors::AppError> {
    let request = apply_image_request_defaults(request, settings_service).await?;
    let base_url;

    // Route only local engines for now
    if let Some(def) = engine_manager.get_definition(&request.provider).await {
        tracing::info!(
            provider = %request.provider,
            "Detected local engine for image generation"
        );

        // Slot empty, occupied by a different engine, or different model — start or reuse
        let mut config = build_engine_config(&def).await?;

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
        let _ = sessions.merge_request_messages(sid, &[user_message]);

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

async fn apply_image_request_defaults(
    mut request: super::types::ImageGenerationRequest,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
) -> Result<super::types::ImageGenerationRequest, crate::errors::AppError> {
    let settings = settings_service.get_settings().await?;
    let settings_key = request
        .settings_key
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| request.provider.clone());

    let positive_prompt = resolve_string_setting(
        &settings,
        &settings_key,
        &request.provider,
        "positive_prompt",
    );
    if let Some(prefix) = positive_prompt.filter(|value| !value.trim().is_empty()) {
        request.prompt = format!("{prefix}, {}", request.prompt);
    }

    request.negative_prompt = request.negative_prompt.or_else(|| {
        resolve_string_setting(
            &settings,
            &settings_key,
            &request.provider,
            "negative_prompt",
        )
    });
    request.steps = request
        .steps
        .or_else(|| resolve_u32_setting(&settings, &settings_key, &request.provider, "steps"));
    request.cfg_scale = request
        .cfg_scale
        .or_else(|| resolve_f32_setting(&settings, &settings_key, &request.provider, "cfg_scale"));
    request.width = request
        .width
        .or_else(|| resolve_u32_setting(&settings, &settings_key, &request.provider, "width"));
    request.height = request
        .height
        .or_else(|| resolve_u32_setting(&settings, &settings_key, &request.provider, "height"));
    request.sampler = request
        .sampler
        .or_else(|| resolve_string_setting(&settings, &settings_key, &request.provider, "sampler"));
    request.seed = request
        .seed
        .or_else(|| resolve_i32_setting(&settings, &settings_key, &request.provider, "seed"));
    request.batch_size = request
        .batch_size
        .or_else(|| resolve_u32_setting(&settings, &settings_key, &request.provider, "batch_size"));
    request.scheduler = request.scheduler.or_else(|| {
        resolve_string_setting(&settings, &settings_key, &request.provider, "scheduler")
    });
    request.clip_skip = request
        .clip_skip
        .or_else(|| resolve_i32_setting(&settings, &settings_key, &request.provider, "clip_skip"));

    Ok(request)
}

fn resolve_string_setting(
    settings: &crate::models::AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<String> {
    resolve_setting_value(settings, settings_key, provider_id, suffix).and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn resolve_u32_setting(
    settings: &crate::models::AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<u32> {
    resolve_setting_value(settings, settings_key, provider_id, suffix)
        .and_then(|value| value.parse::<u32>().ok())
}

fn resolve_i32_setting(
    settings: &crate::models::AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<i32> {
    resolve_setting_value(settings, settings_key, provider_id, suffix)
        .and_then(|value| value.parse::<i32>().ok())
}

fn resolve_f32_setting(
    settings: &crate::models::AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<f32> {
    resolve_setting_value(settings, settings_key, provider_id, suffix)
        .and_then(|value| value.parse::<f32>().ok())
}

fn resolve_setting_value<'a>(
    settings: &'a crate::models::AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<&'a str> {
    let candidates = build_setting_candidates(settings_key, suffix);
    for key in candidates {
        if let Some(value) = settings.extra_settings.get(&key) {
            return Some(value.as_str());
        }
    }

    if settings_key != provider_id {
        let candidates = build_setting_candidates(provider_id, suffix);
        for key in candidates {
            if let Some(value) = settings.extra_settings.get(&key) {
                return Some(value.as_str());
            }
        }
    }

    None
}

fn build_setting_candidates(prefix: &str, suffix: &str) -> [String; 3] {
    [
        format!("{prefix}_{suffix}"),
        format!("{prefix}_{}", suffix.to_lowercase()),
        format!("{prefix}_{}", suffix.replace('_', "")),
    ]
}

async fn build_engine_config(
    def: &crate::domain::engine::types::EngineDefinition,
) -> Result<crate::domain::engine::types::EngineConfig, crate::errors::AppError> {
    let saved = load_engine_config_map().await?;
    Ok(saved.get(&def.id).map_or_else(
        || build_default_engine_config(def),
        |config| merge_user_engine_config(def, config),
    ))
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
    use crate::models::AppSettings;
    use std::collections::HashMap;

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

    #[tokio::test]
    async fn test_validate_api_key_rejects_obvious_non_keys() {
        assert!(
            !validate_api_key("openrouter".to_string(), String::new())
                .await
                .expect("empty key should not error")
        );
        assert!(
            !validate_api_key(
                "openrouter".to_string(),
                "https://reddit.com/r/not-a-key".to_string()
            )
            .await
            .expect("url-like key should not error")
        );
        assert!(
            !validate_api_key("openrouter".to_string(), "not a real key".to_string())
                .await
                .expect("whitespace key should not error")
        );
    }

    #[test]
    fn test_build_validation_request_keeps_gemini_key_out_of_url() {
        let client = reqwest::Client::new();
        let request = build_validation_request(&client, "gemini", "AIza-test-key")
            .expect("gemini request should build");

        assert_eq!(
            request.url().as_str(),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(
            request
                .headers()
                .get("x-goog-api-key")
                .expect("gemini header should exist"),
            "AIza-test-key"
        );
    }

    #[test]
    fn test_build_validation_request_uses_bearer_for_openrouter_keys() {
        let client = reqwest::Client::new();
        let request = build_validation_request(&client, "openrouter", "sk-or-test")
            .expect("openrouter request should build");

        assert_eq!(
            request.url().as_str(),
            "https://openrouter.ai/api/v1/models"
        );
        assert_eq!(
            request
                .headers()
                .get("Authorization")
                .expect("authorization header should exist"),
            "Bearer sk-or-test"
        );
    }

    #[test]
    fn test_resolve_image_setting_prefers_settings_key() {
        let mut extra_settings = HashMap::new();
        extra_settings.insert("custom_sd_steps".to_string(), "30".to_string());
        extra_settings.insert("sdcpp_steps".to_string(), "20".to_string());
        extra_settings.insert(
            "custom_sd_positiveprompt".to_string(),
            "portrait".to_string(),
        );

        let settings = AppSettings {
            extra_settings,
            ..AppSettings::default()
        };

        assert_eq!(
            resolve_u32_setting(&settings, "custom_sd", "sdcpp", "steps"),
            Some(30)
        );
        assert_eq!(
            resolve_string_setting(&settings, "custom_sd", "sdcpp", "positive_prompt"),
            Some("portrait".to_string())
        );
    }

    #[test]
    fn test_resolve_image_setting_falls_back_to_provider_id() {
        let mut extra_settings = HashMap::new();
        extra_settings.insert("sdcpp_cfg_scale".to_string(), "8.5".to_string());
        extra_settings.insert("sdcpp_negative_prompt".to_string(), "blurry".to_string());

        let settings = AppSettings {
            extra_settings,
            ..AppSettings::default()
        };

        assert_eq!(
            resolve_f32_setting(&settings, "custom_sd", "sdcpp", "cfg_scale"),
            Some(8.5)
        );
        assert_eq!(
            resolve_string_setting(&settings, "custom_sd", "sdcpp", "negative_prompt"),
            Some("blurry".to_string())
        );
    }
}
