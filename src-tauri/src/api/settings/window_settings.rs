// Window settings commands for frontend

use crate::errors::AppError;
use crate::infrastructure::config::{
    ui_state,
    window_settings::{self, WindowSettings},
};

#[tauri::command]
#[specta::specta]
/// Retrieves persisted window settings (size, position, maximized state)
pub async fn get_window_settings(
    window_service: tauri::State<'_, window_settings::WindowSettingsService>,
) -> Result<WindowSettings, AppError> {
    window_service.get_window_settings().await
}

#[tauri::command]
#[specta::specta]
/// Saves window dimensions to disk
pub async fn save_window_size(
    window_service: tauri::State<'_, window_settings::WindowSettingsService>,
    width: u32,
    height: u32,
) -> Result<(), AppError> {
    window_service.update_window_size(width, height).await
}

#[tauri::command]
#[specta::specta]
/// Saves window screen position to disk
pub async fn save_window_position(
    window_service: tauri::State<'_, window_settings::WindowSettingsService>,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    window_service.update_window_position(x, y).await
}

#[tauri::command]
#[specta::specta]
/// Saves maximized/unmaximized state to disk
pub async fn save_maximized_state(
    window_service: tauri::State<'_, window_settings::WindowSettingsService>,
    maximized: bool,
) -> Result<(), AppError> {
    window_service.update_maximized_state(maximized).await
}

#[tauri::command]
#[specta::specta]
/// Saves global zoom level to UI state
pub async fn save_zoom_level(
    ui_service: tauri::State<'_, ui_state::UiStateService>,
    zoom: f64,
) -> Result<(), AppError> {
    let mut state = ui_service.get_ui_state().await.unwrap_or_default();
    state.zoom_level = zoom;
    ui_service.save_ui_state(&state).await
}

/// Set `WebView` zoom level and persist for current resolution
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned WebviewWindow
pub async fn set_webview_zoom(
    window: tauri::WebviewWindow,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
    zoom: f64,
) -> Result<(), AppError> {
    window.set_zoom(zoom)?;

    // Save to UI State (Global and Per-Resolution)
    let mut state = ui_service.get_ui_state().await.unwrap_or_default();
    state.zoom_level = zoom;

    // Determine current resolution to save per-resolution zoom
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale_factor = monitor.scale_factor();
        let size = monitor.size().to_logical::<u32>(scale_factor);
        let res_key = format!("{}x{}", size.width, size.height);
        state.resolution_zoom.insert(res_key, zoom);
    }

    ui_service.save_ui_state(&state).await?;
    Ok(())
}

/// Get initial zoom for a resolution. Calculates default if not exists.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window
pub async fn get_resolution_zoom(
    window: tauri::Window,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
) -> Result<f64, AppError> {
    let mut state = ui_service.get_ui_state().await.unwrap_or_default();

    let (res_key, screen_height) = if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale_factor = monitor.scale_factor();
        let size = monitor.size().to_logical::<u32>(scale_factor);
        (format!("{}x{}", size.width, size.height), size.height)
    } else {
        ("unknown".to_string(), 600)
    };

    // 1. Try to get existing zoom for this resolution (collapsed if)
    if let Some(&zoom) = state.resolution_zoom.get(&res_key)
        && zoom > 0.0
    {
        return Ok(zoom);
    }

    // 2. No zoom saved? Calculate smart default based on baseline
    let smart_default = window_settings::calculate_adaptive_zoom(screen_height);

    // 3. Save calculated default
    state.resolution_zoom.insert(res_key, smart_default);
    ui_service.save_ui_state(&state).await?;

    Ok(smart_default)
}

/// Retrieves current global `WebView` zoom level
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned AppHandle
pub async fn get_webview_zoom(
    _app: tauri::AppHandle,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
) -> Result<f64, AppError> {
    let state = ui_service.get_ui_state().await?;
    Ok(state.zoom_level)
}

#[tauri::command]
#[specta::specta]
/// Retrieves window configuration settings
#[allow(clippy::missing_const_for_fn)] // Tauri command wrapper around const service fn
pub fn get_window_config() -> window_settings::WindowConfig {
    window_settings::get_window_config()
}

#[tauri::command]
#[specta::specta]
/// Calculates window layout policy based on screen size and zoom
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned Window
#[allow(clippy::cast_possible_truncation)] // Intentional truncation for UI dimensions
pub async fn get_window_policy(
    window: tauri::Window,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
) -> Result<window_settings::WindowPolicy, AppError> {
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
    let zoom = ui_service
        .get_ui_state()
        .await
        .map(|s| s.zoom_level)
        .unwrap_or(1.0);

    let win_size = window
        .inner_size()
        .unwrap_or_default()
        .to_logical::<f64>(scale_factor);

    let effective_w = u32::try_from((win_size.width / zoom).round() as i64).unwrap_or(1920);
    let effective_h = u32::try_from((win_size.height / zoom).round() as i64).unwrap_or(1080);

    Ok(window_settings::calculate_window_policy(
        screen_w,
        screen_h,
        effective_w,
        effective_h,
    ))
}
