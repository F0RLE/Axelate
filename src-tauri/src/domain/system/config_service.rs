use crate::domain::system::config_repository::ConfigRepository;
use crate::errors::AppError;
use crate::models::config::{AiModel, AppConfig, ModuleItem};
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

    /// Loads and hydrates the full application configuration.
    pub fn load_full_config(&self) -> Result<AppConfig, AppError> {
        let mut config = self.repo.load_defaults()?;
        let providers = self.repo.load_providers()?;

        // Hydraulic initialization of providers and catalog
        config.api_providers = providers.clone();

        for provider in &providers {
            // Update catalog if not present
            if !config.catalog.ai.iter().any(|m| m.id == provider.id) {
                let mut config_schema = HashMap::new();

                // 1. API Key Field
                config_schema.insert(
                    "apiKey".to_string(),
                    ConfigField {
                        field_type: "text".to_string(),
                        label: format!("{} API Key", provider.name),
                        default: Some(serde_json::Value::String(String::new())),
                        required: true,
                        options: None,
                    },
                );

                // 2. Endpoint for OpenAI Compatible
                if let Some(base_url) = &provider.base_url
                    && provider.provider_type == "openai-compatible"
                {
                    config_schema.insert(
                        "endpoint".to_string(),
                        ConfigField {
                            field_type: "text".to_string(),
                            label: "Endpoint URL".to_string(),
                            default: Some(serde_json::Value::String(base_url.clone())),
                            required: true,
                            options: None,
                        },
                    );
                }

                let virtual_module = ModuleItem {
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
                    repo_url: None,
                    expected_hash: None,
                    installed: true,
                    version: "1.0.0".to_string(),
                    config_schema: Some(config_schema),
                };
                config.catalog.ai.push(virtual_module);
            }

            // Legacy model mapping
            if let Some(provider_models) = &provider.models {
                let models_map = &mut config.models;
                let ai_models: HashMap<String, AiModel> = provider_models
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            AiModel {
                                desc_key: format!("model.desc.{k}"),
                                name: k.clone(),
                                desc: k.clone(),
                                pricing: vec![],
                                stats: crate::models::config::ModelStats {
                                    speed: 50,
                                    logic: 50,
                                    creative: 50,
                                },
                                api_models: Some(v.clone()),
                            },
                        )
                    })
                    .collect();

                let map_key = if provider.provider_type == "openai" {
                    "gpt"
                } else if provider.provider_type == "gemini" {
                    "gemini"
                } else {
                    &provider.id
                };

                models_map
                    .entry(map_key.to_string())
                    .or_default()
                    .extend(ai_models);
            }
        }

        // 3. Legacy LocalAI Fallback
        for module in &mut config.catalog.ai {
            if module.id == "localai" && module.config_schema.is_none() {
                let mut schema = HashMap::new();
                schema.insert(
                    "endpoint".to_string(),
                    ConfigField {
                        field_type: "text".to_string(),
                        label: "LocalAI Endpoint".to_string(),
                        default: Some(serde_json::Value::String(
                            "http://localhost:8080/v1".to_string(),
                        )),
                        required: true,
                        options: None,
                    },
                );
                schema.insert(
                    "model".to_string(),
                    ConfigField {
                        field_type: "text".to_string(),
                        label: "Model Name".to_string(),
                        default: Some(serde_json::Value::String("phi-3".to_string())),
                        required: true,
                        options: None,
                    },
                );
                module.config_schema = Some(schema);
            }
        }

        Ok(config)
    }
}
