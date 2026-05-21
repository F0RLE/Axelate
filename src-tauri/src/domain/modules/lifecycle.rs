use crate::errors::AppError;
use crate::models::modules::{ConfigField, ModulePreview};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Current module API version
pub const CURRENT_API_VERSION: &str = "1";
const PRIMARY_MANIFEST_FILE: &str = "axelate-module.toml";

#[derive(Debug)]
struct ManifestSource {
    path: std::path::PathBuf,
}

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

/// Module manifest (`axelate-module.toml`)
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
    /// Module-owned card preview metadata.
    #[serde(default)]
    pub preview: Option<ModulePreview>,
    /// Human-readable module documentation file.
    #[serde(default)]
    pub readme: Option<String>,
    /// Legacy launcher-owned schema file path for richer forms.
    #[serde(default, alias = "settingsSchema")]
    pub settings_schema: Option<String>,
    /// Module-owned custom settings UI entry point.
    #[serde(default, alias = "settingsUi")]
    pub settings_ui: Option<String>,
    /// Launcher-managed module runtime.
    pub runtime: ModuleRuntime,
    /// Lifecycle scripts
    pub lifecycle: Option<LifecycleScripts>,
    /// Configuration schema
    #[serde(default, alias = "configSchema")]
    pub config_schema: Option<HashMap<String, ConfigField>>,
}

/// Launcher-managed runtime declaration for module code.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ModuleRuntime {
    /// Runtime kind (`python`, `node`, `bun`, or `binary`).
    pub kind: ModuleRuntimeKind,
    /// Runtime version requested by the module.
    #[serde(default)]
    pub version: Option<String>,
    /// Entry point relative to the module root.
    pub entry: String,
    /// Dependency manifest relative to the module root.
    #[serde(default)]
    pub dependencies: Option<String>,
    /// Package manager for JavaScript runtimes (`npm` or `bun`).
    #[serde(default)]
    pub package_manager: Option<String>,
}

/// Supported launcher-managed module runtime kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleRuntimeKind {
    /// Python script runtime, managed with uv.
    Python,
    /// Node.js script runtime, dependencies managed outside the module tree.
    Node,
    /// Bun script runtime, dependencies managed outside the module tree.
    Bun,
    /// External executable lifecycle managed by explicit lifecycle commands.
    Binary,
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
    /// Loads module manifest from `axelate-module.toml`.
    pub fn load(module_dir: &std::path::Path) -> Result<ModuleManifest, AppError> {
        let source = Self::resolve_manifest_source(module_dir)?;
        let manifest = Self::load_manifest_source(&source)?;
        Self::validate_manifest(module_dir, manifest)
    }

    fn resolve_manifest_source(module_dir: &Path) -> Result<ManifestSource, AppError> {
        let primary_manifest_path = module_dir.join(PRIMARY_MANIFEST_FILE);
        if primary_manifest_path.exists() {
            return Ok(ManifestSource {
                path: primary_manifest_path,
            });
        }

        Err(AppError::NotFound(format!(
            "Manifest not found. Expected {PRIMARY_MANIFEST_FILE}"
        )))
    }

    fn load_manifest_source(source: &ManifestSource) -> Result<ModuleManifest, AppError> {
        Self::load_toml_manifest(&source.path)
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

    fn validate_manifest(
        module_dir: &Path,
        manifest: ModuleManifest,
    ) -> Result<ModuleManifest, AppError> {
        Self::validate_relative_existing_file(
            module_dir,
            &manifest.runtime.entry,
            "runtime.entry",
        )?;

        if let Some(dependencies) = manifest.runtime.dependencies.as_deref() {
            Self::validate_relative_existing_file(
                module_dir,
                dependencies,
                "runtime.dependencies",
            )?;
        }

        Ok(manifest)
    }

    fn validate_relative_existing_file(
        module_dir: &Path,
        value: &str,
        field_name: &str,
    ) -> Result<PathBuf, AppError> {
        let path = Path::new(value.trim());
        if value.trim().is_empty() || path.is_absolute() || value.contains("..") {
            return Err(AppError::Validation(format!(
                "{field_name} must be a relative module file path"
            )));
        }

        let full_path = module_dir.join(path);
        if !full_path.is_file() {
            return Err(AppError::NotFound(format!(
                "{field_name} not found at {}",
                full_path.display()
            )));
        }

        Ok(full_path)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{ManifestLoader, ModuleRuntimeKind, PRIMARY_MANIFEST_FILE};
    use crate::errors::AppError;
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

[runtime]
kind = "python"
version = "3.11"
entry = "src/main.py"
dependencies = "requirements.txt"

[lifecycle]
start = { program = "uv", args = ["run", "src/main.py"] }
"#,
        )
        .expect("write manifest");
        fs::create_dir_all(temp_dir.path().join("src")).expect("src dir");
        fs::write(temp_dir.path().join("src/main.py"), "print('ok')").expect("entry");
        fs::write(temp_dir.path().join("requirements.txt"), "requests").expect("deps");

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
        assert_eq!(manifest.runtime.kind, ModuleRuntimeKind::Python);
        assert_eq!(manifest.runtime.version.as_deref(), Some("3.11"));
        assert_eq!(manifest.runtime.entry, "src/main.py");
        assert_eq!(
            manifest.runtime.dependencies.as_deref(),
            Some("requirements.txt")
        );
    }

    #[test]
    fn rejects_non_toml_manifest_files() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let manifest_path = temp_dir.path().join("module.json");

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
        .expect("write non-toml manifest");

        let error = ManifestLoader::load(temp_dir.path()).expect_err("non-toml manifest rejected");

        assert!(
            matches!(error, AppError::NotFound(message) if message.contains(PRIMARY_MANIFEST_FILE))
        );
    }

    #[test]
    fn resolves_manifest_source_to_primary_toml() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        fs::write(
            temp_dir.path().join(PRIMARY_MANIFEST_FILE),
            r#"
api_version = "1"
id = "primary"
name = "Primary"
version = "1.0.0"

[runtime]
kind = "python"
entry = "src/main.py"
"#,
        )
        .expect("write primary");
        fs::create_dir_all(temp_dir.path().join("src")).expect("src dir");
        fs::write(temp_dir.path().join("src/main.py"), "print('ok')").expect("entry");

        let source = ManifestLoader::resolve_manifest_source(temp_dir.path()).expect("source");

        assert_eq!(source.path, temp_dir.path().join(PRIMARY_MANIFEST_FILE));
    }

    #[test]
    fn rejects_manifest_without_runtime_block() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        fs::write(
            temp_dir.path().join(PRIMARY_MANIFEST_FILE),
            r#"
api_version = "1"
id = "legacy"
name = "Legacy"
version = "1.0.0"
entry = "src/main.py"
dependencies = ["python"]
"#,
        )
        .expect("write manifest");

        let error = ManifestLoader::load(temp_dir.path()).expect_err("runtime block required");

        assert!(matches!(error, AppError::Serialization(_)));
    }
}
