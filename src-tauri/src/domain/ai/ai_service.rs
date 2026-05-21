//! AI Service implementation — Service Orchestrator
//!
//! Orchestrates chat requests: resolves provider config, dispatches via the
//! `AiProvider` trait, and emits streaming events through an abstract sink.
//!
//! DTOs → [`types`] · Session management → [`session`] · Streaming → [`streaming`]

use std::sync::Arc;

use super::ai_dispatch::{
    LocalEngineAccess, PreparedChatDispatch, persist_successful_response, prepare_chat_dispatch,
};
use super::session::ChatSessionManager;
use super::streaming::{AiProvider, OpenAiCompatibleProvider, StreamEvent, StreamSink};
pub use super::types::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage,
};

const AI_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

struct PreparedRequestExecution {
    provider: OpenAiCompatibleProvider,
    effective_request: ChatRequest,
    request_id: String,
    message_id: String,
}
const fn conflicting_local_capability(
    capability: crate::domain::engine::types::Capability,
) -> Option<crate::domain::engine::types::Capability> {
    match capability {
        crate::domain::engine::types::Capability::Text => {
            Some(crate::domain::engine::types::Capability::Image)
        }
        crate::domain::engine::types::Capability::Image => {
            Some(crate::domain::engine::types::Capability::Text)
        }
        crate::domain::engine::types::Capability::Vision => None,
    }
}

pub(super) async fn stop_conflicting_local_engine(
    engine_manager: &crate::domain::engine::manager::EngineManager,
    capability: crate::domain::engine::types::Capability,
) -> Result<(), crate::errors::AppError> {
    let Some(conflicting_capability) = conflicting_local_capability(capability) else {
        return Ok(());
    };

    engine_manager.stop_slot(conflicting_capability).await
}

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
    process_chat_request_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        sink,
        LocalEngineAccess::AutoStart,
    )
    .await
}

/// Dispatches a chat request without starting or hot-swapping local engines.
/// Fails if the requested local engine is not already running in the launcher.
pub async fn process_chat_request_without_engine_autostart(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    sink: Arc<dyn StreamSink>,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        sink,
        LocalEngineAccess::RequireRunning,
    )
    .await
}

/// Dispatches a chat request without streaming and without starting or hot-swapping local engines.
/// Used by launcher modules that expect one JSON response and must not mutate launcher engine state.
pub async fn process_chat_request_non_stream_without_engine_autostart(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_non_stream_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        LocalEngineAccess::RequireRunning,
    )
    .await
}

/// Dispatches a chat request without streaming while still allowing launcher-managed local
/// engine autostart and cross-slot exclusivity.
pub async fn process_chat_request_non_stream(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_non_stream_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        LocalEngineAccess::AutoStart,
    )
    .await
}

async fn process_chat_request_with_local_engine_access(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    sink: Arc<dyn StreamSink>,
    local_engine_access: LocalEngineAccess,
) -> Result<ChatResponse, crate::errors::AppError> {
    let _local_workload_guard = if engine_manager.has_definition(&request.provider).await {
        Some(engine_manager.acquire_local_workload().await)
    } else {
        None
    };

    let execution = prepare_request_execution(
        &request,
        sessions,
        config_service,
        engine_manager,
        local_engine_access,
    )
    .await?;
    let session_id = request.session_id.clone();
    let timeout_sink = Arc::clone(&sink);

    execute_prepared_request(
        execution,
        sessions,
        session_id.as_deref(),
        move |execution| async move {
            execution
                .provider
                .generate_stream(
                    execution.request_id.clone(),
                    execution.message_id.clone(),
                    execution.effective_request,
                    sink,
                )
                .await
        },
        move |message_id| {
            timeout_sink.emit(StreamEvent::Done {
                message_id: message_id.to_string(),
                usage: None,
            });
        },
    )
    .await
}

async fn process_chat_request_non_stream_with_local_engine_access(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    local_engine_access: LocalEngineAccess,
) -> Result<ChatResponse, crate::errors::AppError> {
    let _local_workload_guard = if engine_manager.has_definition(&request.provider).await {
        Some(engine_manager.acquire_local_workload().await)
    } else {
        None
    };

    let execution = prepare_request_execution(
        &request,
        sessions,
        config_service,
        engine_manager,
        local_engine_access,
    )
    .await?;
    let session_id = request.session_id.clone();

    execute_prepared_request(
        execution,
        sessions,
        session_id.as_deref(),
        |execution| async move {
            execution
                .provider
                .generate_completion(
                    execution.request_id.clone(),
                    execution.message_id.clone(),
                    execution.effective_request,
                )
                .await
        },
        |_| {},
    )
    .await
}

async fn prepare_request_execution(
    request: &ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    local_engine_access: LocalEngineAccess,
) -> Result<PreparedRequestExecution, crate::errors::AppError> {
    let PreparedChatDispatch {
        base_url,
        effective_request,
    } = prepare_chat_dispatch(
        request,
        sessions,
        config_service,
        engine_manager,
        local_engine_access,
    )
    .await?;

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

    Ok(PreparedRequestExecution {
        provider: OpenAiCompatibleProvider::new(&base_url),
        effective_request,
        request_id,
        message_id,
    })
}

async fn execute_prepared_request<Run, Fut, Timeout>(
    execution: PreparedRequestExecution,
    sessions: &ChatSessionManager,
    session_id: Option<&str>,
    run: Run,
    on_timeout: Timeout,
) -> Result<ChatResponse, crate::errors::AppError>
where
    Run: FnOnce(PreparedRequestExecution) -> Fut,
    Fut: std::future::Future<Output = Result<ChatResponse, crate::errors::AppError>>,
    Timeout: FnOnce(&str),
{
    let message_id = execution.message_id.clone();
    let request_id = execution.request_id.clone();
    let response = tokio::time::timeout(AI_REQUEST_TIMEOUT, run(execution)).await;

    let response = if let Ok(result) = response {
        result
    } else {
        on_timeout(&message_id);
        Err(timeout_error(request_id))
    };

    persist_successful_response(sessions, session_id, message_id, &response).await;
    response
}

fn timeout_error(request_id: String) -> crate::errors::AppError {
    crate::errors::AppError::Internal {
        request_id: Some(request_id),
        message: format!(
            "AI Request timed out after {} seconds.",
            AI_REQUEST_TIMEOUT.as_secs()
        ),
    }
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
    use tiktoken_rs::{bpe_for_model, cl100k_base};

    if let Some(model_name) = model
        && let Ok(bpe) = bpe_for_model(model_name)
    {
        return Ok(bpe.encode_with_special_tokens(text).len());
    }

    let bpe = cl100k_base().map_err(|e| format!("Failed to load cl100k_base tokenizer: {e}"))?;

    Ok(bpe.encode_with_special_tokens(text).len())
}

/// Dispatches an image generation request to the appropriate provider (local engine).
pub async fn process_image_request(
    request: super::types::ImageGenerationRequest,
    sessions: &crate::domain::ai::session::ChatSessionManager,
    _config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    image_generation_state: &crate::domain::ai::ImageGenerationState,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
) -> Result<super::types::ImageGenerationResponse, crate::errors::AppError> {
    super::image_service::process_image_request(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
    )
    .await
}

/// Dispatches an image request without starting or hot-swapping local engines.
/// Fails if the requested local engine is not already running in the launcher.
pub async fn process_image_request_without_engine_autostart(
    request: super::types::ImageGenerationRequest,
    sessions: &crate::domain::ai::session::ChatSessionManager,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    image_generation_state: &crate::domain::ai::ImageGenerationState,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
) -> Result<super::types::ImageGenerationResponse, crate::errors::AppError> {
    super::image_service::process_image_request_without_engine_autostart(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
    )
    .await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used, clippy::indexing_slicing)]
    use super::*;
    use crate::domain::ai::image_service::{
        normalize_comfyui_sampler, normalize_comfyui_scheduler, parse_comfyui_checkpoint_list,
        resolve_f32_setting, resolve_string_setting, resolve_u32_setting,
    };
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
    fn conflicting_local_capability_is_text_image_exclusive() {
        assert_eq!(
            conflicting_local_capability(crate::domain::engine::types::Capability::Text),
            Some(crate::domain::engine::types::Capability::Image)
        );
        assert_eq!(
            conflicting_local_capability(crate::domain::engine::types::Capability::Image),
            Some(crate::domain::engine::types::Capability::Text)
        );
        assert_eq!(
            conflicting_local_capability(crate::domain::engine::types::Capability::Vision),
            None
        );
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

    #[test]
    fn test_normalize_comfyui_sampler_maps_a1111_aliases() {
        assert_eq!(
            normalize_comfyui_sampler(Some("DPM++ 2M SDE")),
            "dpmpp_2m_sde"
        );
        assert_eq!(
            normalize_comfyui_sampler(Some("Euler a")),
            "euler_ancestral"
        );
        assert_eq!(normalize_comfyui_sampler(None), "euler");
    }

    #[test]
    fn test_normalize_comfyui_scheduler_maps_known_aliases() {
        assert_eq!(normalize_comfyui_scheduler(Some("default")), "karras");
        assert_eq!(
            normalize_comfyui_scheduler(Some("linear quadratic")),
            "linear_quadratic"
        );
        assert_eq!(
            normalize_comfyui_scheduler(Some("sgm uniform")),
            "sgm_uniform"
        );
    }

    #[test]
    fn test_parse_comfyui_checkpoint_list_supports_multiple_payload_shapes() {
        let payload = serde_json::json!({
            "models": [
                "model-a.safetensors",
                { "name": "model-b.safetensors" },
                { "filename": "model-c.safetensors" },
                { "path": "nested/model-d.safetensors" },
                "model-a.safetensors"
            ]
        });

        assert_eq!(
            parse_comfyui_checkpoint_list(&payload),
            vec![
                "model-a.safetensors".to_string(),
                "model-b.safetensors".to_string(),
                "model-c.safetensors".to_string(),
                "nested/model-d.safetensors".to_string(),
            ]
        );
    }
}
