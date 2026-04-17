//! AI Service implementation — Service Orchestrator
//!
//! Orchestrates chat requests: resolves provider config, dispatches via the
//! `AiProvider` trait, and emits streaming events through an abstract sink.
//!
//! DTOs → [`types`] · Session management → [`session`] · Streaming → [`streaming`]

use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::domain::engine::config::{build_default_engine_config, merge_user_engine_config};
use crate::infrastructure::config::engine_settings::load_engine_config_map;

use super::session::ChatSessionManager;
use super::streaming::{AiProvider, OpenRouterProvider, StreamEvent, StreamSink};
pub use super::types::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage,
};
use super::web_grounding;

#[derive(Clone, Copy)]
enum LocalEngineAccess {
    AutoStart,
    RequireRunning,
}

fn conflicting_local_capability(
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

async fn stop_conflicting_local_engine(
    engine_manager: &crate::domain::engine::manager::EngineManager,
    capability: crate::domain::engine::types::Capability,
) -> Result<(), crate::errors::AppError> {
    let Some(conflicting_capability) = conflicting_local_capability(capability) else {
        return Ok(());
    };

    engine_manager.stop_slot(conflicting_capability).await
}

fn latest_user_query(messages: &[ChatMessage]) -> Option<String> {
    messages.iter().rev().find_map(|message| {
        if message.role != "user" {
            return None;
        }

        match &message.content {
            serde_json::Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            serde_json::Value::Array(parts) => {
                let text = parts
                    .iter()
                    .filter_map(|part| {
                        let part_type = part.get("type")?.as_str()?;
                        if part_type != "text" {
                            return None;
                        }
                        part.get("text")?.as_str().map(str::trim)
                    })
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n");

                if text.is_empty() { None } else { Some(text) }
            }
            _ => None,
        }
    })
}

fn inject_grounding_message(messages: &mut Vec<ChatMessage>, grounding_message: String) {
    let grounding = ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        role: "system".to_string(),
        content: serde_json::Value::String(grounding_message),
        thought_signature: None,
    };

    let insert_at = messages
        .iter()
        .position(|message| message.role != "system")
        .unwrap_or(messages.len());
    messages.insert(insert_at, grounding);
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

        match local_engine_access {
            LocalEngineAccess::AutoStart => {
                // Slot empty, occupied by a different engine, or different model — start or reuse
                let mut config = build_engine_config(&def).await?;

                // Override model_path from request if frontend provided one
                if !request.model.is_empty() && request.model != "default" {
                    config.model_path = Some(request.model.clone());
                }

                if config.model_path.as_deref() == Some("default") {
                    config.model_path = None;
                }

                let local_context_size =
                    usize::try_from(config.context_size.max(4096)).unwrap_or(4096);
                let local_model_for_context = config
                    .model_path
                    .clone()
                    .unwrap_or_else(|| request.model.clone());
                effective_model = resolve_local_text_model_id(
                    &request.model,
                    config.model_path.as_deref(),
                    &request.provider,
                );
                stop_conflicting_local_engine(
                    engine_manager,
                    crate::domain::engine::types::Capability::Text,
                )
                .await?;
                let status = engine_manager.start(config).await?;
                base_url = format!("{}/v1", status.endpoint);
                is_local_engine = true;

                if let Some(sid) = &request.session_id {
                    messages_context = sessions.build_local_context(
                        sid,
                        local_context_size,
                        &local_model_for_context,
                    );
                }

                tracing::info!(
                    engine = %status.id,
                    endpoint = %base_url,
                    "Local engine ready"
                );
            }
            LocalEngineAccess::RequireRunning => {
                let status = active_local_engine_status(
                    engine_manager,
                    &request.provider,
                    crate::domain::engine::types::Capability::Text,
                )
                .await?;
                base_url = format!("{}/v1", status.endpoint);
                is_local_engine = true;
                effective_model =
                    resolve_local_text_model_id(&request.model, None, &request.provider);

                tracing::info!(
                    engine = %status.id,
                    endpoint = %base_url,
                    "Using already running local engine"
                );
            }
        }
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

    if is_local_engine
        && let Some(options) = request.web_search.as_ref()
        && options.enabled
        && let Some(query) = latest_user_query(&request.messages)
        && let Some(grounding_message) =
            web_grounding::build_grounding_message(&query, options).await?
    {
        inject_grounding_message(&mut messages_context, grounding_message);
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

async fn process_chat_request_non_stream_with_local_engine_access(
    request: ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    local_engine_access: LocalEngineAccess,
) -> Result<ChatResponse, crate::errors::AppError> {
    let mut messages_context = request.messages.clone();
    if let Some(sid) = &request.session_id {
        messages_context = sessions.merge_request_messages(sid, &request.messages);
    }

    let mut base_url = "https://openrouter.ai/api/v1".to_string();
    let mut effective_model = request.model.clone();
    let mut model_max_tokens: Option<u32> = None;
    let mut is_local_engine = false;

    if let Some(def) = engine_manager.get_definition(&request.provider).await {
        tracing::info!(
            provider = %request.provider,
            "Detected local engine — routing through EngineManager"
        );

        match local_engine_access {
            LocalEngineAccess::AutoStart => {
                let mut config = build_engine_config(&def).await?;

                if !request.model.is_empty() && request.model != "default" {
                    config.model_path = Some(request.model.clone());
                }

                if config.model_path.as_deref() == Some("default") {
                    config.model_path = None;
                }

                let local_context_size =
                    usize::try_from(config.context_size.max(4096)).unwrap_or(4096);
                let local_model_for_context = config
                    .model_path
                    .clone()
                    .unwrap_or_else(|| request.model.clone());
                effective_model = resolve_local_text_model_id(
                    &request.model,
                    config.model_path.as_deref(),
                    &request.provider,
                );
                stop_conflicting_local_engine(
                    engine_manager,
                    crate::domain::engine::types::Capability::Text,
                )
                .await?;
                let status = engine_manager.start(config).await?;
                base_url = format!("{}/v1", status.endpoint);
                is_local_engine = true;

                if let Some(sid) = &request.session_id {
                    messages_context = sessions.build_local_context(
                        sid,
                        local_context_size,
                        &local_model_for_context,
                    );
                }
            }
            LocalEngineAccess::RequireRunning => {
                let status = active_local_engine_status(
                    engine_manager,
                    &request.provider,
                    crate::domain::engine::types::Capability::Text,
                )
                .await?;
                base_url = format!("{}/v1", status.endpoint);
                is_local_engine = true;
                effective_model =
                    resolve_local_text_model_id(&request.model, None, &request.provider);
            }
        }
    }

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

                if let Some(target) = p.model_aliases.as_ref().and_then(|m| m.get(&request.model)) {
                    tracing::info!("Resolved model alias: {} -> {}", request.model, target);
                    effective_model = target.clone();
                }

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

    if is_local_engine
        && let Some(options) = request.web_search.as_ref()
        && options.enabled
        && let Some(query) = latest_user_query(&request.messages)
        && let Some(grounding_message) =
            web_grounding::build_grounding_message(&query, options).await?
    {
        inject_grounding_message(&mut messages_context, grounding_message);
    }

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

    let provider = OpenRouterProvider::new(&base_url);
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(90),
        provider.generate_completion(request_id.clone(), message_id.clone(), effective_request),
    )
    .await;

    let response = if let Ok(result) = response {
        result
    } else {
        Err(crate::errors::AppError::Internal {
            request_id: Some(request_id),
            message: "AI Request timed out after 90 seconds.".to_string(),
        })
    };

    if let Ok(res) = &response
        && res.ok
        && let Some(reply) = &res.reply
        && let Some(sid) = &request.session_id
    {
        sessions.append_response(sid, message_id, reply, res.thought_signature.clone());
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
    process_image_request_with_local_engine_access(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
        LocalEngineAccess::AutoStart,
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
    process_image_request_with_local_engine_access(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
        LocalEngineAccess::RequireRunning,
    )
    .await
}

async fn process_image_request_with_local_engine_access(
    request: super::types::ImageGenerationRequest,
    sessions: &crate::domain::ai::session::ChatSessionManager,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    image_generation_state: &crate::domain::ai::ImageGenerationState,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    local_engine_access: LocalEngineAccess,
) -> Result<super::types::ImageGenerationResponse, crate::errors::AppError> {
    let request = apply_image_request_defaults(request, settings_service).await?;
    let images = if request.provider == "comfyui" {
        stop_conflicting_local_engine(
            engine_manager,
            crate::domain::engine::types::Capability::Image,
        )
        .await?;
        process_comfyui_request(&request, image_generation_state, settings_service).await?
    } else {
        let base_url;
        let preview_path: Option<std::path::PathBuf>;

        // Route only local engines for now
        if let Some(def) = engine_manager.get_definition(&request.provider).await {
            tracing::info!(
                provider = %request.provider,
                "Detected local engine for image generation"
            );

            match local_engine_access {
                LocalEngineAccess::AutoStart => {
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

                    preview_path = crate::domain::engine::manager::resolve_sdcpp_preview_path(
                        &config.extra_args,
                    );

                    stop_conflicting_local_engine(
                        engine_manager,
                        crate::domain::engine::types::Capability::Image,
                    )
                    .await?;
                    let status = engine_manager.start(config).await?;
                    base_url = status.endpoint;
                }
                LocalEngineAccess::RequireRunning => {
                    let status = active_local_engine_status(
                        engine_manager,
                        &request.provider,
                        crate::domain::engine::types::Capability::Image,
                    )
                    .await?;
                    preview_path = engine_manager.active_image_preview_path().await;
                    base_url = status.endpoint;
                }
            }
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
            .timeout(Duration::from_secs(999_999))
            .build()
            .map_err(|e| crate::errors::AppError::External {
                request_id: None,
                message: e.to_string(),
            })?;

        if let Some(preview_path) = preview_path.as_deref() {
            clear_preview_file(preview_path).await;
        }

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

        images
    };

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

        let reply = super::types::ChatReply {
            text: String::new(),
            role: "assistant".to_string(),
        };

        sessions.append_response_with_content(
            sid,
            uuid::Uuid::new_v4().to_string(),
            build_generated_image_content(&images),
            &reply.role,
            None,
        );
        let _ = sessions.force_save().await;
    }

    Ok(super::types::ImageGenerationResponse {
        images,
        ok: true,
        error: None,
    })
}

async fn active_local_engine_status(
    engine_manager: &crate::domain::engine::manager::EngineManager,
    provider: &str,
    capability: crate::domain::engine::types::Capability,
) -> Result<crate::domain::engine::types::EngineStatus, crate::errors::AppError> {
    match engine_manager.state().await {
        crate::domain::engine::types::EngineState::Ready { slots } => slots
            .into_iter()
            .find(|slot| {
                slot.capability == capability && slot.engine.id == provider && slot.engine.healthy
            })
            .map(|slot| slot.engine)
            .ok_or_else(|| {
                crate::errors::AppError::PermissionDenied(format!(
                    "Local AI engine '{provider}' is not running in launcher. Start it first."
                ))
            }),
        _ => Err(crate::errors::AppError::PermissionDenied(format!(
            "Local AI engine '{provider}' is not running in launcher. Start it first."
        ))),
    }
}

async fn process_comfyui_request(
    request: &super::types::ImageGenerationRequest,
    image_generation_state: &crate::domain::ai::ImageGenerationState,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
) -> Result<Vec<String>, crate::errors::AppError> {
    let settings = settings_service.get_settings().await?;
    let settings_key = request
        .settings_key
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| request.provider.clone());

    let base_url = normalize_comfyui_base_url(
        resolve_string_setting(&settings, &settings_key, &request.provider, "base_url")
            .as_deref()
            .unwrap_or("http://127.0.0.1:8188"),
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| crate::errors::AppError::External {
            request_id: None,
            message: error.to_string(),
        })?;
    let checkpoint =
        resolve_comfyui_checkpoint(request, &settings, &settings_key, &base_url, &client).await?;

    let sampler = normalize_comfyui_sampler(request.sampler.as_deref());
    let scheduler = normalize_comfyui_scheduler(request.scheduler.as_deref());
    let seed = normalize_comfyui_seed(request.seed);
    let steps = request.steps.unwrap_or(24);
    let cfg_scale = request.cfg_scale.unwrap_or(7.0);
    let width = request.width.unwrap_or(832);
    let height = request.height.unwrap_or(1216);
    let batch_size = request.batch_size.unwrap_or(1);
    let negative_prompt = request.negative_prompt.clone().unwrap_or_default();
    let prompt_id = uuid::Uuid::new_v4().to_string();
    let client_id = uuid::Uuid::new_v4().to_string();

    let workflow = build_comfyui_workflow(
        &request.prompt,
        &negative_prompt,
        &checkpoint,
        seed,
        steps,
        cfg_scale,
        width,
        height,
        batch_size,
        &sampler,
        &scheduler,
    );

    image_generation_state
        .begin(&request.provider, &base_url, Some(prompt_id.clone()))
        .await;

    let mut active_prompt_id = prompt_id.clone();
    let result = async {
        let response = client
            .post(format!("{base_url}/prompt"))
            .json(&serde_json::json!({
                "prompt": workflow,
                "client_id": client_id,
                "prompt_id": prompt_id,
            }))
            .send()
            .await
            .map_err(|error| crate::errors::AppError::External {
                request_id: None,
                message: format!("Failed to queue ComfyUI prompt: {error}"),
            })?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(crate::errors::AppError::External {
                request_id: None,
                message: format!("ComfyUI queue request failed: {body}"),
            });
        }

        let queue_body: serde_json::Value =
            response
                .json()
                .await
                .map_err(|error| crate::errors::AppError::External {
                    request_id: None,
                    message: format!("Failed to parse ComfyUI queue response: {error}"),
                })?;

        if let Some(server_prompt_id) = queue_body.get("prompt_id").and_then(|value| value.as_str())
            && !server_prompt_id.trim().is_empty()
        {
            active_prompt_id = server_prompt_id.to_string();
            image_generation_state
                .update_prompt_id(&request.provider, active_prompt_id.clone())
                .await;
        }

        if let Some(message) = extract_comfyui_queue_error(&queue_body) {
            return Err(crate::errors::AppError::External {
                request_id: None,
                message,
            });
        }

        wait_for_comfyui_images(
            &client,
            &base_url,
            &request.provider,
            &active_prompt_id,
            image_generation_state,
        )
        .await
    }
    .await;

    image_generation_state
        .clear(&request.provider, Some(active_prompt_id.as_str()))
        .await;

    result
}

async fn resolve_comfyui_checkpoint(
    request: &super::types::ImageGenerationRequest,
    settings: &crate::models::AppSettings,
    settings_key: &str,
    base_url: &str,
    client: &reqwest::Client,
) -> Result<String, crate::errors::AppError> {
    if !request.model.trim().is_empty() && request.model != "default" {
        return Ok(normalize_comfyui_checkpoint(&request.model));
    }

    if let Some(saved_checkpoint) =
        resolve_string_setting(settings, settings_key, &request.provider, "checkpoint")
    {
        return Ok(normalize_comfyui_checkpoint(&saved_checkpoint));
    }

    let available_checkpoints = fetch_comfyui_checkpoints(client, base_url).await?;
    if let Some(checkpoint) = available_checkpoints.first() {
        return Ok(normalize_comfyui_checkpoint(checkpoint));
    }

    Err(crate::errors::AppError::Config(
        "ComfyUI does not expose any checkpoints yet. Install a model in ComfyUI and try again."
            .to_string(),
    ))
}

fn normalize_comfyui_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "http://127.0.0.1:8188".to_string();
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }

    format!("http://{trimmed}")
}

fn normalize_comfyui_checkpoint(raw: &str) -> String {
    raw.trim()
        .replace('\\', "/")
        .split('/')
        .next_back()
        .unwrap_or(raw)
        .trim()
        .to_string()
}

fn normalize_comfyui_sampler(value: Option<&str>) -> String {
    match value.unwrap_or("euler").trim().to_lowercase().as_str() {
        "euler a" | "euler_a" | "euler ancestral" | "euler_ancestral" => {
            "euler_ancestral".to_string()
        }
        "euler" => "euler".to_string(),
        "heun" => "heun".to_string(),
        "heunpp2" => "heunpp2".to_string(),
        "dpm2" | "dpm 2" | "dpm_2" => "dpm_2".to_string(),
        "dpm2 a" | "dpm2_a" | "dpm 2 ancestral" | "dpm_2_ancestral" => {
            "dpm_2_ancestral".to_string()
        }
        "lms" => "lms".to_string(),
        "dpm fast" | "dpm_fast" => "dpm_fast".to_string(),
        "dpm adaptive" | "dpm_adaptive" => "dpm_adaptive".to_string(),
        "dpm++ 2s a" | "dpm++2s_a" | "dpmpp_2s_a" | "dpmpp_2s_ancestral" => {
            "dpmpp_2s_ancestral".to_string()
        }
        "dpm++ sde" | "dpmpp_sde" => "dpmpp_sde".to_string(),
        "dpm++ sde gpu" | "dpmpp_sde_gpu" => "dpmpp_sde_gpu".to_string(),
        "dpm++ 2m" | "dpm++2m" | "dpmpp_2m" => "dpmpp_2m".to_string(),
        "dpm++ 2m sde" | "dpm++2m sde" | "dpmpp_2m_sde" => "dpmpp_2m_sde".to_string(),
        "dpm++ 3m sde" | "dpm++3m sde" | "dpmpp_3m_sde" => "dpmpp_3m_sde".to_string(),
        "dpm++ 3m sde gpu" | "dpm++3m sde gpu" | "dpmpp_3m_sde_gpu" => {
            "dpmpp_3m_sde_gpu".to_string()
        }
        "ddpm" => "ddpm".to_string(),
        "lcm" => "lcm".to_string(),
        "ipndm" => "ipndm".to_string(),
        "ipndm_v" => "ipndm_v".to_string(),
        "deis" => "deis".to_string(),
        "ddim" => "ddim".to_string(),
        "uni pc" | "uni_pc" => "uni_pc".to_string(),
        "uni pc bh2" | "uni_pc_bh2" => "uni_pc_bh2".to_string(),
        other => other.to_string(),
    }
}

fn normalize_comfyui_scheduler(value: Option<&str>) -> String {
    match value.unwrap_or("karras").trim().to_lowercase().as_str() {
        "default" | "auto" | "karras" => "karras".to_string(),
        "normal" => "normal".to_string(),
        "simple" => "simple".to_string(),
        "sgm uniform" | "sgm_uniform" => "sgm_uniform".to_string(),
        "exponential" => "exponential".to_string(),
        "ddim uniform" | "ddim_uniform" => "ddim_uniform".to_string(),
        "beta" => "beta".to_string(),
        "linear quadratic" | "linear_quadratic" => "linear_quadratic".to_string(),
        "kl optimal" | "kl_optimal" => "kl_optimal".to_string(),
        other => other.to_string(),
    }
}

fn normalize_comfyui_seed(value: Option<i32>) -> u64 {
    match value {
        Some(seed) if seed >= 0 => u64::from(seed.unsigned_abs()),
        _ => rand::random::<u64>(),
    }
}

async fn fetch_comfyui_checkpoints(
    client: &reqwest::Client,
    base_url: &str,
) -> Result<Vec<String>, crate::errors::AppError> {
    let response = client
        .get(format!("{base_url}/models/checkpoints"))
        .send()
        .await
        .map_err(|error| crate::errors::AppError::External {
            request_id: None,
            message: format!("Failed to query ComfyUI checkpoints: {error}"),
        })?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(crate::errors::AppError::External {
            request_id: None,
            message: format!("ComfyUI checkpoints request failed: {body}"),
        });
    }

    let payload: serde_json::Value =
        response
            .json()
            .await
            .map_err(|error| crate::errors::AppError::External {
                request_id: None,
                message: format!("Failed to parse ComfyUI checkpoint list: {error}"),
            })?;

    Ok(parse_comfyui_checkpoint_list(&payload))
}

fn parse_comfyui_checkpoint_list(payload: &serde_json::Value) -> Vec<String> {
    fn extract_checkpoint_name(value: &serde_json::Value) -> Option<String> {
        if let Some(name) = value.as_str() {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        let object = value.as_object()?;
        for key in ["name", "filename", "path"] {
            if let Some(candidate) = object.get(key).and_then(|entry| entry.as_str()) {
                let trimmed = candidate.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }

        None
    }

    let values = if let Some(items) = payload.as_array() {
        items.iter().collect::<Vec<_>>()
    } else if let Some(items) = payload.get("models").and_then(|value| value.as_array()) {
        items.iter().collect::<Vec<_>>()
    } else if let Some(items) = payload.get("files").and_then(|value| value.as_array()) {
        items.iter().collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .filter_map(extract_checkpoint_name)
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn build_comfyui_workflow(
    prompt: &str,
    negative_prompt: &str,
    checkpoint: &str,
    seed: u64,
    steps: u32,
    cfg_scale: f32,
    width: u32,
    height: u32,
    batch_size: u32,
    sampler: &str,
    scheduler: &str,
) -> serde_json::Value {
    serde_json::json!({
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": cfg_scale,
                "denoise": 1.0,
                "latent_image": ["5", 0],
                "model": ["4", 0],
                "negative": ["7", 0],
                "positive": ["6", 0],
                "sampler_name": sampler,
                "scheduler": scheduler,
                "seed": seed,
                "steps": steps
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": checkpoint
            }
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "batch_size": batch_size,
                "height": height,
                "width": width
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["4", 1],
                "text": prompt
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["4", 1],
                "text": negative_prompt
            }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "Axelate",
                "images": ["8", 0]
            }
        }
    })
}

async fn wait_for_comfyui_images(
    client: &reqwest::Client,
    base_url: &str,
    provider: &str,
    prompt_id: &str,
    image_generation_state: &crate::domain::ai::ImageGenerationState,
) -> Result<Vec<String>, crate::errors::AppError> {
    let deadline = Instant::now() + Duration::from_secs(600);

    loop {
        if image_generation_state
            .is_cancelled(provider, Some(prompt_id))
            .await
        {
            return Err(crate::errors::AppError::External {
                request_id: None,
                message: "Image generation cancelled".to_string(),
            });
        }

        let response = client
            .get(format!("{base_url}/history/{prompt_id}"))
            .send()
            .await
            .map_err(|error| crate::errors::AppError::External {
                request_id: None,
                message: format!("Failed to poll ComfyUI history: {error}"),
            })?;

        if response.status().is_success() {
            let history_body: serde_json::Value =
                response
                    .json()
                    .await
                    .map_err(|error| crate::errors::AppError::External {
                        request_id: None,
                        message: format!("Failed to parse ComfyUI history: {error}"),
                    })?;

            if let Some(entry) = history_body.get(prompt_id) {
                let images = fetch_comfyui_history_images(client, base_url, entry).await?;
                if !images.is_empty() {
                    return Ok(images);
                }
            }
        }

        if Instant::now() >= deadline {
            return Err(crate::errors::AppError::External {
                request_id: None,
                message: "ComfyUI image generation timed out".to_string(),
            });
        }

        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

async fn fetch_comfyui_history_images(
    client: &reqwest::Client,
    base_url: &str,
    history_entry: &serde_json::Value,
) -> Result<Vec<String>, crate::errors::AppError> {
    let mut images = Vec::new();
    let Some(outputs) = history_entry
        .get("outputs")
        .and_then(|value| value.as_object())
    else {
        return Ok(images);
    };

    for node_output in outputs.values() {
        let Some(node_images) = node_output.get("images").and_then(|value| value.as_array()) else {
            continue;
        };

        for image_meta in node_images {
            let Some(filename) = image_meta.get("filename").and_then(|value| value.as_str()) else {
                continue;
            };

            let subfolder = image_meta
                .get("subfolder")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let image_type = image_meta
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("output");
            let mut image_url =
                reqwest::Url::parse(&format!("{base_url}/view")).map_err(|error| {
                    crate::errors::AppError::External {
                        request_id: None,
                        message: format!("Failed to build ComfyUI image URL: {error}"),
                    }
                })?;
            {
                let mut query = image_url.query_pairs_mut();
                query.append_pair("filename", filename);
                if !subfolder.is_empty() {
                    query.append_pair("subfolder", subfolder);
                }
                query.append_pair("type", image_type);
            }

            let response = client.get(image_url).send().await.map_err(|error| {
                crate::errors::AppError::External {
                    request_id: None,
                    message: format!("Failed to fetch ComfyUI image: {error}"),
                }
            })?;

            if !response.status().is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(crate::errors::AppError::External {
                    request_id: None,
                    message: format!("ComfyUI image download failed: {body}"),
                });
            }

            let mime_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("image/png")
                .to_string();
            let bytes =
                response
                    .bytes()
                    .await
                    .map_err(|error| crate::errors::AppError::External {
                        request_id: None,
                        message: format!("Failed to read ComfyUI image bytes: {error}"),
                    })?;

            images.push(format!(
                "data:{mime_type};base64,{}",
                STANDARD.encode(bytes)
            ));
        }
    }

    Ok(images)
}

fn extract_comfyui_queue_error(body: &serde_json::Value) -> Option<String> {
    if let Some(error_message) = body.get("error").and_then(|value| value.as_str()) {
        return Some(format!("ComfyUI queue error: {error_message}"));
    }

    let node_errors = body.get("node_errors")?;
    if !node_errors.is_object()
        || node_errors
            .as_object()
            .is_some_and(serde_json::Map::is_empty)
    {
        return None;
    }

    Some(format!("ComfyUI node validation failed: {node_errors}"))
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

async fn clear_preview_file(path: &Path) {
    if let Err(error) = tokio::fs::remove_file(path).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::debug!(
            "Failed to clear stale preview file {}: {error}",
            path.display()
        );
    }
}

fn build_generated_image_content(images: &[String]) -> serde_json::Value {
    serde_json::Value::Array(
        images
            .iter()
            .map(|image| {
                serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": image
                    }
                })
            })
            .collect(),
    )
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

fn resolve_local_text_model_id(
    request_model: &str,
    model_path: Option<&str>,
    provider: &str,
) -> String {
    let requested = request_model.trim();
    if !requested.is_empty() && requested != "default" {
        return requested.to_string();
    }

    if let Some(path) = model_path {
        let path = std::path::Path::new(path);
        if let Some(file_name) = path.file_name().and_then(|value| value.to_str()) {
            return file_name.to_string();
        }
    }

    provider.to_string()
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
    fn test_latest_user_query_supports_string_and_multimodal_content() {
        let messages = vec![
            ChatMessage {
                id: "1".to_string(),
                role: "assistant".to_string(),
                content: serde_json::Value::String("old".to_string()),
                thought_signature: None,
            },
            ChatMessage {
                id: "2".to_string(),
                role: "user".to_string(),
                content: serde_json::json!([
                    { "type": "text", "text": "найди свежие новости по Rust" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,abc" } }
                ]),
                thought_signature: None,
            },
        ];

        assert_eq!(
            latest_user_query(&messages).as_deref(),
            Some("найди свежие новости по Rust")
        );
    }

    #[test]
    fn test_inject_grounding_message_preserves_system_prefix() {
        let mut messages = vec![
            ChatMessage {
                id: "1".to_string(),
                role: "system".to_string(),
                content: serde_json::Value::String("base rules".to_string()),
                thought_signature: None,
            },
            ChatMessage {
                id: "2".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("query".to_string()),
                thought_signature: None,
            },
        ];

        inject_grounding_message(&mut messages, "grounding".to_string());

        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].role, "system");
        assert_eq!(messages[2].role, "user");
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
