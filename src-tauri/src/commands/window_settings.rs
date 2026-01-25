// Window settings commands for frontend

use crate::errors::AppError;
use crate::services::window_settings::{self, WindowSettings};
use tauri::Manager;

#[tauri::command]
pub fn get_window_settings() -> WindowSettings {
    window_settings::load_window_settings()
}

#[tauri::command]
pub fn save_window_size(width: u32, height: u32) -> Result<(), AppError> {
    window_settings::update_window_size(width, height)
}

#[tauri::command]
pub fn save_window_position(x: i32, y: i32) -> Result<(), AppError> {
    window_settings::update_window_position(x, y)
}

#[tauri::command]
pub fn save_maximized_state(maximized: bool) -> Result<(), AppError> {
    window_settings::update_maximized_state(maximized)
}

#[tauri::command]
pub fn save_zoom_level(zoom: f64) -> Result<(), AppError> {
    window_settings::update_zoom_level(zoom)
}

/// Set WebView zoom level (works like browser zoom)
#[tauri::command]
pub fn set_webview_zoom(app: tauri::AppHandle, zoom: f64) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_zoom(zoom)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Also save for persistence
        window_settings::update_zoom_level(zoom)?;
    }
    Ok(())
}

/// Get current WebView zoom level
#[tauri::command]
pub fn get_webview_zoom(app: tauri::AppHandle) -> f64 {
    // Load from saved settings
    let settings = window_settings::load_window_settings();

    // Apply saved zoom on get (in case it wasn't applied)
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_zoom(settings.zoom_level);
    }

    settings.zoom_level
}
