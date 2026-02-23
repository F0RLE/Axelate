use crate::models::modules::ConfigField;
use bitflags::bitflags;
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

/// Pricing configuration for a model
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "snake_case")]
pub struct PricingConfig {
    /// Cost per 1M input tokens
    pub input_per_1m: Option<f64>,
    /// Cost per 1M output tokens
    pub output_per_1m: Option<f64>,
    /// Currency code
    pub currency: Option<String>,
    /// Additional notes
    pub notes: Option<String>,
}

bitflags! {
    /// Internal representation of model capabilities for bitwise logic
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    #[allow(dead_code)]
    pub struct CapabilityFlags: u32 {
        /// Supports reasoning/thinking steps (e.g., DeepSeek R1, OpenAI o1)
        const REASONING = 0b0001;
        /// Supports image input/processing
        const VISION = 0b0010;
        /// Supports standard multimodal inputs (audio/video)
        const MULTIMODAL = 0b0100;
        /// Supports context windows exceeding 128k tokens
        const LONG_CONTEXT = 0b1000;
        /// Supports native streaming of delta tokens
        const STREAMING = 0b10000;
        /// Supports structured function or tool calls
        const FUNCTION_CALLING = 0b10_0000;
    }
}

/// Model capability flags (JSON Compatible)
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    /// Supports reasoning/thinking steps
    #[serde(default)]
    pub reasoning: bool,
    /// Supports image input/vision
    #[serde(default)]
    pub vision: bool,
    /// Supports multimodal input (audio/video)
    #[serde(default)]
    pub multimodal: bool,
    /// Supports large context windows (>128k)
    #[serde(default)]
    pub long_context: bool,
    /// Supports token streaming
    #[serde(default)]
    pub streaming: bool,
    /// Supports function/tool calling
    #[serde(default)]
    pub function_calling: bool,
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

/// Tier classification for AI models
#[derive(Debug, Serialize, Deserialize, Clone, Type, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum ModelTier {
    /// Entry-level or fast models
    Weak,
    /// Balanced models
    Medium,
    /// Flagship or reasoning-heavy models
    Strong,
}

/// Complete AI model definition
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    /// Model ID (moved from dict key)
    pub id: String,
    /// Localization key for description
    #[serde(default)]
    pub desc_key: String,
    /// Display name
    pub name: String,
    /// Human-readable description
    pub desc: String,

    /// Tier classification (Weak < Medium < Strong)
    pub tier: ModelTier,
    /// Model size classification (optional)
    pub model_size: Option<String>,
    /// Release date string (YYYY-MM)
    pub release_date: Option<String>,
    /// Context window size in tokens
    pub context_window: Option<u32>,
    /// Maximum output tokens allowed
    pub max_output_tokens: Option<u32>,
    /// Whether the model is deprecated
    pub deprecated: Option<bool>,

    /// Pricing configuration (New Object Format)
    pub pricing: Option<PricingConfig>,

    /// Performance statistics
    pub stats: ModelStats,
    /// Capabilities
    pub capabilities: Option<ModelCapabilities>,

    /// API model identifiers (mapped to `apiModels` in JSON)
    pub api_models: Option<ApiModelConfig>,
}

/// Module type classification
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum ModuleType {
    /// AI/LLM provider
    Api,
    /// Locally installed module
    Local,
    /// Background service
    Service,
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
    /// Module type
    #[serde(rename = "type")]
    pub type_name: ModuleType,
    /// GitHub repository URL
    pub repo_url: Option<String>,
    /// SHA-256 hash for integrity verification
    pub expected_hash: Option<String>,
    /// Semantic version (e.g., "1.0.0")
    #[serde(default = "default_version")]
    pub version: String,
    /// Whether module is currently installed (runtime only)
    #[serde(skip_deserializing, default)]
    pub installed: bool,
    /// Configuration schema definition
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<std::collections::HashMap<String, ConfigField>>,
}

/// AI model configurations grouped by provider
pub type ConfigModels = HashMap<String, HashMap<String, AiModel>>;

/// Application catalog containing available modules and services
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCatalog {
    /// AI generation modules (text, images, `LocalAI`)
    pub ai: Vec<ModuleItem>,
    /// Service integrations (Telegram, Discord)
    pub services: Vec<ModuleItem>,
    /// Starred/Favorite module IDs
    pub stars: Vec<String>,
}

/// Type of AI provider
#[derive(Debug, Serialize, Deserialize, Clone, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    /// Standard OpenAI API
    Openai,
    /// Google Gemini API
    Google,
    /// Anthropic Claude API (via OpenRouter or direct)
    Anthropic,
    /// OpenAI-compatible local or cloud API
    #[serde(rename = "openai-compatible")]
    OpenaiCompatible,
    /// Generic API provider
    Api,
    /// Local module inference
    Local,
}

/// Configuration for an AI API provider (OpenAI, Gemini, Claude, etc.)
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiProvider {
    /// Unique identifier (e.g., "gpt", "gemini")
    pub id: String,
    /// Display name (e.g., "GPT", "Gemini")
    pub name: String,
    /// Localization key for description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desc_key: Option<String>,
    /// Direct description text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Icon/emoji for UI display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Provider type
    #[serde(rename = "type")]
    pub provider_type: Option<ProviderType>,
    /// Base URL for API endpoints
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Environment variable name for API key
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    /// Available models configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<AiModel>>,
    /// Model aliases (UI name → API ID mappings)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_aliases: Option<std::collections::HashMap<String, String>>,
}

/// Root application configuration metadata
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppMeta {
    /// Configuration version
    pub version: String,
}

/// Orchestrated application configuration
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Configuration version
    pub version: String,
    /// Available AI providers (loaded from api_providers.json)
    pub api_providers: Vec<ApiProvider>,
    /// Catalog of available apps/services (local + cloud virtual modules)
    pub catalog: ConfigCatalog,
}

fn default_version() -> String {
    "1.0.0".to_string()
}
