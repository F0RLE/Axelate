use crate::api::settings::window_settings::{res_key_from_window, resolve_zoom};
use crate::errors::AppError;
use crate::infrastructure::config::window_settings::WindowConfig;
use crate::infrastructure::config::{settings, ui_state, window_settings};
use crate::models::UIState;
use serde::Serialize;
use specta::Type;
use tauri::WebviewWindow;

/// Application bootstrap data sent to frontend during initialization
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapData {
    /// Persisted UI state
    pub ui_state: UIState,
    /// Window configuration settings
    pub window_config: WindowConfig,
    /// Detected system language
    pub system_language: String,
    /// Effective zoom for the current monitor resolution
    pub initial_zoom: f64,
}

#[tauri::command]
#[specta::specta]
/// Retrieves all application state and configuration during app startup
pub async fn get_app_bootstrap_data(
    window: WebviewWindow,
    ui_service: tauri::State<'_, ui_state::UiStateService>,
) -> Result<BootstrapData, AppError> {
    tracing::debug!("[Bootstrap] Collecting application data...");

    let ui_state = ui_service.get_ui_state().await.unwrap_or_default();
    let window_config = window_settings::get_window_config();
    let system_language = settings::get_language_sync();

    // Resolve zoom using the canonical priority chain:
    // per-resolution saved > global zoom_level > 1.0
    let res_key = res_key_from_window(&window).unwrap_or_else(|| "unknown".to_string());
    let initial_zoom = resolve_zoom(&ui_state, &res_key);

    Ok(BootstrapData {
        ui_state,
        window_config,
        system_language,
        initial_zoom,
    })
}
