use crate::models::modules::ConfigField;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiModelConfig {
    pub text: Option<String>,
    pub image: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    pub tier: String,
    #[serde(rename = "in")]
    pub price_in: Option<String>,
    #[serde(rename = "out")]
    pub price_out: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    pub speed: u8,
    pub logic: u8,
    pub creative: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub desc_key: String,
    pub name: String,
    pub desc: String,
    pub pricing: Vec<ModelPricing>,
    pub stats: ModelStats,
    pub api_models: Option<ApiModelConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleItem {
    pub id: String,
    pub name_key: String,
    pub desc_key: String,
    pub name: String,
    pub desc: String,
    pub icon: String,
    #[serde(rename = "type")]
    pub type_name: String, // 'type' is reserved
    pub repo_url: Option<String>,
    pub expected_hash: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct ConfigCatalog {
    pub ai: Vec<ModuleItem>,
    pub services: Vec<ModuleItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiProviderConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub desc_key: Option<String>,
    pub icon: Option<String>,
    pub stats: Option<ModelStats>,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub base_url: Option<String>,
    pub models: Option<HashMap<String, AiModel>>,
    #[serde(default)]
    pub model_aliases: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub catalog: ConfigCatalog,
    pub models: Option<ConfigModels>,
    #[serde(default)]
    pub api_providers: Vec<ApiProviderConfig>,
}
