use crate::domain::filesystem::service::FileService;
use crate::errors::AppError;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::fs;

/// Local filesystem implementation of FileService
#[derive(Debug, Default, Clone)]
pub struct LocalFileService;

impl LocalFileService {
    /// Creates a new instance of LocalFileService
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl FileService for LocalFileService {
    async fn read_to_string(&self, path: &Path) -> Result<String, AppError> {
        fs::read_to_string(path)
            .await
            .map_err(|e| AppError::Io(e.to_string()))
    }

    async fn write_string(&self, path: &Path, content: &str) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.ok();
        }
        fs::write(path, content)
            .await
            .map_err(|e| AppError::Io(e.to_string()))
    }

    async fn read_bytes(&self, path: &Path) -> Result<Vec<u8>, AppError> {
        fs::read(path)
            .await
            .map_err(|e| AppError::Io(e.to_string()))
    }

    async fn write_bytes(&self, path: &Path, content: &[u8]) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.ok();
        }
        fs::write(path, content)
            .await
            .map_err(|e| AppError::Io(e.to_string()))
    }

    async fn delete(&self, path: &Path) -> Result<(), AppError> {
        if !path.exists() {
            return Ok(());
        }
        if path.is_dir() {
            fs::remove_dir_all(path)
                .await
                .map_err(|e| AppError::Io(e.to_string()))
        } else {
            fs::remove_file(path)
                .await
                .map_err(|e| AppError::Io(e.to_string()))
        }
    }

    async fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    async fn create_dir_all(&self, path: &Path) -> Result<(), AppError> {
        fs::create_dir_all(path)
            .await
            .map_err(|e| AppError::Io(e.to_string()))
    }

    fn join_safe(&self, base: &Path, part: &str) -> Result<PathBuf, AppError> {
        // Basic sandboxing check: ensure 'part' doesn't escape 'base'
        let combined = base.join(part);

        // canonicalize is blocking but we can use it here if needed,
        // however base might not exist yet.
        // For now, we do a simple check.
        if part.contains("..") || part.contains(':') {
            return Err(AppError::Validation(
                "Potential directory traversal detected".to_string(),
            ));
        }

        Ok(combined)
    }
}
