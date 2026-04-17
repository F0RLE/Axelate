use crate::errors::AppError;
use crate::models::modules::ConfigField;
use std::collections::HashMap;
use std::path::Path;

/// Current module API version
pub const CURRENT_API_VERSION: &str = "1";
const PRIMARY_MANIFEST_FILE: &str = "axelate-module.toml";
const LEGACY_MANIFEST_FILE: &str = "module.json";

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

/// Module manifest (`axelate-module.toml` or legacy `module.json`)
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
    #[serde(default)]
    pub description: String,
    /// Module author or organization
    #[serde(default)]
    pub author: Option<String>,
    /// Module category used by the launcher UI.
    #[serde(default, alias = "type")]
    pub category: Option<String>,
    /// Module icon shown in the launcher UI.
    #[serde(default)]
    pub icon: Option<String>,
    /// Human-readable module documentation file.
    #[serde(default)]
    pub readme: Option<String>,
    /// Legacy launcher-owned schema file path for richer forms.
    #[serde(default, alias = "settingsSchema")]
    pub settings_schema: Option<String>,
    /// Module-owned custom settings UI entry point.
    #[serde(default, alias = "settingsUi")]
    pub settings_ui: Option<String>,
    /// Entry point script
    pub entry: Option<String>,
    /// Module dependencies
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Lifecycle scripts
    pub lifecycle: Option<LifecycleScripts>,
    /// Configuration schema
    #[serde(default, alias = "configSchema")]
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
        #[serde(default)]
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
    /// Loads module manifest from `axelate-module.toml` or legacy `module.json`.
    pub fn load(module_dir: &std::path::Path) -> Result<ModuleManifest, AppError> {
        let primary_manifest_path = module_dir.join(PRIMARY_MANIFEST_FILE);
        if primary_manifest_path.exists() {
            let manifest = Self::load_toml_manifest(&primary_manifest_path)?;
            return Ok(Self::normalize_manifest(module_dir, manifest));
        }

        let legacy_manifest_path = module_dir.join(LEGACY_MANIFEST_FILE);
        if legacy_manifest_path.exists() {
            let manifest = Self::load_json_manifest(&legacy_manifest_path)?;
            return Ok(Self::normalize_manifest(module_dir, manifest));
        }

        Err(AppError::NotFound(format!(
            "Manifest not found. Expected {PRIMARY_MANIFEST_FILE} or {LEGACY_MANIFEST_FILE}"
        )))
    }

    fn load_toml_manifest(manifest_path: &Path) -> Result<ModuleManifest, AppError> {
        let content =
            std::fs::read_to_string(manifest_path).map_err(|e| AppError::Io(e.to_string()))?;
        toml::from_str(&content).map_err(|e| {
            AppError::Serialization(format!(
                "Failed to parse TOML manifest at {}: {e}",
                manifest_path.display()
            ))
        })
    }

    fn load_json_manifest(manifest_path: &Path) -> Result<ModuleManifest, AppError> {
        let content =
            std::fs::read_to_string(manifest_path).map_err(|e| AppError::Io(e.to_string()))?;
        serde_json::from_str(&content).map_err(|e| {
            AppError::Serialization(format!(
                "Failed to parse legacy JSON manifest at {}: {e}",
                manifest_path.display()
            ))
        })
    }

    fn normalize_manifest(module_dir: &Path, mut manifest: ModuleManifest) -> ModuleManifest {
        // Keep older script modules runnable even if a legacy installer dropped `entry`
        // from the manifest but the standard `src/main.py` layout exists on disk.
        if manifest.entry.is_none() {
            let default_python_entry = module_dir.join("src").join("main.py");
            if default_python_entry.exists() {
                manifest.entry = Some("src/main.py".to_string());
            }
        }

        manifest
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{ManifestLoader, PRIMARY_MANIFEST_FILE};
    use std::fs;

    #[test]
    fn loads_primary_toml_manifest() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let manifest_path = temp_dir.path().join(PRIMARY_MANIFEST_FILE);

        fs::write(
            &manifest_path,
            r#"
api_version = "2"
id = "demo-module"
name = "Demo Module"
version = "1.2.3"
description = "Example manifest"
author = "Axelate"
type = "service"
icon = "🤖"
settings_ui = "settings-ui/index.html"
entry = "src/main.py"
dependencies = ["python"]

[lifecycle]
start = { program = "uv", args = ["run", "src/main.py"] }
"#,
        )
        .expect("write manifest");

        let manifest = ManifestLoader::load(temp_dir.path()).expect("load manifest");

        assert_eq!(manifest.api_version, "2");
        assert_eq!(manifest.id, "demo-module");
        assert_eq!(manifest.author.as_deref(), Some("Axelate"));
        assert_eq!(manifest.category.as_deref(), Some("service"));
        assert_eq!(manifest.icon.as_deref(), Some("🤖"));
        assert_eq!(
            manifest.settings_ui.as_deref(),
            Some("settings-ui/index.html")
        );
        assert_eq!(manifest.entry.as_deref(), Some("src/main.py"));
    }

    #[test]
    fn falls_back_to_legacy_json_manifest() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let manifest_path = temp_dir.path().join(super::LEGACY_MANIFEST_FILE);

        fs::write(
            &manifest_path,
            r#"{
  "api_version": "1",
  "id": "legacy-demo",
  "name": "Legacy Demo",
  "version": "0.1.0",
  "description": "Legacy manifest",
  "dependencies": []
}"#,
        )
        .expect("write legacy manifest");

        let manifest = ManifestLoader::load(temp_dir.path()).expect("load legacy manifest");

        assert_eq!(manifest.id, "legacy-demo");
        assert_eq!(manifest.version, "0.1.0");
    }
}
