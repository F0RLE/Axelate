// Window settings commands for frontend

use crate::errors::AppError;
use crate::services::ui_state;
use crate::services::window_settings::{self, WindowSettings};

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
pub fn set_webview_zoom(window: tauri::WebviewWindow, zoom: f64) -> Result<(), AppError> {
    window
        .set_zoom(zoom)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Save to UI State (Global and Per-Resolution)
    let mut state = ui_state::get_ui_state().unwrap_or_default();
    state.zoom_level = zoom;

    // Determine current resolution to save per-resolution zoom
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale_factor = monitor.scale_factor();
        let size = monitor.size().to_logical::<u32>(scale_factor);
        let res_key = format!("{}x{}", size.width, size.height);
        state.resolution_zoom.insert(res_key, zoom);
    }

    ui_state::save_ui_state(state)?;
    Ok(())
}

/// Get initial zoom for a resolution. Calculates default if not exists.
#[tauri::command]
pub fn get_resolution_zoom(window: tauri::Window) -> Result<f64, AppError> {
    let mut state = ui_state::get_ui_state().unwrap_or_default();

    let (res_key, screen_height) = if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale_factor = monitor.scale_factor();
        let size = monitor.size().to_logical::<u32>(scale_factor);
        (format!("{}x{}", size.width, size.height), size.height)
    } else {
        ("unknown".to_string(), 600)
    };

    // 1. Try to get existing zoom for this resolution
    if state
        .resolution_zoom
        .get(&res_key)
        .is_some_and(|&zoom| zoom > 0.0)
    {
        return Ok(state.resolution_zoom[&res_key]);
    }

    // 2. No zoom saved? Calculate smart default based on baseline
    let smart_default = window_settings::calculate_adaptive_zoom(screen_height);

    // 3. Save calculated default
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

#[tauri::command]
pub fn get_window_config() -> window_settings::WindowConfig {
    window_settings::get_window_config()
}

#[tauri::command]
pub fn get_window_policy(window: tauri::Window) -> window_settings::WindowPolicy {
    let mut screen_w = 1920;
    let mut screen_h = 1080;
    let mut scale_factor = 1.0;

    if let Ok(Some(monitor)) = window.primary_monitor() {
        scale_factor = monitor.scale_factor();
        let size = monitor.size().to_logical::<u32>(scale_factor);
        screen_w = size.width;
        screen_h = size.height;
    }

    // Get current zoom from state to calculate effective dimensions
    let zoom = ui_state::get_ui_state()
        .map(|s| s.zoom_level)
        .unwrap_or(1.0);

    let win_size = window
        .inner_size()
        .unwrap_or_default()
        .to_logical::<f64>(scale_factor);

    let effective_w = (win_size.width / zoom).round() as u32;
    let effective_h = (win_size.height / zoom).round() as u32;

    window_settings::calculate_window_policy(screen_w, screen_h, effective_w, effective_h)
}
