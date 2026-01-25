use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ControlRequest {
    pub module_id: Option<String>,
    pub action: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ControlResponse {
    pub success: bool,
    pub message: String,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub version: String,
    pub status: String,
    pub config_schema: Option<std::collections::HashMap<String, ConfigField>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigField {
    #[serde(rename = "type")]
    pub field_type: String,
    pub label: String,
    pub default: Option<serde_json::Value>,
    pub required: bool,
    pub options: Option<Vec<String>>,
}
