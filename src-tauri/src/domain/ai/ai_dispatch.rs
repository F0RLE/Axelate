use super::session::ChatSessionManager;
use super::types::{ChatMessage, ChatRequest, ChatResponse};
use crate::domain::engine::config::{build_default_engine_config, merge_user_engine_config};
use crate::domain::engine::manager::canonical_engine_id;
use crate::infrastructure::config::engine_settings::load_engine_config_map;

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

pub(super) async fn prepare_chat_dispatch(
    request: &ChatRequest,
    sessions: &ChatSessionManager,
    config_service: &crate::domain::system::config_service::ConfigService,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    local_engine_access: LocalEngineAccess,
) -> Result<PreparedChatDispatch, crate::errors::AppError> {
    let mut messages_context = request.messages.clone();
    if let Some(session_id) = &request.session_id {
        messages_context = sessions.merge_request_messages(session_id, &request.messages);
    }

    let mut base_url = "https://openrouter.ai/api/v1".to_string();
    let mut effective_model = request.model.clone();
    let mut model_max_tokens: Option<u32> = None;
    let mut is_local_engine = false;

    if let Some(local_resolution) = resolve_local_engine_request(
        request,
        sessions,
        engine_manager,
        settings_service,
        local_engine_access,
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
) {
    if let Ok(response) = response
        && response.ok
        && let Some(reply) = &response.reply
        && let Some(session_id) = session_id
    {
        sessions.append_response(
            session_id,
            message_id,
            reply,
            response.thought_signature.clone(),
        );
    }
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
    Ok(saved.get(canonical_id).map_or_else(
        || build_default_engine_config(definition),
        |config| merge_user_engine_config(definition, config),
    ))
}

pub(super) fn resolve_local_text_model_id(
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

async fn resolve_local_engine_request(
    request: &ChatRequest,
    sessions: &ChatSessionManager,
    engine_manager: &crate::domain::engine::manager::EngineManager,
    settings_service: &crate::infrastructure::config::settings::SettingsService,
    local_engine_access: LocalEngineAccess,
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
            let local_model_for_context = config
                .model_path
                .clone()
                .unwrap_or_else(|| request.model.clone());
            let effective_model = resolve_local_text_model_id(
                &request.model,
                config.model_path.as_deref(),
                &request.provider,
            );

            super::ai_service::stop_conflicting_local_engine(
                engine_manager,
                crate::domain::engine::types::Capability::Text,
            )
            .await?;

            let status = engine_manager.start(config).await?;
            let mut messages_context = request.messages.clone();

            if let Some(session_id) = &request.session_id {
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
            let effective_model =
                resolve_local_text_model_id(&request.model, None, &request.provider);
            let config = build_engine_config(&definition).await?;
            let local_context_size = usize::try_from(config.context_size.max(4096)).unwrap_or(4096);
            let local_model_for_context = config
                .model_path
                .clone()
                .unwrap_or_else(|| request.model.clone());
            let mut messages_context = request.messages.clone();

            if let Some(session_id) = &request.session_id {
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
    let key = format!("{provider}_system_prompt");
    let prompt = settings
        .extra_settings
        .get(&key)
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

fn resolve_cloud_provider_request(
    request: &ChatRequest,
    config_service: &crate::domain::system::config_service::ConfigService,
    base_url: &mut String,
    effective_model: &mut String,
    model_max_tokens: &mut Option<u32>,
) {
    if let Ok(config) = config_service.load_full_config()
        && let Some(provider) = config
            .api_providers
            .iter()
            .find(|provider| provider.id == request.provider)
    {
        if let Some(url) = &provider.base_url {
            base_url.clone_from(url);
        }

        if let Some(target) = provider
            .model_aliases
            .as_ref()
            .and_then(|aliases| aliases.get(&request.model))
        {
            tracing::info!("Resolved model alias: {} -> {}", request.model, target);
            effective_model.clone_from(target);
        }

        if let Some(models) = &provider.models
            && let Some(definition) = models.iter().find(|model| model.id == *effective_model)
        {
            *model_max_tokens = definition.max_output_tokens;
            if let Some(api_model) = definition
                .api_models
                .as_ref()
                .and_then(|models| models.text.as_ref())
            {
                tracing::info!("Resolved API model ID: {effective_model} -> {api_model}");
                *effective_model = api_model.clone();
            }
        }
    }

    if let Ok(custom_models) = config_service.load_custom_models()
        && let Some(custom) = custom_models
            .models
            .iter()
            .find(|model| model.id == *effective_model && model.provider_id == request.provider)
    {
        tracing::info!(
            "Resolved Custom Model: {} -> {}",
            effective_model,
            custom.base_model_id
        );
        *effective_model = custom.base_model_id.clone();
    }
}

fn clamp_max_tokens(request_limit: Option<u32>, model_limit: Option<u32>) -> Option<u32> {
    match (request_limit, model_limit) {
        (Some(request_limit), Some(model_limit)) => Some(std::cmp::min(request_limit, model_limit)),
        (None, Some(model_limit)) => Some(model_limit),
        (request_limit, None) => request_limit,
    }
}
