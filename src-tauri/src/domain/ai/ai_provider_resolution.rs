//! Cloud AI provider request resolution.
//!
//! Keeps provider catalog aliases, API model ids, custom model overrides, and
//! provider token caps separate from local engine dispatch.

struct CloudProviderResolution {
    base_url: String,
    effective_model: String,
    model_max_tokens: Option<u32>,
}

pub(super) fn resolve_cloud_provider_request(
    request: &super::types::ChatRequest,
    config_service: &crate::domain::system::config_service::ConfigService,
    default_base_url: &str,
    base_url_override: Option<&str>,
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
        let custom_models = config_service.load_custom_models().ok();
        let resolution = resolve_cloud_provider_values(
            &request.provider,
            &request.model,
            default_base_url,
            base_url_override,
            provider,
            custom_models.as_ref(),
        );
        base_url.clone_from(&resolution.base_url);
        effective_model.clone_from(&resolution.effective_model);
        *model_max_tokens = resolution.model_max_tokens;
    }
}

fn resolve_cloud_provider_values(
    provider_id: &str,
    request_model: &str,
    default_base_url: &str,
    base_url_override: Option<&str>,
    provider: &crate::models::config::ApiProvider,
    custom_models: Option<&crate::models::custom_models::CustomModelConfig>,
) -> CloudProviderResolution {
    let base_url = base_url_override.map_or_else(
        || {
            provider
                .base_url
                .clone()
                .unwrap_or_else(|| default_base_url.to_string())
        },
        str::to_string,
    );
    let mut effective_model = request_model.to_string();
    let mut model_max_tokens = None;

    if let Some(target) = provider
        .model_aliases
        .as_ref()
        .and_then(|aliases| aliases.get(request_model))
    {
        tracing::info!("Resolved model alias: {request_model} -> {target}");
        effective_model.clone_from(target);
    }

    if let Some(models) = &provider.models
        && let Some(definition) = models.iter().find(|model| model.id == effective_model)
    {
        model_max_tokens = definition.max_output_tokens;
        if let Some(api_model) = definition
            .api_models
            .as_ref()
            .and_then(|models| models.text.as_ref())
        {
            tracing::info!("Resolved API model ID: {effective_model} -> {api_model}");
            effective_model = api_model.clone();
        }
    }

    if let Some(custom_models) = custom_models
        && let Some(custom) = custom_models
            .models
            .iter()
            .find(|model| model.id == effective_model && model.provider_id == provider_id)
    {
        tracing::info!(
            "Resolved Custom Model: {} -> {}",
            effective_model,
            custom.base_model_id
        );
        effective_model = custom.base_model_id.clone();
    }

    CloudProviderResolution {
        base_url,
        effective_model,
        model_max_tokens,
    }
}

pub(super) fn clamp_max_tokens(
    request_limit: Option<u32>,
    model_limit: Option<u32>,
) -> Option<u32> {
    match (request_limit, model_limit) {
        (Some(request_limit), Some(model_limit)) => Some(std::cmp::min(request_limit, model_limit)),
        (None, Some(model_limit)) => Some(model_limit),
        (request_limit, None) => request_limit,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::{clamp_max_tokens, resolve_cloud_provider_values};
    use crate::models::config::{
        AiModel, ApiModelConfig, ApiProvider, ModelStats, ModelTier, ProviderType,
    };
    use crate::models::custom_models::{CustomModel, CustomModelConfig};
    use std::collections::HashMap;

    fn provider() -> ApiProvider {
        ApiProvider {
            id: "gpt".to_string(),
            name: "GPT".to_string(),
            desc_key: None,
            description: None,
            icon: None,
            provider_type: Some(ProviderType::Openai),
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key_env: None,
            models: Some(vec![AiModel {
                id: "catalog-model".to_string(),
                desc_key: String::new(),
                name: "Catalog Model".to_string(),
                desc: String::new(),
                tier: ModelTier::Strong,
                model_size: None,
                release_date: None,
                context_window: Some(128_000),
                max_output_tokens: Some(16_384),
                pricing: None,
                stats: ModelStats {
                    speed: 8,
                    logic: 9,
                    creative: 7,
                },
                capabilities: None,
                api_models: Some(ApiModelConfig {
                    text: Some("provider-text-model".to_string()),
                    image: None,
                }),
            }]),
            capabilities: Some(vec!["text".to_string()]),
            model_aliases: Some(HashMap::from([(
                "ui-model".to_string(),
                "catalog-model".to_string(),
            )])),
        }
    }

    #[test]
    fn clamp_max_tokens_respects_model_limit() {
        assert_eq!(clamp_max_tokens(Some(4_000), Some(2_000)), Some(2_000));
        assert_eq!(clamp_max_tokens(Some(1_000), Some(2_000)), Some(1_000));
        assert_eq!(clamp_max_tokens(None, Some(2_000)), Some(2_000));
        assert_eq!(clamp_max_tokens(Some(1_000), None), Some(1_000));
        assert_eq!(clamp_max_tokens(None, None), None);
    }

    #[test]
    fn resolve_cloud_provider_values_applies_alias_api_model_and_limit() {
        let resolution = resolve_cloud_provider_values(
            "gpt",
            "ui-model",
            "https://fallback.test/v1",
            None,
            &provider(),
            None,
        );

        assert_eq!(resolution.base_url, "https://api.example.test/v1");
        assert_eq!(resolution.effective_model, "provider-text-model");
        assert_eq!(resolution.model_max_tokens, Some(16_384));
    }

    #[test]
    fn resolve_cloud_provider_values_keeps_default_base_url_without_provider_url() {
        let mut provider = provider();
        provider.base_url = None;

        let resolution = resolve_cloud_provider_values(
            "gpt",
            "raw-model",
            "https://fallback.test/v1",
            None,
            &provider,
            None,
        );

        assert_eq!(resolution.base_url, "https://fallback.test/v1");
        assert_eq!(resolution.effective_model, "raw-model");
        assert_eq!(resolution.model_max_tokens, None);
    }

    #[test]
    fn resolve_cloud_provider_values_prefers_explicit_base_url_override() {
        let resolution = resolve_cloud_provider_values(
            "gpt",
            "ui-model",
            "https://fallback.test/v1",
            Some("https://api.openai.com/v1"),
            &provider(),
            None,
        );

        assert_eq!(resolution.base_url, "https://api.openai.com/v1");
        assert_eq!(resolution.effective_model, "provider-text-model");
        assert_eq!(resolution.model_max_tokens, Some(16_384));
    }

    #[test]
    fn resolve_cloud_provider_values_applies_custom_model_after_catalog_mapping() {
        let custom_models = CustomModelConfig {
            models: vec![CustomModel {
                id: "provider-text-model".to_string(),
                name: "Custom".to_string(),
                provider_id: "gpt".to_string(),
                base_model_id: "ft:gpt:custom".to_string(),
                created_at: 1.0,
            }],
        };

        let resolution = resolve_cloud_provider_values(
            "gpt",
            "ui-model",
            "https://fallback.test/v1",
            None,
            &provider(),
            Some(&custom_models),
        );

        assert_eq!(resolution.effective_model, "ft:gpt:custom");
        assert_eq!(resolution.model_max_tokens, Some(16_384));
    }
}
