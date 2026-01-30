// use crate::services::system_monitor;
// use tauri::Manager;
use crate::errors::AppError;

#[tauri::command]
pub fn minimize_window(window: tauri::Window) -> Result<(), AppError> {
    window
        .minimize()
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
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
pub fn close_window(window: tauri::Window) -> Result<(), AppError> {
    // Graceful close: just close the window (destroying WebView).
    // The App remains running in the tray.
    window
        .close()
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
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
pub fn hide_window(window: tauri::Window) -> Result<(), AppError> {
    window.hide().map_err(|e| AppError::Internal(e.to_string()))
}
