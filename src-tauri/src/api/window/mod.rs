// use crate::services::system_monitor;
// use tauri::Manager;
use crate::errors::AppError;

#[tauri::command]
#[specta::specta]
/// Minimizes the application window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn minimize_window(window: tauri::Window) -> Result<(), AppError> {
    window
        .minimize()
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
#[specta::specta]
/// Maximizes or unmaximizes the window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn maximize_window(window: tauri::Window) -> Result<(), AppError> {
    if window.is_maximized().unwrap_or(false) {
        window
            .unmaximize()
            .map_err(|e| AppError::Internal(e.to_string()))
    } else {
        window
            .maximize()
            .map_err(|e| AppError::Internal(e.to_string()))
    }
}

#[tauri::command]
#[specta::specta]
/// Closes the window gracefully (app remains in tray)
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn close_window(window: tauri::Window) -> Result<(), AppError> {
    // Graceful close: just close the window (destroying WebView).
    // The App remains running in the tray.
    window
        .close()
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
#[specta::specta]
/// Shows and focuses the window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn show_window(window: tauri::Window) -> Result<(), AppError> {
    window
        .unminimize()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    window
        .show()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    window
        .set_focus()
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
#[specta::specta]
/// Hides the window
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window type
pub fn hide_window(window: tauri::Window) -> Result<(), AppError> {
    window.hide().map_err(|e| AppError::Internal(e.to_string()))
}
