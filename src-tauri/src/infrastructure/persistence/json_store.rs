use crate::domain::filesystem::service::FileService;
use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Arc;

/// Centralized JSON persistence helper with DI support
#[derive(Clone)]
pub struct JsonStore {
    file_service: Arc<dyn FileService>,
}

impl std::fmt::Debug for JsonStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JsonStore").finish()
    }
}

impl JsonStore {
    /// Creates a new JsonStore with a specific FileService implementation
    pub fn new(file_service: Arc<dyn FileService>) -> Self {
        Self { file_service }
    }

    /// Loads a JSON file synchronously (Safe for app bootstrap)
    pub fn load_sync<T>(path: &Path) -> Result<T, AppError>
    where
        T: for<'de> Deserialize<'de> + Default,
    {
        if !path.exists() {
            return Ok(T::default());
        }

        let content = fs::read_to_string(path).map_err(|e| AppError::Io(e.to_string()))?;
        match serde_json::from_str(&content) {
            Ok(data) => Ok(data),
            Err(e) => {
                // Note: Can't use tracing here if initialized late, but standard log usually works
                tracing::error!(
                    "Failed to parse JSON at {}, resetting to defaults: {e}",
                    path.display()
                );
                Ok(T::default())
            }
        }
    }

    /// Loads a JSON file asynchronously (Preferred for runtime).
    ///
    /// Returns `Default` only when the file is missing. Parse errors are propagated.
    pub async fn load_async<T>(&self, path: &Path) -> Result<T, AppError>
    where
        T: for<'de> Deserialize<'de> + Default + Serialize + Sync,
    {
        if !self.file_service.exists(path).await {
            return Ok(T::default());
        }

        let content = self.file_service.read_to_string(path).await?;

        serde_json::from_str(&content).map_err(|e| {
            AppError::Serialization(format!("Failed to parse {}: {e}", path.display()))
        })
    }

    /// Saves a data structure to a JSON file asynchronously
    pub async fn save_async<T>(&self, path: &Path, data: &T) -> Result<(), AppError>
    where
        T: Serialize + Sync,
    {
        let content = serde_json::to_string_pretty(data)
            .map_err(|e| AppError::Serialization(e.to_string()))?;

        self.file_service.write_string(path, &content).await
    }
}
