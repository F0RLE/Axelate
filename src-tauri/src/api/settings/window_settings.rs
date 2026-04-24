use crate::errors::AppError;
use crate::infrastructure::config::{
    ui_state,
    window_settings::{self, WindowSettings},
};
use crate::models::UIState;

/// Extracts a resolution key string from the primary monitor attached to `window`.
/// Returns `None` if monitor information is unavailable.
pub fn res_key_from_window(window: &tauri::WebviewWindow) -> Option<String> {
    let monitor = window.primary_monitor().ok()??;
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<u32>(scale);
    Some(format!("{}x{}", size.width, size.height))
}

/// Resolves the effective zoom for a given resolution key.
///
/// Priority (highest → lowest):
/// 1. Saved per-resolution zoom for `res_key` (explicit user preference)
/// 2. Global `zoom_level` from UI state (last zoom the user applied on any screen)
/// 3. Neutral default: `1.0`
pub fn resolve_zoom(state: &UIState, res_key: &str) -> f64 {
    state
        .resolution_zoom
        .get(res_key)
        .copied()
        .filter(|&z| z > 0.0)
        .unwrap_or(if state.zoom_level > 0.0 {
            state.zoom_level
        } else {
            1.0
        })
        .clamp(
            window_settings::SCALING_MIN_ZOOM,
            window_settings::SCALING_MAX_ZOOM,
        )
}

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
    if (state.zoom_level - zoom).abs() < f64::EPSILON {
        return Ok(());
    }
    state.zoom_level = zoom;
    ui_service.save_ui_state(&state).await
}

async fn persist_zoom_for_window(
    window: &tauri::WebviewWindow,
    ui_service: &ui_state::UiStateService,
    zoom: f64,
) -> Result<(), AppError> {
    let zoom = zoom.clamp(
        window_settings::SCALING_MIN_ZOOM,
        window_settings::SCALING_MAX_ZOOM,
    );
    let mut state = ui_service.get_ui_state().await.unwrap_or_default();
    let previous_zoom = state.zoom_level;
    state.zoom_level = zoom;

    let mut changed = (previous_zoom - zoom).abs() >= f64::EPSILON;
    if let Some(res_key) = res_key_from_window(window) {
        let previous_resolution_zoom = state.resolution_zoom.insert(res_key, zoom);
        changed |=
            previous_resolution_zoom.is_none_or(|value| (value - zoom).abs() >= f64::EPSILON);
    }

    if changed {
        ui_service.save_ui_state(&state).await?;
    }

    Ok(())
}

/// Set `WebView` zoom level and persist for current resolution.
/// Uses native WebView zoom so layout metrics stay consistent with the rendered size.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned WebviewWindow
pub async fn set_webview_zoom(
    window: tauri::WebviewWindow,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
    zoom: f64,
) -> Result<(), AppError> {
    let zoom = zoom.clamp(
        window_settings::SCALING_MIN_ZOOM,
        window_settings::SCALING_MAX_ZOOM,
    );

    window.set_zoom(zoom)?;

    persist_zoom_for_window(&window, &ui_service, zoom).await
}

/// Persist zoom for the active monitor resolution without touching the WebView.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned WebviewWindow
pub async fn save_current_resolution_zoom(
    window: tauri::WebviewWindow,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
    zoom: f64,
) -> Result<(), AppError> {
    persist_zoom_for_window(&window, &ui_service, zoom).await
}

/// Get the effective zoom for the current monitor resolution.
/// Read-only — never auto-saves, so "user set" is always distinguishable from "defaulted".
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned WebviewWindow
pub async fn get_resolution_zoom(
    window: tauri::WebviewWindow,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
) -> Result<f64, AppError> {
    let state = ui_service.get_ui_state().await.unwrap_or_default();
    let res_key = res_key_from_window(&window).unwrap_or_else(|| "unknown".to_string());
    Ok(resolve_zoom(&state, &res_key))
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
    Ok(state.zoom_level.clamp(
        window_settings::SCALING_MIN_ZOOM,
        window_settings::SCALING_MAX_ZOOM,
    ))
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
