use crate::errors::AppError;
use crate::models::config::*;
use crate::models::modules::ConfigField;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

pub fn get_defaults_path(_app: &AppHandle) -> Result<PathBuf, AppError> {
    let res_dir = &*crate::utils::paths::RESOURCES_DIR;

    let candidates = [
        res_dir.join("config").join("defaults.json"),
        // Fallback: Check standard dev locations explicitly if RESOURCES_DIR failed us
        PathBuf::from("src-tauri/resources/config/defaults.json"),
        PathBuf::from("resources/config/defaults.json"),
        PathBuf::from("../src-tauri/resources/config/defaults.json"),
    ];

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    log::error!("Failed to locate defaults.json. Checked: {:?}", candidates);
    Err(AppError::Config(
        "Defaults not found in any expected location".to_string(),
    ))
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, AppError> {
    // 1. Load Defaults (Disk -> Embedded Fallback)
    let content = match get_defaults_path(app) {
        Ok(path) => match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "Failed to read defaults from disk ({:?}), using embedded override: {}",
                    path,
                    e
                );
                include_str!("../../resources/config/defaults.json").to_string()
            }
        },
        Err(_) => {
            log::warn!("Defaults not found on disk, using embedded override.");
            include_str!("../../resources/config/defaults.json").to_string()
        }
    };

    let mut config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| AppError::Config(format!("Failed to parse config: {}", e)))?;

    // Ensure config.models is initialized
    if config.models.is_none() {
        config.models = Some(ConfigModels {
            gpt: HashMap::new(),
            gemini: HashMap::new(),
        });
    }

    // 2. Load API Providers (Disk -> Embedded Fallback)
    let providers_path = crate::utils::paths::RESOURCES_DIR.join("api_providers.json");

    let providers_content = if providers_path.exists() {
        std::fs::read_to_string(&providers_path).unwrap_or_else(|_| {
            log::warn!("Failed to read api_providers.json from disk, using embedded.");
            include_str!("../../resources/api_providers.json").to_string()
        })
    } else {
        log::info!("api_providers.json not found on disk, using embedded.");
        include_str!("../../resources/api_providers.json").to_string()
    };

    if let Ok(providers) = serde_json::from_str::<Vec<ApiProviderConfig>>(&providers_content) {
        config.api_providers = providers.clone();

        for provider in providers {
            // Update catalog if not present
            if !config.catalog.ai.iter().any(|m| m.id == provider.id) {
                let mut config_schema = HashMap::new();

                // 1. API Key Field (Common to all providers)
                config_schema.insert(
                    "apiKey".to_string(),
                    ConfigField {
                        field_type: "text".to_string(),
                        label: format!("{} API Key", provider.name),
                        default: Some(serde_json::Value::String("".to_string())),
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
                    config_schema: Some(config_schema),
                };
                config.catalog.ai.push(virtual_module);
            }

            // Inject models into legacy map for compatibility
            if let Some(provider_models) = provider.models
                && let Some(ref mut models_map) = config.models
            {
                if provider.id == "gpt" {
                    models_map.gpt.extend(provider_models);
                } else if provider.id == "gemini" {
                    models_map.gemini.extend(provider_models);
                }
            }
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
