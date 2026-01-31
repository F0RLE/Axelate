use crate::errors::AppError;
use crate::models::modules::ConfigField;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiModelConfig {
    pub text: Option<String>,
    pub image: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelPricing {
    pub tier: String,
    #[serde(rename = "in")]
    pub price_in: Option<String>,
    #[serde(rename = "out")]
    pub price_out: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelStats {
    pub speed: u8,
    pub logic: u8,
    pub creative: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiModel {
    #[serde(rename = "descKey")]
    pub desc_key: String,
    pub name: String,
    pub desc: String,
    pub pricing: Vec<ModelPricing>,
    pub stats: ModelStats,
    #[serde(rename = "apiModels")]
    pub api_models: Option<ApiModelConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModuleItem {
    pub id: String,
    #[serde(rename = "nameKey")]
    pub name_key: String,
    #[serde(rename = "descKey")]
    pub desc_key: String,
    pub name: String,
    pub desc: String,
    pub icon: String,
    #[serde(rename = "type")]
    pub type_name: String, // 'type' is reserved
    #[serde(rename = "repoUrl")]
    pub repo_url: Option<String>,
    #[serde(skip_deserializing, default)]
    pub installed: bool,
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<std::collections::HashMap<String, ConfigField>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigModels {
    pub gpt: HashMap<String, AiModel>,
    pub gemini: HashMap<String, AiModel>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigCatalog {
    pub ai: Vec<ModuleItem>,
    pub services: Vec<ModuleItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiProviderConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "descKey")]
    pub desc_key: Option<String>,
    pub icon: Option<String>,
    pub stats: Option<ModelStats>,
    #[serde(rename = "type")]
    pub provider_type: String,
    #[serde(rename = "baseUrl")]
    pub base_url: Option<String>,
    pub models: Option<HashMap<String, AiModel>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub catalog: ConfigCatalog,
    pub models: Option<ConfigModels>,
    #[serde(default)]
    pub api_providers: Vec<ApiProviderConfig>,
}

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
                    installed: true,
                    config_schema: None,
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

    Ok(config)
}
