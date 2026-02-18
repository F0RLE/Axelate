use crate::domain::system::config_repository::ConfigRepository;
use crate::errors::AppError;
use crate::models::config::{ApiProvider, AppMeta, ModuleItem};
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

    fn get_config_path(filename: &str) -> Result<PathBuf, AppError> {
        let res_dir = &*crate::utils::paths::RESOURCES_DIR;

        let candidates = [
            res_dir.join("config").join(filename),
            res_dir.join(filename),
            PathBuf::from("src-tauri/resources/config").join(filename),
            PathBuf::from("resources/config").join(filename),
            PathBuf::from("src-tauri/resources").join(filename),
            PathBuf::from("resources").join(filename),
        ];

        for path in &candidates {
            if path.exists() {
                return Ok(path.clone());
            }
        }

        Err(AppError::Config(format!(
            "Config file '{filename}' not found in any expected location"
        )))
    }

    fn load_file<T: serde::de::DeserializeOwned>(
        filename: &str,
        embedded: &str,
    ) -> Result<T, AppError> {
        let content = if let Ok(path) = Self::get_config_path(filename) {
            std::fs::read_to_string(&path).unwrap_or_else(|e| {
                log::warn!("Failed to read {filename} from disk, using embedded: {e}");
                embedded.to_string()
            })
        } else {
            log::info!("{filename} not found on disk, using embedded.");
            embedded.to_string()
        };

        serde_json::from_str(&content)
            .map_err(|e| AppError::Config(format!("Failed to parse {filename}: {e}")))
    }
}

impl ConfigRepository for FileConfigRepository {
    fn load_app_meta(&self) -> Result<AppMeta, AppError> {
        Self::load_file(
            "app.json",
            include_str!("../../../resources/config/app.json"),
        )
    }

    fn load_api_providers(&self) -> Result<Vec<ApiProvider>, AppError> {
        Self::load_file(
            "api_providers.json",
            include_str!("../../../resources/api_providers.json"),
        )
    }

    fn load_local_modules(&self) -> Result<Vec<ModuleItem>, AppError> {
        Self::load_file(
            "local_modules.json",
            include_str!("../../../resources/config/local_modules.json"),
        )
    }
}
