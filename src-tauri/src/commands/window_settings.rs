// Window settings commands for frontend

use crate::errors::AppError;
use crate::services::ui_state;
use crate::services::window_settings::{self, WindowSettings};
use tauri::Manager;

#[tauri::command]
pub fn get_window_settings() -> Result<WindowSettings, AppError> {
    Ok(window_settings::load_window_settings())
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
    let mut state = ui_state::get_ui_state()?;
    state.zoom_level = zoom;
    ui_state::save_ui_state(state)
}

/// Set WebView zoom level (works like browser zoom)
#[tauri::command]
pub fn set_webview_zoom(app: tauri::AppHandle, zoom: f64) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_zoom(zoom)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Save to UI State
        let mut state = ui_state::get_ui_state()?;
        state.zoom_level = zoom;
        ui_state::save_ui_state(state)?;
    }
    Ok(())
}

/// Get current WebView zoom level
#[tauri::command]
pub fn get_webview_zoom(app: tauri::AppHandle) -> Result<f64, AppError> {
    // Load from UI State
    let state = ui_state::get_ui_state()?;

    // Apply saved zoom on get (in case it wasn't applied)
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_zoom(state.zoom_level)
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    Ok(state.zoom_level)
}
