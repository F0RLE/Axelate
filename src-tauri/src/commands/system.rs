use crate::errors::AppError;
use crate::models::SystemStats;
use crate::services::system_monitor::{self};

#[tauri::command]
pub fn get_system_stats() -> Result<SystemStats, AppError> {
    Ok(system_monitor::get_stats())
}

#[tauri::command]
pub fn get_gpu_info() -> Result<String, AppError> {
    let stats = system_monitor::get_stats();
    match stats.gpu {
        Some(gpu) => Ok(gpu.name),
        None => Ok("No Dedicated GPU Detected".to_string()),
    }
}

#[tauri::command]
pub fn set_monitoring_paused(paused: bool) -> Result<(), AppError> {
    system_monitor::set_paused(paused);
    Ok(())
}
