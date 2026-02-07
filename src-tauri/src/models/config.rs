use crate::models::modules::ConfigField;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

/// API model identifiers for different capabilities
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiModelConfig {
    /// Model ID for text generation
    pub text: Option<String>,
    /// Model ID for image generation
    pub image: Option<String>,
}

/// Pricing information for an AI model tier
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    /// Pricing tier name (e.g., "Standard", "Pro")
    pub tier: String,
    /// Input token price
    #[serde(rename = "in")]
    pub price_in: Option<String>,
    /// Output token price
    #[serde(rename = "out")]
    pub price_out: Option<String>,
    /// Additional pricing notes
    pub note: Option<String>,
}

/// Performance characteristics of an AI model (0-10 scale)
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    /// Response speed rating
    pub speed: u8,
    /// Logical reasoning capability
    pub logic: u8,
    /// Creative output quality
    pub creative: u8,
}

/// Complete AI model definition
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    /// Localization key for description
    pub desc_key: String,
    /// Display name
    pub name: String,
    /// Human-readable description
    pub desc: String,
    /// Available pricing tiers
    pub pricing: Vec<ModelPricing>,
    /// Performance statistics
    pub stats: ModelStats,
    /// API model identifiers
    pub api_models: Option<ApiModelConfig>,
}

/// Catalog item for downloadable modules
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModuleItem {
    /// Unique module identifier
    pub id: String,
    /// Localization key for name
    pub name_key: String,
    /// Localization key for description
    pub desc_key: String,
    /// Display name
    pub name: String,
    /// Description text
    pub desc: String,
    /// Icon/emoji
    pub icon: String,
    /// Module type ("ai" or "service")
    #[serde(rename = "type")]
    pub type_name: String,
    /// GitHub repository URL
    pub repo_url: Option<String>,
    /// SHA-256 hash for integrity verification
    pub expected_hash: Option<String>,
    /// Whether module is currently installed (runtime only)
    #[serde(skip_deserializing, default)]
    pub installed: bool,
    /// Configuration schema definition
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<std::collections::HashMap<String, ConfigField>>,
}

/// AI model configurations grouped by provider
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ConfigModels {
    /// GPT models configuration
    pub gpt: HashMap<String, AiModel>,
    /// Gemini models configuration
    pub gemini: HashMap<String, AiModel>,
}

/// Application catalog containing available modules and services
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCatalog {
    /// AI generation modules (text, images, `LocalAI`)
    pub ai: Vec<ModuleItem>,
    /// Service integrations (Telegram, Discord)
    pub services: Vec<ModuleItem>,
}

/// Configuration for an AI API provider (OpenAI, Gemini, Claude, etc.)
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiProviderConfig {
    /// Unique identifier (e.g., "gpt", "gemini")
    pub id: String,
    /// Display name (e.g., "GPT", "Gemini")
    pub name: String,
    /// Localization key for description
    pub desc_key: Option<String>,
    /// Direct description text
    pub description: Option<String>,
    /// Icon/emoji for UI display
    pub icon: Option<String>,
    /// Provider type (e.g., "openai", "google")
    #[serde(rename = "providerType")]
    pub provider_type: String,
    /// Base URL for API endpoints
    pub base_url: Option<String>,
    /// Environment variable name for API key
    pub api_key_env: Option<String>,
    /// Available models configuration
    pub models: Option<std::collections::HashMap<String, ApiModelConfig>>,
    /// Model aliases (UI name → API ID mappings)
    pub model_aliases: Option<std::collections::HashMap<String, String>>,
}

/// Root application configuration
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Configuration version
    pub version: String,
    /// Modules catalog
    pub catalog: ConfigCatalog,
    /// API provider configurations
    pub api_providers: Option<Vec<ApiProviderConfig>>,
    /// Model definitions
    pub models: Option<ConfigModels>,
}
