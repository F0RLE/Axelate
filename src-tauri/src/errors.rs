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
    Io(#[from] std::io::Error),

    /// JSON serialization/deserialization error
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Configuration loading or parsing error
    #[error("Configuration error: {0}")]
    Config(String),

    /// External service or API error
    #[error("External error: {0}")]
    External(String),

    /// Internal server error (unexpected failures)
    #[error("Internal error: {0}")]
    Internal(String),
}

// Manual implementation of specta::Type for AppError
// This maps AppError to IpcError structure for TypeScript generation
impl specta::Type for AppError {
    fn inline(
        type_map: &mut specta::TypeMap,
        generics: specta::Generics<'_>,
    ) -> specta::datatype::DataType {
        // AppError serializes as IpcError, so we use IpcError's type
        IpcError::inline(type_map, generics)
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
            AppError::Io(e) => ("IO_ERROR", e.to_string()),
            AppError::Serialization(e) => ("SERIALIZATION", e.to_string()),
            AppError::Config(msg) => ("CONFIG", msg.clone()),
            AppError::External(msg) => ("EXTERNAL", msg.clone()),
            AppError::Internal(msg) => ("INTERNAL", msg.clone()),
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
        let (code, message) = match self {
            Self::Validation(msg) => ("VALIDATION", msg.clone()),
            Self::NotFound(msg) => ("NOT_FOUND", msg.clone()),
            Self::PermissionDenied(msg) => ("PERMISSION_DENIED", msg.clone()),
            Self::Io(e) => ("IO_ERROR", e.to_string()),
            Self::Serialization(e) => ("SERIALIZATION", e.to_string()),
            Self::Config(msg) => ("CONFIG", msg.clone()),
            Self::External(msg) => ("EXTERNAL", msg.clone()),
            Self::Internal(msg) => ("INTERNAL", msg.clone()),
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
