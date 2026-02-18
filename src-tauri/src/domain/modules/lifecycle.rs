use crate::errors::AppError;
use crate::models::modules::ConfigField;
use std::collections::HashMap;

/// Current module API version
pub const CURRENT_API_VERSION: &str = "1";

/// Module lifecycle trait for start/stop/health management
pub trait ModuleLifecycle {
    /// Initialize the module
    fn init(&mut self) -> Result<(), AppError> {
        Ok(())
    }
    /// Start the module
    fn start(&mut self) -> Result<(), AppError>;
    /// Stop the module
    fn stop(&mut self) -> Result<(), AppError>;
    /// Dispose/cleanup the module
    fn dispose(&mut self) -> Result<(), AppError> {
        self.stop()
    }
    /// Check module health
    fn health_check(&self) -> ModuleHealth {
        ModuleHealth::Unknown
    }
}

/// Module health status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModuleHealth {
    /// Module is healthy
    Healthy,
    /// Module is degraded with reason
    Degraded(String),
    /// Module is unhealthy with reason
    Unhealthy(String),
    /// Health status unknown
    Unknown,
}

/// Module manifest (module.json)
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ModuleManifest {
    #[serde(default = "default_api_version")]
    /// API version
    pub api_version: String,
    /// Module ID
    pub id: String,
    /// Module name
    pub name: String,
    /// Module version
    pub version: String,
    /// Module description
    pub description: String,
    /// Entry point script
    pub entry: Option<String>,
    /// Module dependencies
    pub dependencies: Vec<String>,
    /// Lifecycle scripts
    pub lifecycle: Option<LifecycleScripts>,
    /// Configuration schema
    pub config_schema: Option<HashMap<String, ConfigField>>,
}

fn default_api_version() -> String {
    "1".to_string()
}

/// Command definition which can be a simple string (shell) or structured (program + args)
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum CommandDefinition {
    /// Simple shell command string
    Simple(String),
    /// Structured program and arguments list (preferred, no shell overhead)
    Structured {
        /// Program to execute (e.g. "node", "python")
        program: String,
        /// List of arguments
        args: Vec<String>,
    },
}

/// Lifecycle script hooks
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct LifecycleScripts {
    /// Init script
    pub init: Option<CommandDefinition>,
    /// Start script
    pub start: Option<CommandDefinition>,
    /// Stop script
    pub stop: Option<CommandDefinition>,
    /// Health check script
    pub health: Option<CommandDefinition>,
}

/// Responsible for locating and loading module manifests
#[derive(Debug)]
pub struct ManifestLoader;

impl ManifestLoader {
    /// Loads module manifest from module.json
    pub fn load(module_dir: &std::path::Path) -> Result<ModuleManifest, AppError> {
        let manifest_path = module_dir.join("module.json");
        if !manifest_path.exists() {
            return Err(AppError::NotFound("Manifest not found".to_string()));
        }
        let content =
            std::fs::read_to_string(&manifest_path).map_err(|e| AppError::Io(e.to_string()))?;
        serde_json::from_str(&content).map_err(|e| AppError::Serialization(e.to_string()))
    }
}
