/// Application bootstrap commands
pub mod bootstrap;
/// Configuration management commands
pub mod config;
/// Health check commands
pub mod health;
/// Logging commands
pub mod logs;

use crate::domain::monitoring::system_monitor::{self};
use crate::errors::AppError;
use crate::models::SystemStats;

#[tauri::command]
#[specta::specta]
/// Retrieves real-time system statistics (CPU, RAM, GPU, disk, network)
pub fn get_system_stats() -> Result<SystemStats, AppError> {
    Ok(system_monitor::get_stats())
}

#[tauri::command]
#[specta::specta]
/// Retrieves GPU model name or indicates if no GPU is present
pub fn get_gpu_info() -> Result<String, AppError> {
    let stats = system_monitor::get_stats();
    match stats.gpu {
        Some(gpu) => Ok(gpu.name),
        None => Ok("No Dedicated GPU Detected".to_string()),
    }
}

#[tauri::command]
#[specta::specta]
/// Pauses or resumes system monitoring
pub fn set_monitoring_paused(paused: bool) -> Result<(), AppError> {
    system_monitor::set_paused(paused);
    Ok(())
}
