use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomModel {
    pub id: String,
    pub name: String,
    pub provider_id: String,   // e.g. "gpt", "deepseek"
    pub base_model_id: String, // e.g. "ft:gpt-3.5-turbo:..."
    pub created_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CustomModelConfig {
    pub models: Vec<CustomModel>,
}
