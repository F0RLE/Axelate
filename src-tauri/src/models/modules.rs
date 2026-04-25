use serde::{Deserialize, Serialize};
use specta::Type;

/// Module-owned card preview metadata.
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModulePreview {
    /// Optional card title override.
    #[serde(default)]
    pub title: Option<String>,
    /// Optional card description override.
    #[serde(default)]
    pub description: Option<String>,
    /// Optional emoji/text sticker shown when no image is provided.
    #[serde(default)]
    pub sticker: Option<String>,
    /// Optional image URL or data URL for the card preview.
    #[serde(default)]
    pub image: Option<String>,
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
    /// Module-owned card preview metadata.
    #[serde(default)]
    pub preview: Option<ModulePreview>,
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
    /// Relative path to the module-owned settings UI entry file.
    pub settings_ui: Option<String>,
}

/// Configuration field schema for module settings
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigField {
    /// Field type ("text", "password", "select", "checkbox")
    pub field_type: String,
    /// Display label in UI
    pub label: String,
    /// Optional field description/help text shown under the control.
    #[serde(default)]
    pub description: Option<String>,
    /// Optional placeholder text for text inputs and textareas.
    #[serde(default)]
    pub placeholder: Option<String>,
    /// Default value
    pub default: Option<serde_json::Value>,
    /// Whether field is required
    pub required: bool,
    /// Optional minimum numeric value for number and range controls.
    #[serde(default)]
    pub min: Option<f64>,
    /// Optional maximum numeric value for number and range controls.
    #[serde(default)]
    pub max: Option<f64>,
    /// Optional numeric step for number and range controls.
    #[serde(default)]
    pub step: Option<f64>,
    /// Preferred row count for multiline textareas.
    #[serde(default)]
    pub rows: Option<u32>,
    /// Optional section/group label for form grouping.
    #[serde(default)]
    pub section: Option<String>,
    /// Optional ordering hint inside a form or section.
    #[serde(default)]
    pub order: Option<i32>,
    /// Available options for "select" fields.
    #[serde(default)]
    pub options: Option<Vec<String>>,
}
