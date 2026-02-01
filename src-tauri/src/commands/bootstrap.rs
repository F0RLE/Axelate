use crate::errors::AppError;
use crate::models::{Module, UIState};
use crate::services::{
    module_controller, settings, ui_state,
    window_settings::{self, WindowConfig},
};
use serde::Serialize;
use tauri::Window;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapData {
    pub ui_state: UIState,
    pub window_config: WindowConfig,
    pub system_language: String,
    pub modules: Vec<Module>,
    pub initial_zoom: f64,
}

#[tauri::command]
pub async fn get_app_bootstrap_data(window: Window) -> Result<BootstrapData, AppError> {
    log::info!("[Bootstrap] Collecting application data...");

    let ui_state = ui_state::get_ui_state().unwrap_or_default();
    let window_config = window_settings::get_window_config();
    let system_language = settings::get_language();
    let modules = module_controller::get_all_modules();

    // Determine initial zoom level based on monitor resolution
    let mut initial_zoom = ui_state.zoom_level;
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale_factor = monitor.scale_factor();
        let size = monitor.size().to_logical::<u32>(scale_factor);
        let res_key = format!("{}x{}", size.width, size.height);

        if let Some(&saved_zoom) = ui_state.resolution_zoom.get(&res_key) {
            if saved_zoom > 0.0 {
                initial_zoom = saved_zoom;
            }
        } else {
            initial_zoom = window_settings::calculate_adaptive_zoom(size.height);
        }
    }

    Ok(BootstrapData {
        ui_state,
        window_config,
        system_language,
        modules,
        initial_zoom,
    })
}
