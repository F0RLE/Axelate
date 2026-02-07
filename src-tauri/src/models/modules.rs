use serde::{Deserialize, Serialize};
use specta::Type;

/// Module control request from frontend
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ControlRequest {
    /// Module identifier (optional for global actions)
    pub module_id: Option<String>,
    /// Control action ("start", "stop", "restart")
    pub action: String,
}

/// Module control response to frontend
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ControlResponse {
    /// Whether the operation succeeded
    pub success: bool,
    /// Human-readable result message
    pub message: String,
    /// Current module status after operation
    pub status: Option<String>,
}

/// Complete module metadata and state
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    /// Unique module identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// User-facing description
    pub description: String,
    /// Semantic version (e.g., "1.0.0")
    pub version: String,
    /// Author username or organization
    pub author: String,
    /// Category ("ai" or "service")
    pub category: String, // "ai" or "service"
    /// Icon/emoji for UI display
    pub icon: String,
    /// Absolute filesystem path to module directory
    pub path: String, // Absolute path to module
    /// Whether module files are present locally
    pub installed: bool,
    /// Whether module is user-installed (vs. built-in)
    pub local: bool,
    /// Whether module is enabled for auto-start
    pub enabled: bool,
    /// Current runtime status ("running", "stopped", "error")
    pub status: Option<String>,
    /// Whether module can be deleted by user
    pub is_deletable: bool,
    /// Current configuration values
    pub config: std::collections::HashMap<String, serde_json::Value>, // current config values
    /// Configuration schema definition
    pub config_schema: Option<std::collections::HashMap<String, ConfigField>>, // schema definition
}

/// Configuration field schema for module settings
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigField {
    /// Field type ("text", "password", "select", "checkbox")
    pub field_type: String,
    /// Display label in UI
    pub label: String,
    /// Default value
    pub default: Option<serde_json::Value>,
    /// Whether field is required
    pub required: bool,
    /// Available options for "select" type
    pub options: Option<Vec<String>>,
}
