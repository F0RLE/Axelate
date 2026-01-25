//! Unified error handling for the application
//!
//! # Error Flow
//!
//! ```text
//! services → AppError → commands → IpcError (for frontend)
//! ```

use serde::Serialize;
use thiserror::Error;

/// Application-level errors
#[derive(Error, Debug)]
pub enum AppError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("External error: {0}")]
    External(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

#[derive(Serialize, Debug)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl From<AppError> for IpcError {
    fn from(err: AppError) -> Self {
        let (code, message) = match &err {
            AppError::Validation(msg) => ("VALIDATION", msg.clone()),
            AppError::NotFound(msg) => ("NOT_FOUND", msg.clone()),
            AppError::PermissionDenied(msg) => ("PERMISSION_DENIED", msg.clone()),
            AppError::Io(e) => ("IO_ERROR", e.to_string()),
            AppError::Serialization(e) => ("SERIALIZATION", e.to_string()),
            AppError::Config(msg) => ("CONFIG", msg.clone()),
            AppError::External(msg) => ("EXTERNAL", msg.clone()),
            AppError::Internal(msg) => ("INTERNAL", msg.clone()),
        };

        IpcError {
            code: code.to_string(),
            message,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let (code, message) = match self {
            AppError::Validation(msg) => ("VALIDATION", msg.clone()),
            AppError::NotFound(msg) => ("NOT_FOUND", msg.clone()),
            AppError::PermissionDenied(msg) => ("PERMISSION_DENIED", msg.clone()),
            AppError::Io(e) => ("IO_ERROR", e.to_string()),
            AppError::Serialization(e) => ("SERIALIZATION", e.to_string()),
            AppError::Config(msg) => ("CONFIG", msg.clone()),
            AppError::External(msg) => ("EXTERNAL", msg.clone()),
            AppError::Internal(msg) => ("INTERNAL", msg.clone()),
        };

        IpcError {
            code: code.to_string(),
            message,
        }
        .serialize(serializer)
    }
}

impl Clone for AppError {
    fn clone(&self) -> Self {
        match self {
            Self::Validation(s) => Self::Validation(s.clone()),
            Self::NotFound(s) => Self::NotFound(s.clone()),
            Self::PermissionDenied(s) => Self::PermissionDenied(s.clone()),
            Self::Io(e) => Self::Internal(e.to_string()),
            Self::Serialization(e) => Self::Internal(e.to_string()),
            Self::Config(s) => Self::Config(s.clone()),
            Self::External(s) => Self::External(s.clone()),
            Self::Internal(s) => Self::Internal(s.clone()),
        }
    }
}
