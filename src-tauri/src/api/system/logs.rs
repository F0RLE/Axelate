use crate::errors::AppError;
use crate::infrastructure::logging::{self as logs, LogEntry};

#[tauri::command]
#[specta::specta]
/// Retrieves log entries since a given timestamp
pub fn get_logs(since: f64) -> Result<Vec<LogEntry>, AppError> {
    Ok(logs::get_logs_since(since))
}

#[tauri::command]
#[specta::specta]
/// Clears all stored log entries
pub fn clear_logs() -> Result<(), AppError> {
    logs::clear_logs();
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Adds a single log entry to the log store
pub fn add_log(msg: &str, source: &str, level: &str) -> Result<(), AppError> {
    logs::add_log(msg, source, level);
    Ok(())
}

/// Frontend log level
#[derive(Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// Informational message
    Info,
    /// Warning message
    Warn,
    /// Error message
    Error,
    /// Debug message
    Debug,
    /// Trace message
    Trace,
}

impl LogLevel {
    /// Returns the string representation for the logging backend.
    const fn as_str(&self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
            Self::Debug => "debug",
            Self::Trace => "trace",
        }
    }
}

/// Batch log entry from frontend
#[derive(Debug, serde::Deserialize, specta::Type)]
pub struct BatchLogEntry {
    /// Log level
    pub level: LogLevel,
    /// Log message content
    pub message: String,
}

#[tauri::command]
#[specta::specta]
/// Adds multiple log entries in batch from frontend
pub fn log_batch(logs: Vec<BatchLogEntry>) -> Result<(), AppError> {
    for log in logs {
        logs::add_log(&log.message, "Frontend", log.level.as_str());
    }
    Ok(())
}
