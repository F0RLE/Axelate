use crate::models::SystemStats;
use crate::services::system_monitor::{self};

#[tauri::command]
pub fn get_system_stats() -> SystemStats {
    system_monitor::get_stats()
}

#[tauri::command]
pub fn get_gpu_info() -> String {
    // В будущем тут будет вызов сервиса с nvidia-smi логикой из Python
    "NVIDIA GeForce RTX 4090 (Simulated)".to_string()
}

#[tauri::command]
pub fn set_monitoring_paused(paused: bool) {
    system_monitor::set_paused(paused);
}
