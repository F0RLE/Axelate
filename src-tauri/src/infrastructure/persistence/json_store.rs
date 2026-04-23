use crate::domain::filesystem::service::FileService;
use crate::errors::AppError;
use serde::{Deserialize, Serialize};
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

    /// Loads a JSON file asynchronously (Preferred for runtime).
    pub async fn load_async<T>(&self, path: &Path) -> Result<T, AppError>
    where
        T: for<'de> Deserialize<'de> + Default + Serialize + Sync,
    {
        if !self.file_service.exists(path).await {
            return Ok(T::default());
        }

        let content = self.file_service.read_to_string(path).await?;

        match serde_json::from_str(&content) {
            Ok(data) => Ok(data),
            Err(e) => {
                tracing::warn!(
                    "Failed to parse JSON at {}, resetting to defaults: {e}",
                    path.display()
                );
                Ok(T::default())
            }
        }
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
