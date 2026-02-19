use crate::errors::AppError;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

/// Trait defining core file system operations for Axelate
#[async_trait]
pub trait FileService: Send + Sync {
    /// Reads the entire contents of a file into a string
    async fn read_to_string(&self, path: &Path) -> Result<String, AppError>;

    /// Writes a string to a file
    async fn write_string(&self, path: &Path, content: &str) -> Result<(), AppError>;

    /// Reads the entire contents of a file into a byte vector
    async fn read_bytes(&self, path: &Path) -> Result<Vec<u8>, AppError>;

    /// Writes a byte vector to a file
    async fn write_bytes(&self, path: &Path, content: &[u8]) -> Result<(), AppError>;

    /// Deletes a file or directory
    async fn delete(&self, path: &Path) -> Result<(), AppError>;

    /// Checks if a path exists
    async fn exists(&self, path: &Path) -> bool;

    /// Creates a directory and all its parent directories
    async fn create_dir_all(&self, path: &Path) -> Result<(), AppError>;

    /// Joins two paths safely, ensuring the result is within a sandbox if needed
    fn join_safe(&self, base: &Path, part: &str) -> Result<PathBuf, AppError>;
}
