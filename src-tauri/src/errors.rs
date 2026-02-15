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
#[derive(Error, Debug, Clone, specta::Type)]
#[serde(tag = "type", content = "payload")]
pub enum AppError {
    /// Validation error (invalid input, malformed data)
    #[error("Validation error: {0}")]
    Validation(String),

    /// Resource not found error
    #[error("Not found: {0}")]
    NotFound(String),

    /// Permission denied or unauthorized access
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    /// File system I/O error
    #[error("IO error: {0}")]
    Io(String),

    /// JSON serialization/deserialization error
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// Configuration loading or parsing error
    #[error("Configuration error: {0}")]
    Config(String),

    /// External service or API error
    #[error("External error: {message}")]
    External {
        /// Unique request identifier for tracing
        request_id: Option<String>,
        /// error message
        message: String,
    },

    /// Internal server error (unexpected failures)
    #[error("Internal error: {message}")]
    Internal {
        /// Unique request identifier for tracing
        request_id: Option<String>,
        /// error message
        message: String,
    },
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization(err.to_string())
    }
}

/// IPC-safe error representation for frontend
#[derive(Serialize, Debug, specta::Type)]
pub struct IpcError {
    /// Error code identifier
    pub code: String,
    /// Human-readable error message
    pub message: String,
}

impl From<AppError> for IpcError {
    fn from(err: AppError) -> Self {
        let (code, message) = match &err {
            AppError::Validation(msg) => ("VALIDATION", msg.clone()),
            AppError::NotFound(msg) => ("NOT_FOUND", msg.clone()),
            AppError::PermissionDenied(msg) => ("PERMISSION_DENIED", msg.clone()),
            AppError::Io(msg) => ("IO_ERROR", msg.clone()),
            AppError::Serialization(msg) => ("SERIALIZATION", msg.clone()),
            AppError::Config(msg) => ("CONFIG", msg.clone()),
            AppError::External { message, .. } => ("EXTERNAL", message.clone()),
            AppError::Internal { message, .. } => ("INTERNAL", message.clone()),
        };

        Self {
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
        // Use IpcError for wire serialization to match frontend expectations
        IpcError::from(self.clone()).serialize(serializer)
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::Internal {
            request_id: None,
            message: err.to_string(),
        }
    }
}
