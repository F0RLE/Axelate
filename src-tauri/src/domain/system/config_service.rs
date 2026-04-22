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
