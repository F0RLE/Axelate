use crate::domain::ai::{ChatMessage, WebSearchOptions};
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use crate::models::UIState;

#[derive(serde::Deserialize)]
pub(super) struct HttpAiMessage {
    pub(super) role: String,
    pub(super) content: String,
}

#[derive(serde::Deserialize)]
pub(super) struct HttpAiImageRequest {
    pub(super) prompt: String,
    pub(super) original_prompt: Option<String>,
    pub(super) provider: Option<String>,
    pub(super) model: Option<String>,
    pub(super) settings_key: Option<String>,
    pub(super) session_id: Option<String>,
    pub(super) steps: Option<u32>,
    pub(super) cfg_scale: Option<f32>,
    pub(super) width: Option<u32>,
    pub(super) height: Option<u32>,
    pub(super) sampler: Option<String>,
    pub(super) seed: Option<i32>,
    pub(super) clip_skip: Option<i32>,
    pub(super) negative_prompt: Option<String>,
    pub(super) batch_size: Option<u32>,
    pub(super) scheduler: Option<String>,
}

pub(super) fn is_local_provider(provider: &str) -> bool {
    !matches!(
        provider,
        "gpt"
            | "gemini"
            | "openai"
            | "openrouter"
            | "anthropic"
            | "mistral"
            | "claude"
            | "deepseek"
    )
}

pub(super) fn resolve_web_search_options(
    state: &UIState,
    provider: &str,
) -> Option<WebSearchOptions> {
    let enabled = state
        .ai_web_search_enabled
        .get(provider)
        .copied()
        .unwrap_or(!is_local_provider(provider));
    if !enabled {
        return None;
    }

    Some(WebSearchOptions {
        enabled: true,
        engine: Some("auto".to_string()),
        max_results: Some(5),
        max_total_results: Some(10),
        search_context_size: Some("medium".to_string()),
        allowed_domains: Vec::new(),
        excluded_domains: Vec::new(),
    })
}

pub(super) fn resolve_text_provider(state: &UIState, requested: Option<&str>) -> String {
    requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            state
                .selected_modules
                .get("ai_text")
                .map(|module| module.id.clone())
        })
        .or_else(|| state.last_active_provider.clone())
        .unwrap_or_else(|| "llamacpp".to_string())
}

pub(super) fn resolve_image_provider(state: &UIState, requested: Option<&str>) -> String {
    requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            state
                .selected_modules
                .get("ai_image")
                .map(|module| module.id.clone())
        })
        .unwrap_or_else(|| "sdcpp".to_string())
}

pub(super) fn resolve_module_text_provider(
    state: &UIState,
    requested: Option<&str>,
) -> Result<String, AppError> {
    let active_provider = state
        .selected_modules
        .get("ai_text")
        .map(|module| module.id.clone())
        .or_else(|| state.last_active_provider.clone())
        .ok_or_else(|| {
            AppError::Validation(
                "Text AI is not active in launcher. Select and launch it first.".to_string(),
            )
        })?;

    ensure_requested_provider_matches_active(&active_provider, requested)?;
    Ok(active_provider)
}

pub(super) fn resolve_module_image_provider(
    state: &UIState,
    requested: Option<&str>,
) -> Result<String, AppError> {
    let active_provider = state
        .selected_modules
        .get("ai_image")
        .map(|module| module.id.clone())
        .ok_or_else(|| {
            AppError::Validation(
                "Image AI is not active in launcher. Select and launch it first.".to_string(),
            )
        })?;

    ensure_requested_provider_matches_active(&active_provider, requested)?;
    Ok(active_provider)
}

pub(super) fn resolve_model(
    state: &UIState,
    provider: &str,
    requested: Option<&str>,
    fallback: &str,
) -> String {
    requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| state.selected_ai_models.get(provider).cloned())
        .unwrap_or_else(|| fallback.to_string())
}

pub(super) fn resolve_module_model(
    state: &UIState,
    config_service: &ConfigService,
    provider: &str,
    requested: Option<&str>,
) -> String {
    let resolved = resolve_model(state, provider, requested, "default");
    if !resolved.trim().eq_ignore_ascii_case("default") {
        return resolved;
    }

    if is_local_provider(provider) {
        return "default".to_string();
    }

    if let Ok(config) = config_service.load_full_config()
        && let Some(api_provider) = config.api_providers.iter().find(|item| item.id == provider)
        && let Some(models) = &api_provider.models
        && let Some(model) = models
            .iter()
            .find(|model| !model.deprecated.unwrap_or(false))
            .or_else(|| models.first())
    {
        return model.id.clone();
    }

    resolved
}

fn ensure_requested_provider_matches_active(
    active_provider: &str,
    requested: Option<&str>,
) -> Result<(), AppError> {
    let Some(requested) = requested.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };

    if requested == active_provider {
        return Ok(());
    }

    Err(AppError::PermissionDenied(format!(
        "Module AI access is locked to launcher-selected provider '{active_provider}', got '{requested}'"
    )))
}

pub(super) fn map_http_history(history: Option<Vec<HttpAiMessage>>) -> Vec<ChatMessage> {
    history
        .unwrap_or_default()
        .into_iter()
        .filter_map(|message| {
            let role = message.role.trim();
            let content = message.content.trim();
            if role.is_empty() || content.is_empty() {
                return None;
            }

            Some(ChatMessage {
                id: uuid::Uuid::new_v4().to_string(),
                role: role.to_string(),
                content: serde_json::Value::String(content.to_string()),
                thought_signature: None,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{
        resolve_module_image_provider, resolve_module_text_provider, resolve_text_provider,
        resolve_web_search_options,
    };
    use crate::errors::AppError;
    use crate::models::{SelectedModule, UIState};

    fn selected_module(id: &str) -> SelectedModule {
        SelectedModule {
            id: id.to_string(),
            name: id.to_string(),
            name_key: None,
            icon: String::new(),
            type_: "local".to_string(),
            desc_key: None,
            desc: String::new(),
        }
    }

    #[test]
    fn module_text_provider_requires_launcher_selection() {
        let state = UIState::default();
        let error = resolve_module_text_provider(&state, None).expect_err("must fail");
        assert!(matches!(error, AppError::Validation(_)));
    }

    #[test]
    fn web_search_defaults_enabled_for_cloud_provider() {
        let state = UIState::default();
        let options = resolve_web_search_options(&state, "gpt").expect("must exist");
        assert!(options.enabled);
        assert_eq!(options.engine.as_deref(), Some("auto"));
    }

    #[test]
    fn web_search_never_enabled_for_local_provider() {
        let state = UIState::default();
        assert!(resolve_web_search_options(&state, "llamacpp").is_none());
    }

    #[test]
    fn web_search_can_be_enabled_for_local_provider() {
        let mut state = UIState::default();
        state
            .ai_web_search_enabled
            .insert("llamacpp".to_string(), true);

        let options = resolve_web_search_options(&state, "llamacpp").expect("must exist");
        assert!(options.enabled);
    }

    #[test]
    fn module_provider_rejects_override_of_active_selection() {
        let mut state = UIState::default();
        state
            .selected_modules
            .insert("ai_text".to_string(), selected_module("llamacpp"));

        let error =
            resolve_module_text_provider(&state, Some("gpt")).expect_err("must reject mismatch");
        assert!(matches!(error, AppError::PermissionDenied(_)));
    }

    #[test]
    fn module_image_provider_uses_launcher_selected_engine() {
        let mut state = UIState::default();
        state
            .selected_modules
            .insert("ai_image".to_string(), selected_module("sdcpp"));

        let provider = resolve_module_image_provider(&state, None).expect("provider");
        assert_eq!(provider, "sdcpp");
    }

    #[test]
    fn generic_text_provider_keeps_old_fallback_behavior() {
        let state = UIState::default();
        assert_eq!(resolve_text_provider(&state, None), "llamacpp");
    }
}
