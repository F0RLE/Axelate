/// Application bootstrap commands
pub mod bootstrap;
/// Configuration management commands
pub mod config;
/// Health check commands
pub mod health;
/// Logging commands
pub mod logs;

use crate::domain::monitoring::system_monitor::SystemMonitorService;
use crate::domain::system::hardware_probe::{
    GpuInfo, merge_probe_with_runtime_stats, probe_gpu_info,
};
use crate::errors::AppError;
use crate::models::SystemStats;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
/// Retrieves real-time system statistics (CPU, RAM, GPU, disk, network)
pub async fn get_system_stats(
    monitor: State<'_, Arc<SystemMonitorService>>,
) -> Result<SystemStats, AppError> {
    Ok(monitor.get_stats().await)
}

#[tauri::command]
#[specta::specta]
/// Retrieves GPU information and preferred runtime backend hint
pub async fn get_gpu_info(
    monitor: State<'_, Arc<SystemMonitorService>>,
) -> Result<GpuInfo, AppError> {
    let stats = monitor.get_stats().await;
    Ok(merge_probe_with_runtime_stats(
        probe_gpu_info().await,
        stats.gpu.as_ref(),
    ))
}

#[tauri::command]
#[specta::specta]
/// Pauses or resumes system monitoring
#[allow(clippy::needless_pass_by_value)] // Tauri State extractor is passed by value
pub fn set_monitoring_paused(
    paused: bool,
    monitor: State<'_, Arc<SystemMonitorService>>,
) -> Result<(), AppError> {
    monitor.set_paused(paused);
    Ok(())
}
