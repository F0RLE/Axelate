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
    let mut state = ui_state::get_ui_state().unwrap_or_default();
    state.zoom_level = zoom;
    ui_state::save_ui_state(state)
}

/// Set WebView zoom level and persist for current resolution
#[tauri::command]
pub fn set_webview_zoom(app: tauri::AppHandle, zoom: f64, res_key: String) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_zoom(zoom)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Save to UI State (Global and Per-Resolution)
        let mut state = ui_state::get_ui_state().unwrap_or_default();
        state.zoom_level = zoom;
        state.resolution_zoom.insert(res_key, zoom);
        ui_state::save_ui_state(state)?;
    }
    Ok(())
}

/// Get initial zoom for a resolution. Calculates default if not exists.
#[tauri::command]
pub fn get_resolution_zoom(res_key: String, screen_height: u32) -> Result<f64, AppError> {
    let mut state = ui_state::get_ui_state().unwrap_or_default();

    // 1. Try to get existing zoom for this resolution
    if state
        .resolution_zoom
        .get(&res_key)
        .is_some_and(|&zoom| zoom > 0.0)
    {
        return Ok(state.resolution_zoom[&res_key]);
    }

    // 2. No zoom saved? Calculate smart default based on 800x600 = 100%
    // Formula: height / 600
    let smart_default = (screen_height as f64) / 600.0;

    // Clamp between 0.5 and 3.0 (standard safety)
    let smart_default = smart_default.clamp(0.5, 3.0);

    // 3. Save calculated default so it's consistent
    state.resolution_zoom.insert(res_key, smart_default);
    ui_state::save_ui_state(state)?;

    Ok(smart_default)
}

/// Get current global WebView zoom level
#[tauri::command]
pub fn get_webview_zoom(_app: tauri::AppHandle) -> Result<f64, AppError> {
    let state = ui_state::get_ui_state()?;
    Ok(state.zoom_level)
}
