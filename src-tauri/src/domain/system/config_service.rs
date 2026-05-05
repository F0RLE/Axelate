use crate::domain::system::config_repository::ConfigRepository;
use crate::errors::AppError;
use crate::models::config::{AppConfig, ModuleItem};
use crate::models::modules::ConfigField;
use std::collections::HashMap;

/// Service for orchestrating configuration loading and merging.
#[derive(Debug)]
pub struct ConfigService {
    repo: Box<dyn ConfigRepository>,
}

impl ConfigService {
    /// Creates a new ConfigService with the given repository.
    pub fn new(repo: Box<dyn ConfigRepository>) -> Self {
        Self { repo }
    }

    /// Helper to create a standard text configuration field.
    fn text_field(label: &str, default: Option<&str>, required: bool) -> ConfigField {
        ConfigField {
            field_type: "text".to_string(),
            label: label.to_string(),
            description: None,
            placeholder: None,
            default: default.map(|s| serde_json::Value::String(s.to_string())),
            required,
            min: None,
            max: None,
            step: None,
            rows: None,
            section: None,
            order: None,
            options: None,
        }
    }

    /// Loads and hydrates the full application configuration.
    pub fn load_full_config(&self) -> Result<AppConfig, AppError> {
        let app_meta = self.repo.load_app_meta()?;
        let providers = self.repo.load_api_providers()?;
        let local_modules = self.repo.load_local_modules()?;

        let mut ai_catalog = Vec::new();

        // 1. Process API Providers (Auto-generate virtual modules)
        for provider in &providers {
            let mut config_schema = HashMap::new();
            let capabilities = provider
                .capabilities
                .clone()
                .filter(|items| !items.is_empty())
                .unwrap_or_else(|| vec!["text".to_string()]);

            // API Key is always required for cloud providers
            config_schema.insert(
                "apiKey".to_string(),
                Self::text_field(&format!("{} API Key", provider.name), None, true),
            );

            // Add endpoint field if relevant to the provider type
            use crate::models::config::ProviderType::{Api, OpenaiCompatible};
            if let Some(p_type) = &provider.provider_type
                && matches!(p_type, OpenaiCompatible | Api)
                && let Some(base_url) = &provider.base_url
            {
                config_schema.insert(
                    "endpoint".to_string(),
                    Self::text_field("Endpoint URL", Some(base_url), true),
                );
            }

            ai_catalog.push(ModuleItem {
                id: provider.id.clone(),
                name_key: format!("ui.module.{}", provider.id),
                desc_key: provider
                    .desc_key
                    .clone()
                    .unwrap_or_else(|| "ui.module.desc_generic".to_string()),
                name: provider.name.clone(),
                desc: provider
                    .description
                    .clone()
                    .unwrap_or_else(|| "Cloud AI Provider".to_string()),
                icon: provider.icon.clone().unwrap_or_else(|| "cloud".to_string()),
                preview: None,
                type_name: "api".to_string(),
                dl_type: None,
                capabilities,
                binary: None,
                raw_config_schema: None,
                repo_url: None,
                expected_hash: None,
                coming_soon: false,
                managed_externally: false,
                installed: true,
                version: "1.0.0".to_string(),
                config_schema: Some(config_schema),
            });
        }

        let mut service_catalog = Vec::new();

        // 2. Add Local Modules (Distribute by type)
        for item in local_modules {
            match item.type_name.as_str() {
                "service" | "script" => service_catalog.push(item),
                _ => ai_catalog.push(item), // "local", "api", etc. → AI catalog
            }
        }

        Ok(AppConfig {
            version: app_meta.version,
            api_providers: providers,
            catalog: crate::models::config::ConfigCatalog {
                ai: ai_catalog,
                services: service_catalog,
                stars: Vec::new(),
            },
        })
    }

    /// Loads custom user-created models configuration
    pub fn load_custom_models(
        &self,
    ) -> Result<crate::models::custom_models::CustomModelConfig, AppError> {
        self.repo.load_custom_models()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::ConfigService;
    use crate::domain::system::config_repository::ConfigRepository;
    use crate::errors::AppError;
    use crate::models::config::{ApiProvider, AppMeta, ConfigCatalog, ModuleItem, ProviderType};
    use crate::models::custom_models::{CustomModel, CustomModelConfig};
    use serde_json::json;

    #[derive(Debug)]
    struct FakeConfigRepository {
        providers: Vec<ApiProvider>,
        local_modules: Vec<ModuleItem>,
        custom_models: CustomModelConfig,
    }

    impl ConfigRepository for FakeConfigRepository {
        fn load_app_meta(&self) -> Result<AppMeta, AppError> {
            Ok(AppMeta {
                version: "9.9.9".to_string(),
            })
        }

        fn load_api_providers(&self) -> Result<Vec<ApiProvider>, AppError> {
            Ok(self.providers.clone())
        }

        fn load_local_modules(&self) -> Result<Vec<ModuleItem>, AppError> {
            Ok(self.local_modules.clone())
        }

        fn load_custom_models(&self) -> Result<CustomModelConfig, AppError> {
            Ok(self.custom_models.clone())
        }
    }

    fn provider(
        id: &str,
        provider_type: Option<ProviderType>,
        base_url: Option<&str>,
        capabilities: Option<Vec<&str>>,
    ) -> ApiProvider {
        ApiProvider {
            id: id.to_string(),
            name: format!("{id} Provider"),
            desc_key: None,
            description: None,
            icon: None,
            provider_type,
            base_url: base_url.map(str::to_string),
            api_key_env: None,
            models: None,
            capabilities: capabilities.map(|items| items.into_iter().map(str::to_string).collect()),
            model_aliases: None,
        }
    }

    fn module(value: serde_json::Value) -> ModuleItem {
        serde_json::from_value(value).unwrap()
    }

    fn service(repo: FakeConfigRepository) -> ConfigService {
        ConfigService::new(Box::new(repo))
    }

    #[test]
    fn load_full_config_hydrates_api_provider_modules() {
        let service = service(FakeConfigRepository {
            providers: vec![
                provider(
                    "openai-compatible",
                    Some(ProviderType::OpenaiCompatible),
                    Some("https://example.test/v1"),
                    None,
                ),
                provider(
                    "image-api",
                    Some(ProviderType::Api),
                    None,
                    Some(vec!["image"]),
                ),
            ],
            local_modules: Vec::new(),
            custom_models: CustomModelConfig::default(),
        });

        let config = service.load_full_config().unwrap();
        let compatible = config
            .catalog
            .ai
            .iter()
            .find(|item| item.id == "openai-compatible")
            .unwrap();
        let image_api = config
            .catalog
            .ai
            .iter()
            .find(|item| item.id == "image-api")
            .unwrap();
        let schema = compatible.config_schema.as_ref().unwrap();

        assert_eq!(config.version, "9.9.9");
        assert!(compatible.installed);
        assert_eq!(compatible.capabilities, vec!["text"]);
        assert!(schema.contains_key("apiKey"));
        assert_eq!(
            schema
                .get("endpoint")
                .and_then(|field| field.default.as_ref()),
            Some(&json!("https://example.test/v1"))
        );
        assert_eq!(image_api.capabilities, vec!["image"]);
        assert!(
            image_api
                .config_schema
                .as_ref()
                .unwrap()
                .contains_key("apiKey")
        );
        assert!(
            !image_api
                .config_schema
                .as_ref()
                .unwrap()
                .contains_key("endpoint")
        );
    }

    #[test]
    fn load_full_config_routes_local_modules_by_type() {
        let service = service(FakeConfigRepository {
            providers: Vec::new(),
            local_modules: vec![
                module(json!({
                    "id": "local-ai",
                    "nameKey": "ui.module.local_ai",
                    "descKey": "ui.module.local_ai.desc",
                    "name": "Local AI",
                    "desc": "Local model",
                    "icon": "cpu",
                    "type": "local",
                    "repoUrl": null,
                    "expectedHash": null
                })),
                module(json!({
                    "id": "service-module",
                    "nameKey": "ui.module.service",
                    "descKey": "ui.module.service.desc",
                    "name": "Service",
                    "desc": "Service module",
                    "icon": "plug",
                    "type": "service",
                    "repoUrl": null,
                    "expectedHash": null
                })),
            ],
            custom_models: CustomModelConfig::default(),
        });

        let ConfigCatalog {
            ai,
            services,
            stars,
        } = service.load_full_config().unwrap().catalog;

        assert_eq!(ai.len(), 1);
        assert_eq!(ai.first().map(|item| item.id.as_str()), Some("local-ai"));
        assert_eq!(services.len(), 1);
        assert_eq!(
            services.first().map(|item| item.id.as_str()),
            Some("service-module")
        );
        assert!(stars.is_empty());
    }

    #[test]
    fn load_custom_models_delegates_to_repository() {
        let custom_models = CustomModelConfig {
            models: vec![CustomModel {
                id: "custom".to_string(),
                name: "Custom".to_string(),
                provider_id: "gpt".to_string(),
                base_model_id: "base".to_string(),
                created_at: 123.0,
            }],
        };
        let service = service(FakeConfigRepository {
            providers: Vec::new(),
            local_modules: Vec::new(),
            custom_models,
        });

        let loaded = service.load_custom_models().unwrap();

        assert_eq!(loaded.models.len(), 1);
        assert_eq!(
            loaded.models.first().map(|model| model.id.as_str()),
            Some("custom")
        );
    }
}
