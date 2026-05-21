use crate::domain::monitoring::system_monitor::SystemMonitorService;
use crate::errors::AppError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
/// Minimizes the application window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn minimize_window(
    window: tauri::Window,
    monitor: State<'_, Arc<SystemMonitorService>>,
) -> Result<(), AppError> {
    window.minimize()?;
    monitor.set_paused(true);
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Maximizes or unmaximizes the window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn maximize_window(window: tauri::Window) -> Result<(), AppError> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize()?;
    } else {
        window.maximize()?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Closes the window gracefully (app remains in tray)
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn close_window(
    window: tauri::Window,
    monitor: State<'_, Arc<SystemMonitorService>>,
) -> Result<(), AppError> {
    monitor.set_paused(true);
    window.close()?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Shows and focuses the window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn show_window(
    window: tauri::Window,
    monitor: State<'_, Arc<SystemMonitorService>>,
) -> Result<(), AppError> {
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    monitor.set_paused(false);
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Hides the window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn hide_window(
    window: tauri::Window,
    monitor: State<'_, Arc<SystemMonitorService>>,
) -> Result<(), AppError> {
    window.hide()?;
    monitor.set_paused(true);
    Ok(())
}
