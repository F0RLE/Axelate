use serde::{Deserialize, Serialize};
use specta::Type;

/// Runtime status of a module
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum ModuleStatus {
    /// Module process is active
    Running,
    /// Module process is not active
    Stopped,
    /// Module encountered an error
    Error,
}

/// Module category
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum ModuleCategory {
    /// AI/LLM provider module
    Ai,
    /// Background service module
    Service,
}

/// Configuration field type for module settings UI
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    /// Single-line text input
    Text,
    /// Masked password input
    Password,
    /// Dropdown selection
    Select,
    /// Boolean checkbox
    Checkbox,
    /// Native boolean type
    Boolean,
    /// Numeric input
    Number,
}

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
    pub status: Option<ModuleStatus>,
}

/// Complete module metadata and state
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
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
    /// Module category (AI or service)
    pub category: ModuleCategory,
    /// Icon/emoji for UI display
    pub icon: String,
    /// Absolute filesystem path to module directory
    pub path: String,
    /// Whether module files are present locally
    pub installed: bool,
    /// Whether module is user-installed (vs. built-in)
    pub local: bool,
    /// Whether module is enabled for auto-start
    pub enabled: bool,
    /// Current runtime status
    pub status: Option<ModuleStatus>,
    /// Whether module can be deleted by user
    pub is_deletable: bool,
    /// Current configuration values
    pub config: std::collections::HashMap<String, serde_json::Value>,
    /// Configuration schema definition
    pub config_schema: Option<std::collections::HashMap<String, ConfigField>>,
}

/// Configuration field schema for module settings
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigField {
    /// Field type
    pub field_type: FieldType,
    /// Display label in UI
    pub label: String,
    /// Default value
    pub default: Option<serde_json::Value>,
    /// Whether field is required
    pub required: bool,
    /// Available options for select type
    pub options: Option<Vec<String>>,
}
