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

        serde_json::from_str(&content).map_err(|error| {
            AppError::Serialization(format!(
                "Failed to parse JSON at {}: {error}",
                path.display()
            ))
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

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::JsonStore;
    use crate::errors::AppError;
    use crate::infrastructure::filesystem::local_file_service::LocalFileService;
    use std::sync::Arc;

    #[tokio::test]
    async fn load_async_defaults_only_when_file_is_missing() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let store = JsonStore::new(Arc::new(LocalFileService::new()));

        let value: serde_json::Value = store
            .load_async(&temp_dir.path().join("missing.json"))
            .await
            .expect("missing file should default");

        assert_eq!(value, serde_json::Value::Null);
    }

    #[tokio::test]
    async fn load_async_returns_error_for_invalid_json() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("broken.json");
        std::fs::write(&path, "{broken").expect("broken json fixture");
        let store = JsonStore::new(Arc::new(LocalFileService::new()));

        let error = store
            .load_async::<serde_json::Value>(&path)
            .await
            .expect_err("invalid json should not default");

        assert!(
            matches!(error, AppError::Serialization(message) if message.contains("broken.json"))
        );
    }
}
