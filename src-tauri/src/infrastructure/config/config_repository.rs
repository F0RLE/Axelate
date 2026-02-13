use crate::domain::system::config_repository::ConfigRepository;
use crate::errors::AppError;
use crate::models::config::{ApiProvider, AppConfig};
use std::path::PathBuf;
use tauri::AppHandle;

/// Implementation of `ConfigRepository` that loads data from the local filesystem.
#[derive(Debug)]
pub struct FileConfigRepository;

impl FileConfigRepository {
    /// Creates a new `FileConfigRepository`.
    pub fn new(_app_handle: AppHandle) -> Self {
        Self
    }

    fn get_defaults_path() -> Result<PathBuf, AppError> {
        let res_dir = &*crate::utils::paths::RESOURCES_DIR;

        let candidates = [
            res_dir.join("config").join("defaults.json"),
            PathBuf::from("src-tauri/resources/config/defaults.json"),
            PathBuf::from("resources/config/defaults.json"),
            PathBuf::from("../src-tauri/resources/config/defaults.json"),
        ];

        for path in &candidates {
            if path.exists() {
                return Ok(path.clone());
            }
        }

        Err(AppError::Config(
            "Defaults not found in any expected location".to_string(),
        ))
    }
}

impl ConfigRepository for FileConfigRepository {
    fn load_defaults(&self) -> Result<AppConfig, AppError> {
        let content = Self::get_defaults_path().map_or_else(
            |_| {
                log::warn!("Defaults not found on disk, using embedded override.");
                include_str!("../../../resources/config/defaults.json").to_string()
            },
            |path| {
                std::fs::read_to_string(&path).unwrap_or_else(|e| {
                    log::warn!(
                        "Failed to read defaults from disk ({}), using embedded override: {e}",
                        path.display()
                    );
                    include_str!("../../../resources/config/defaults.json").to_string()
                })
            },
        );

        serde_json::from_str(&content)
            .map_err(|e| AppError::Config(format!("Failed to parse defaults: {e}")))
    }

    fn load_providers(&self) -> Result<Vec<ApiProvider>, AppError> {
        let providers_path = crate::utils::paths::RESOURCES_DIR.join("api_providers.json");

        let content = if providers_path.exists() {
            std::fs::read_to_string(&providers_path).unwrap_or_else(|_| {
                log::warn!("Failed to read api_providers.json from disk, using embedded.");
                include_str!("../../../resources/api_providers.json").to_string()
            })
        } else {
            log::info!("api_providers.json not found on disk, using embedded.");
            include_str!("../../../resources/api_providers.json").to_string()
        };

        serde_json::from_str(&content)
            .map_err(|e| AppError::Config(format!("Failed to parse api_providers: {e}")))
    }
}
