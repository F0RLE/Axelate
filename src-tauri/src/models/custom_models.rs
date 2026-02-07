use serde::{Deserialize, Serialize};
use specta::Type;

/// User-created fine-tuned or custom AI model
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct CustomModel {
    /// Unique identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// Provider ID (e.g., "gpt", "deepseek")
    pub provider_id: String,
    /// Base model identifier (e.g., "ft:gpt-3.5-turbo:...")
    pub base_model_id: String,
    /// Creation timestamp (Unix epoch)
    pub created_at: u64,
}

/// Configuration for all custom models
#[derive(Debug, Serialize, Deserialize, Clone, Default, Type)]
pub struct CustomModelConfig {
    /// List of custom models
    pub models: Vec<CustomModel>,
}
