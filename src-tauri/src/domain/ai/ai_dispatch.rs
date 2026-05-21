use super::ai_provider_resolution::{clamp_max_tokens, resolve_cloud_provider_request};
use super::session::ChatSessionManager;
use super::types::{ChatMessage, ChatRequest, ChatResponse};
use crate::domain::engine::config::{build_default_engine_config, merge_user_engine_config};
use crate::domain::engine::manager::canonical_engine_id;
use crate::infrastructure::config::engine_settings::load_engine_config_map;

/// Default base URL for cloud API requests (OpenAI-compatible endpoint).
const DEFAULT_CLOUD_BASE_URL: &str = "https://openrouter.ai/api/v1";

#[derive(Clone, Copy)]
pub(super) enum LocalEngineAccess {
    AutoStart,
    RequireRunning,
}

pub(super) struct PreparedChatDispatch {
    pub(super) base_url: String,
    pub(super) effective_request: ChatRequest,
}

struct LocalEngineResolution {
    base_url: String,
    effective_model: String,
    messages_context: Vec<ChatMessage>,
}

pub(super) fn normalize_session_id(value: Option<&str>) -> Option<&str> {
    value
        .map(str::trim)
        .filter(|session_id| !session_id.is_empty())
}

pub(super) async fn prepare_chat_dispatch(
    request: &ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    local_engine_access: LocalEngineAccess,
) -> Result<PreparedChatDispatch, crate::errors::AppError> {
    let mut messages_context = request.messages.clone();
    if let Some(session_id) = normalize_session_id(request.session_id.as_deref()) {
        messages_context = sessions.merge_request_messages(session_id, &request.messages);
        if !request.messages.is_empty() {
            if let Err(error) = sessions.force_save().await {
                tracing::warn!(
                    session_id,
                    "Failed to persist incoming chat messages before dispatch: {error}"
                );
            }
        }
    }

    let cloud_base_url_override = request
        .cloud_api_base_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty());
    let mut base_url = cloud_base_url_override
        .unwrap_or(DEFAULT_CLOUD_BASE_URL)
        .to_string();
    let mut effective_model = request.model.clone();
    let mut model_max_tokens: Option<u32> = None;
    let mut is_local_engine = false;

    if let Some(local_resolution) = resolve_local_engine_request(
        request,
        sessions,
        engine_manager,
        settings_service,
        local_engine_access,
        &messages_context,
    )
    .await?
    {
        base_url = local_resolution.base_url;
        effective_model = local_resolution.effective_model;
        messages_context = local_resolution.messages_context;
        is_local_engine = true;
    }

    if !is_local_engine {
        resolve_cloud_provider_request(
            request,
            config_service,
            DEFAULT_CLOUD_BASE_URL,
            cloud_base_url_override,
            &mut base_url,
            &mut effective_model,
            &mut model_max_tokens,
        );
    }

    let effective_request = ChatRequest {
        messages: messages_context,
        model: effective_model,
        max_tokens: clamp_max_tokens(request.max_tokens, model_max_tokens),
        ..request.clone()
    };

    Ok(PreparedChatDispatch {
        base_url,
        effective_request,
    })
}

pub(super) async fn persist_successful_response(
    sessions: &ChatSessionManager,
    session_id: Option<&str>,
    message_id: String,
    response: &Result<ChatResponse, crate::errors::AppError>,
) -> Result<(), crate::errors::AppError> {
    if let Ok(response) = response
        && response.ok
        && let Some(reply) = &response.reply
        && let Some(session_id) = normalize_session_id(session_id)
    {
        sessions.append_response(
            session_id,
            message_id,
            reply,
            response.thought_signature.clone(),
        );
        if let Err(error) = sessions.force_save().await {
            tracing::warn!(
                session_id,
                "Failed to persist successful chat response: {error}"
            );
        }
    }

    Ok(())
}

pub(super) async fn active_local_engine_status(
    engine_manager: &crate::domain::engine::manager::EngineManager,
    provider: &str,
    capability: crate::domain::engine::types::Capability,
) -> Result<crate::domain::engine::types::EngineStatus, crate::errors::AppError> {
    match engine_manager.state().await {
        crate::domain::engine::types::EngineState::Ready { slots } => slots
            .into_iter()
            .find(|slot| {
                slot.capability == capability
                    && canonical_engine_id(&slot.engine.id) == canonical_engine_id(provider)
                    && slot.engine.healthy
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

pub(super) async fn build_engine_config(
    definition: &crate::domain::engine::types::EngineDefinition,
) -> Result<crate::domain::engine::types::EngineConfig, crate::errors::AppError> {
    let saved = load_engine_config_map().await?;
    let canonical_id = canonical_engine_id(&definition.id);
    Ok(saved.get(&canonical_id).map_or_else(
        || build_default_engine_config(definition),
        |config| merge_user_engine_config(definition, config),
    ))
}

pub(super) fn resolve_local_text_model_id(request_model: &str, model_path: Option<&str>) -> String {
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

    "default".to_string()
}

async fn resolve_local_engine_request(
    request: &ChatRequest,
    sessions: &ChatSessionManager,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    local_engine_access: LocalEngineAccess,
    prepared_messages_context: &[ChatMessage],
) -> Result<Option<LocalEngineResolution>, crate::errors::AppError> {
    let Some(definition) = engine_manager.get_definition(&request.provider).await else {
        return Ok(None);
    };

    tracing::info!(
        provider = %request.provider,
        "Detected local engine — routing through EngineManager"
    );

    let resolution = match local_engine_access {
        LocalEngineAccess::AutoStart => {
            let mut config = build_engine_config(&definition).await?;

            if !request.model.is_empty() && request.model != "default" {
                config.model_path = Some(request.model.clone());
            }

            if config.model_path.as_deref() == Some("default") {
                config.model_path = None;
            }

            let local_context_size = usize::try_from(config.context_size.max(4096)).unwrap_or(4096);
            let effective_model =
                resolve_local_text_model_id(&request.model, config.model_path.as_deref());
            let local_model_for_context = effective_model.clone();

            super::ai_service::stop_conflicting_local_engine(
                engine_manager,
                crate::domain::engine::types::Capability::Text,
            )
            .await?;

            let status = engine_manager.start(config).await?;
            let mut messages_context = prepared_messages_context.to_vec();

            if let Some(session_id) = normalize_session_id(request.session_id.as_deref()) {
                messages_context = sessions.build_local_context(
                    session_id,
                    local_context_size,
                    &local_model_for_context,
                );
            }
            prepend_local_system_prompt(&mut messages_context, settings_service, &request.provider)
                .await?;

            let base_url = format!("{}/v1", status.endpoint);
            tracing::info!(
                engine = %status.id,
                endpoint = %base_url,
                "Local engine ready"
            );

            LocalEngineResolution {
                base_url,
                effective_model,
                messages_context,
            }
        }
        LocalEngineAccess::RequireRunning => {
            let status = active_local_engine_status(
                engine_manager,
                &request.provider,
                crate::domain::engine::types::Capability::Text,
            )
            .await?;
            let base_url = format!("{}/v1", status.endpoint);
            let config = build_engine_config(&definition).await?;
            let effective_model =
                resolve_local_text_model_id(&request.model, config.model_path.as_deref());
            let local_context_size = usize::try_from(config.context_size.max(4096)).unwrap_or(4096);
            let local_model_for_context = effective_model.clone();
            let mut messages_context = prepared_messages_context.to_vec();

            if let Some(session_id) = normalize_session_id(request.session_id.as_deref()) {
                messages_context = sessions.build_local_context(
                    session_id,
                    local_context_size,
                    &local_model_for_context,
                );
            }
            prepend_local_system_prompt(&mut messages_context, settings_service, &request.provider)
                .await?;

            tracing::info!(
                engine = %status.id,
                endpoint = %base_url,
                "Using already running local engine"
            );

            LocalEngineResolution {
                base_url,
                effective_model,
                messages_context,
            }
        }
    };

    Ok(Some(resolution))
}

async fn prepend_local_system_prompt(
    messages: &mut Vec<ChatMessage>,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    provider: &str,
) -> Result<(), crate::errors::AppError> {
    if messages.iter().any(|message| message.role == "system") {
        return Ok(());
    }

    let settings = match settings_service.get_settings().await {
        Ok(settings) => settings,
        Err(error) => {
            tracing::warn!(
                provider = %provider,
                error = %error,
                "Skipping local system prompt because settings could not be loaded"
            );
            return Ok(());
        }
    };
    let canonical_provider = canonical_engine_id(provider);
    let canonical_key = format!("{canonical_provider}_system_prompt");
    let prompt = settings
        .extra_settings
        .get(&canonical_key)
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if prompt.is_empty() {
        return Ok(());
    }

    messages.insert(
        0,
        ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "system".to_string(),
            content: serde_json::Value::String(prompt.to_string()),
            thought_signature: None,
        },
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::{normalize_session_id, resolve_local_text_model_id};

    #[test]
    fn normalize_session_id_rejects_blank_values() {
        assert_eq!(normalize_session_id(None), None);
        assert_eq!(normalize_session_id(Some("")), None);
        assert_eq!(normalize_session_id(Some("   ")), None);
    }

    #[test]
    fn normalize_session_id_trims_valid_values() {
        assert_eq!(normalize_session_id(Some(" session-1 ")), Some("session-1"));
    }

    #[test]
    fn resolve_local_text_model_id_prefers_explicit_model() {
        assert_eq!(
            resolve_local_text_model_id("custom-model.gguf", Some("C:/models/default.gguf")),
            "custom-model.gguf"
        );
    }

    #[test]
    fn resolve_local_text_model_id_uses_model_file_name_for_default_request() {
        assert_eq!(
            resolve_local_text_model_id("default", Some("C:/models/chat-model.gguf")),
            "chat-model.gguf"
        );
    }

    #[test]
    fn resolve_local_text_model_id_uses_default_when_model_is_not_known() {
        assert_eq!(resolve_local_text_model_id("default", None), "default");
        assert_eq!(resolve_local_text_model_id("   ", None), "default");
    }
}
