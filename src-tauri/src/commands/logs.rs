use crate::services::logs::{self, LogEntry};

#[tauri::command]
pub fn get_logs(since: f64) -> Vec<LogEntry> {
    logs::get_logs_since(since)
}

#[tauri::command]
pub fn clear_logs() {
    logs::clear_logs();
}

#[tauri::command]
pub fn add_log(msg: String, source: String, level: String) {
    logs::add_log(&msg, &source, &level);
}
#[derive(Debug, serde::Deserialize)]
pub struct BatchLogEntry {
    pub level: String,
    pub message: String,
}

#[tauri::command]
pub fn log_batch(logs: Vec<BatchLogEntry>) {
    for log in logs {
        logs::add_log(&log.message, "Frontend", &log.level);
    }
}
