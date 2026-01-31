use crate::errors::AppError;
use crate::models::modules::ConfigField;
use std::collections::HashMap;

pub const CURRENT_API_VERSION: &str = "1";

pub trait ModuleLifecycle {
    fn init(&mut self) -> Result<(), AppError> {
        Ok(())
    }
    fn start(&mut self) -> Result<(), AppError>;
    fn stop(&mut self) -> Result<(), AppError>;
    fn dispose(&mut self) -> Result<(), AppError> {
        self.stop()
    }
    fn health_check(&self) -> ModuleHealth {
        ModuleHealth::Unknown
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ModuleHealth {
    Healthy,
    Degraded(String),
    Unhealthy(String),
    Unknown,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ModuleManifest {
    #[serde(default = "default_api_version")]
    pub api_version: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub entry: Option<String>,
    pub dependencies: Vec<String>,
    pub lifecycle: Option<LifecycleScripts>,
    pub config_schema: Option<HashMap<String, ConfigField>>,
}

fn default_api_version() -> String {
    "1".to_string()
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct LifecycleScripts {
    pub init: Option<String>,
    pub start: Option<String>,
    pub stop: Option<String>,
    pub health: Option<String>,
}

pub fn load_manifest(module_dir: &std::path::Path) -> Result<ModuleManifest, AppError> {
    let manifest_path = module_dir.join("module.json");
    if !manifest_path.exists() {
        return Err(AppError::NotFound("Manifest not found".to_string()));
    }
    let content = std::fs::read_to_string(&manifest_path).map_err(AppError::Io)?;
    serde_json::from_str(&content).map_err(AppError::Serialization)
}
