//! AI Service implementation — Service Orchestrator
//!
//! Orchestrates chat requests: resolves provider config, dispatches via the
//! `AiProvider` trait, and emits streaming events through an abstract sink.
//!
//! DTOs → [`types`] · Session management → [`session`] · Streaming → [`streaming`]

use std::sync::Arc;

use super::ai_dispatch::{
    LocalEngineAccess, PreparedChatDispatch, normalize_session_id, persist_successful_response,
    prepare_chat_dispatch,
};
pub use super::ai_validation::validate_api_key;
use super::session::ChatSessionManager;
use super::streaming::{AiProvider, OpenAiCompatibleProvider, StreamEvent, StreamSink};
pub use super::types::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage,
};

const CLOUD_AI_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);
const LOCAL_AI_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_mins(30);

struct PreparedRequestExecution {
    provider: OpenAiCompatibleProvider,
    effective_request: ChatRequest,
    request_id: String,
    message_id: String,
    timeout: std::time::Duration,
}

struct ChatStreamExecutionOptions {
    local_engine_access: LocalEngineAccess,
    message_id: Option<String>,
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
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    sink: Arc<dyn StreamSink>,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        settings_service,
        sink,
        ChatStreamExecutionOptions {
            local_engine_access: LocalEngineAccess::AutoStart,
            message_id: None,
        },
    )
    .await
}

/// Dispatches a chat request using a caller-provided assistant message id for stream events.
pub async fn process_chat_request_with_message_id(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    sink: Arc<dyn StreamSink>,
    message_id: String,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        settings_service,
        sink,
        ChatStreamExecutionOptions {
            local_engine_access: LocalEngineAccess::AutoStart,
            message_id: Some(message_id),
        },
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
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    sink: Arc<dyn StreamSink>,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        settings_service,
        sink,
        ChatStreamExecutionOptions {
            local_engine_access: LocalEngineAccess::RequireRunning,
            message_id: None,
        },
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
    settings_service: &crate::infrastructure::config::settings::SettingsService,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_non_stream_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        settings_service,
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
    settings_service: &crate::infrastructure::config::settings::SettingsService,
) -> Result<ChatResponse, crate::errors::AppError> {
    process_chat_request_non_stream_with_local_engine_access(
        request,
        sessions,
        config_service,
        engine_manager,
        settings_service,
        LocalEngineAccess::AutoStart,
    )
    .await
}

async fn process_chat_request_with_local_engine_access(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    sink: Arc<dyn StreamSink>,
    options: ChatStreamExecutionOptions,
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
        settings_service,
        options.local_engine_access,
        options.message_id,
    )
    .await?;
    let session_id = request.session_id.clone();
    let timeout_sink = Arc::clone(&sink);

    execute_prepared_request(
        execution,
        sessions,
        normalize_session_id(session_id.as_deref()),
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
    settings_service: &crate::infrastructure::config::settings::SettingsService,
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
        settings_service,
        local_engine_access,
        None,
    )
    .await?;
    let session_id = request.session_id.clone();

    execute_prepared_request(
        execution,
        sessions,
        normalize_session_id(session_id.as_deref()),
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
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    local_engine_access: LocalEngineAccess,
    message_id: Option<String>,
) -> Result<PreparedRequestExecution, crate::errors::AppError> {
    let PreparedChatDispatch {
        base_url,
        effective_request,
    } = prepare_chat_dispatch(
        request,
        sessions,
        config_service,
        engine_manager,
        settings_service,
        local_engine_access,
    )
    .await?;

    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let message_id = message_id
        .and_then(|id| {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let timeout = timeout_for_base_url(&base_url);
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
        timeout,
    })
}

fn timeout_for_base_url(base_url: &str) -> std::time::Duration {
    if crate::domain::ai::streaming::is_local_base_url(base_url) {
        LOCAL_AI_REQUEST_TIMEOUT
    } else {
        CLOUD_AI_REQUEST_TIMEOUT
    }
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
    let timeout = execution.timeout;
    let response = tokio::time::timeout(timeout, run(execution)).await;

    let response = if let Ok(result) = response {
        result
    } else {
        on_timeout(&message_id);
        Err(timeout_error(request_id, timeout))
    };

    persist_successful_response(sessions, session_id, message_id, &response).await?;
    response
}

fn timeout_error(request_id: String, timeout: std::time::Duration) -> crate::errors::AppError {
    crate::errors::AppError::Internal {
        request_id: Some(request_id),
        message: format!("AI Request timed out after {} seconds.", timeout.as_secs()),
    }
}

/// Counts tokens in text using tiktoken when the model maps to a known OpenAI tokenizer.
pub fn count_tokens(text: &str, model: Option<&str>) -> Result<usize, String> {
    use tiktoken_rs::cl100k_base;

    if let Some(model_name) = model {
        if let Some(count) = count_with_known_tiktoken_model(text, model_name) {
            return Ok(count);
        }

        if should_use_portable_token_estimate(model_name) {
            return Ok(estimate_portable_token_count(text));
        }
    }

    let bpe = cl100k_base().map_err(|e| format!("Failed to load cl100k_base tokenizer: {e}"))?;

    Ok(bpe.encode_with_special_tokens(text).len())
}

fn count_with_known_tiktoken_model(text: &str, model_name: &str) -> Option<usize> {
    use tiktoken_rs::bpe_for_model;

    if let Ok(bpe) = bpe_for_model(model_name) {
        return Some(bpe.encode_with_special_tokens(text).len());
    }

    let (_, model_id) = model_name.rsplit_once('/')?;
    if model_id == model_name {
        return None;
    }

    bpe_for_model(model_id)
        .ok()
        .map(|bpe| bpe.encode_with_special_tokens(text).len())
}

fn should_use_portable_token_estimate(model_name: &str) -> bool {
    let normalized = model_name.to_ascii_lowercase();
    [
        "llama",
        "mistral",
        "mixtral",
        "qwen",
        "deepseek",
        "gemma",
        "phi",
        "yi-",
        "codellama",
        "starcoder",
        "local",
        "gguf",
        "ollama",
        "llamacpp",
        "llama.cpp",
        "anthropic/",
        "claude",
        "google/",
        "gemini",
        "x-ai/",
        "grok",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn estimate_portable_token_count(text: &str) -> usize {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }

    let char_count = trimmed.chars().count();
    let non_ascii_count = trimmed
        .chars()
        .filter(|character| !character.is_ascii())
        .count();
    let word_count = trimmed.split_whitespace().count();
    let word_estimate = word_count + word_count.div_ceil(3);
    let char_estimate = if non_ascii_count.saturating_mul(2) >= char_count {
        char_count
    } else {
        char_count.div_ceil(3)
    };

    word_estimate.max(char_estimate).max(1)
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
    use crate::domain::ai::image_comfyui::{
        normalize_comfyui_sampler, normalize_comfyui_scheduler, parse_comfyui_checkpoint_list,
    };
    use crate::domain::ai::image_settings::{
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
        // Unknown model should fall back without error
        let count = count_tokens(
            "Testing an unknown model tokenizer",
            Some("unknown-model-xyz"),
        )
        .expect("Should fall back to a portable estimate");
        assert!(count > 0);
    }

    #[test]
    fn count_tokens_resolves_openrouter_openai_model_ids() {
        let direct = count_tokens("Hello world", Some("gpt-4.1")).expect("direct model count");
        let namespaced =
            count_tokens("Hello world", Some("openai/gpt-4.1")).expect("namespaced model count");

        assert_eq!(direct, namespaced);
    }

    #[test]
    fn count_tokens_uses_portable_estimate_for_local_models() {
        let count = count_tokens(
            "The quick brown fox jumps over the lazy dog",
            Some("meta-llama/llama-3.1-8b-instruct"),
        )
        .expect("local model count");

        assert_eq!(count, 15);
    }

    #[test]
    fn portable_token_estimate_handles_cjk_without_whitespace() {
        let text = "这是一个没有空格的中文句子";
        let count =
            count_tokens(text, Some("llamacpp/local-model")).expect("portable CJK estimate");

        assert_eq!(count, text.chars().count());
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
    fn local_chat_requests_get_longer_timeout_than_cloud_requests() {
        assert_eq!(
            timeout_for_base_url("http://127.0.0.1:8080/v1"),
            LOCAL_AI_REQUEST_TIMEOUT
        );
        assert_eq!(
            timeout_for_base_url("https://openrouter.ai/api/v1"),
            CLOUD_AI_REQUEST_TIMEOUT
        );
        assert!(LOCAL_AI_REQUEST_TIMEOUT > CLOUD_AI_REQUEST_TIMEOUT);
    }

    #[test]
    fn test_count_tokens_longer_text() {
        let text = "The quick brown fox jumps over the lazy dog";
        let count = count_tokens(text, None).expect("count_tokens longer text");
        // 9 words, likely 9-11 tokens with cl100k_base
        assert!(count >= 9, "Should produce at least 9 tokens for 9 words");
        assert!(count <= 15, "Should not wildly over-count 9 words");
    }

    #[test]
    fn test_resolve_image_setting_prefers_settings_key() {
        let mut extra_settings = HashMap::new();
        extra_settings.insert("custom_sd_steps".to_string(), "30".to_string());
        extra_settings.insert("sdcpp_steps".to_string(), "20".to_string());
        extra_settings.insert(
            "custom_sd_positive_prompt".to_string(),
            "portrait".to_string(),
        );

        let settings = AppSettings {
            extra_settings,
            ..AppSettings::default()
        };

        assert_eq!(
            resolve_u32_setting(&settings, "custom_sd", "steps"),
            Some(30)
        );
        assert_eq!(
            resolve_string_setting(&settings, "custom_sd", "positive_prompt"),
            Some("portrait".to_string())
        );
    }

    #[test]
    fn test_resolve_image_setting_does_not_read_provider_key_when_settings_key_differs() {
        let mut extra_settings = HashMap::new();
        extra_settings.insert("sdcpp_cfg_scale".to_string(), "8.5".to_string());
        extra_settings.insert("sdcpp_negative_prompt".to_string(), "blurry".to_string());

        let settings = AppSettings {
            extra_settings,
            ..AppSettings::default()
        };

        assert_eq!(
            resolve_f32_setting(&settings, "custom_sd", "cfg_scale"),
            None
        );
        assert_eq!(
            resolve_string_setting(&settings, "custom_sd", "negative_prompt"),
            None
        );
    }

    #[test]
    fn test_normalize_comfyui_sampler_maps_a1111_aliases() {
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
