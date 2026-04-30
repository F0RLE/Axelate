use crate::domain::filesystem::service::FileService;
use crate::errors::AppError;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// Local filesystem implementation of FileService
#[derive(Debug, Default, Clone)]
pub struct LocalFileService;

impl LocalFileService {
    /// Creates a new instance of LocalFileService
    pub const fn new() -> Self {
        Self
    }

    async fn write_atomic(path: &Path, content: &[u8]) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(e.to_string()))?;
        }

        let tmp = path.with_extension(format!(
            "tmp-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));

        let mut file = fs::File::create(&tmp)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        file.write_all(content)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        file.sync_all()
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        drop(file);

        if let Err(first_error) = fs::rename(&tmp, path).await {
            let retryable_replace = matches!(
                first_error.kind(),
                std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
            );
            if !retryable_replace {
                let _ = fs::remove_file(&tmp).await;
                return Err(AppError::Io(format!(
                    "Failed to publish atomic write to '{}': rename failed: {first_error}",
                    path.display()
                )));
            }

            let backup = path.with_extension(format!(
                "bak-{}-{}",
                std::process::id(),
                chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            let had_original = fs::try_exists(path)
                .await
                .map_err(|e| AppError::Io(e.to_string()))?;
            if had_original && let Err(backup_error) = fs::rename(path, &backup).await {
                let _ = fs::remove_file(&tmp).await;
                return Err(AppError::Io(format!(
                    "Failed to replace '{}': rename failed: {first_error}; backing up existing file failed: {backup_error}",
                    path.display()
                )));
            }

            if let Err(second_error) = fs::rename(&tmp, path).await {
                let restore_message = if had_original {
                    match fs::rename(&backup, path).await {
                        Ok(()) => "backup restore succeeded".to_string(),
                        Err(restore_error) => {
                            format!("backup restore failed: {restore_error}")
                        }
                    }
                } else {
                    "no original file to restore".to_string()
                };
                let _ = fs::remove_file(&tmp).await;
                return Err(AppError::Io(format!(
                    "Failed to publish atomic write to '{}': first rename failed: {first_error}; second rename failed: {second_error}; {restore_message}",
                    path.display()
                )));
            }

            if had_original {
                let _ = fs::remove_file(&backup).await;
            }
        }

        Ok(())
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
        Self::write_atomic(path, content.as_bytes()).await
    }

    async fn read_bytes(&self, path: &Path) -> Result<Vec<u8>, AppError> {
        fs::read(path)
            .await
            .map_err(|e| AppError::Io(e.to_string()))
    }

    async fn write_bytes(&self, path: &Path, content: &[u8]) -> Result<(), AppError> {
        Self::write_atomic(path, content).await
    }

    async fn delete(&self, path: &Path) -> Result<(), AppError> {
        match fs::metadata(path).await {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path)
                .await
                .map_err(|e| AppError::Io(e.to_string())),
            Ok(_) => fs::remove_file(path)
                .await
                .map_err(|e| AppError::Io(e.to_string())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::Io(error.to_string())),
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

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::LocalFileService;
    use crate::domain::filesystem::service::FileService;
    use crate::errors::AppError;

    #[tokio::test]
    async fn write_string_creates_missing_parent_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let target = temp_dir.path().join("nested").join("value.txt");
        let service = LocalFileService::new();

        service
            .write_string(&target, "ok")
            .await
            .expect("write should create parents");

        assert_eq!(std::fs::read_to_string(target).expect("written file"), "ok");
    }

    #[tokio::test]
    async fn write_string_reports_parent_creation_failures() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let file_parent = temp_dir.path().join("not-a-directory");
        std::fs::write(&file_parent, "occupied").expect("fixture file");
        let target = file_parent.join("value.txt");
        let service = LocalFileService::new();

        let error = service
            .write_string(&target, "ok")
            .await
            .expect_err("parent creation failure should surface");

        assert!(matches!(error, AppError::Io(_)));
    }

    #[tokio::test]
    async fn write_bytes_replaces_existing_file_atomically() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let target = temp_dir.path().join("value.bin");
        std::fs::write(&target, b"old").expect("fixture file");
        let service = LocalFileService::new();

        service
            .write_bytes(&target, b"new")
            .await
            .expect("write should replace existing file");

        assert_eq!(std::fs::read(target).expect("written file"), b"new");
    }
}
