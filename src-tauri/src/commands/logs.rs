use crate::errors::AppError;
use crate::services::logs::{self, LogEntry};

#[tauri::command]
pub fn get_logs(since: f64) -> Result<Vec<LogEntry>, AppError> {
    Ok(logs::get_logs_since(since))
}

#[tauri::command]
pub fn clear_logs() -> Result<(), AppError> {
    logs::clear_logs();
    Ok(())
}

#[tauri::command]
pub fn add_log(msg: String, source: String, level: String) -> Result<(), AppError> {
    logs::add_log(&msg, &source, &level);
    Ok(())
}
#[derive(Debug, serde::Deserialize)]
pub struct BatchLogEntry {
    pub level: String,
    pub message: String,
}

#[tauri::command]
pub fn log_batch(logs: Vec<BatchLogEntry>) -> Result<(), AppError> {
    for log in logs {
        logs::add_log(&log.message, "Frontend", &log.level);
    }
    Ok(())
}
