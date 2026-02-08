/// Module downloader commands
pub mod downloader;

use crate::domain::modules::controller::{self as module_controller, ModuleAction};
use crate::errors::AppError;
use crate::models::{ControlRequest, ControlResponse, Module};
use tauri::AppHandle;

/// Module launch response indicating how to handle the module
#[derive(Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct LaunchResponse {
    /// Action type ("`start_local`" or "navigate")
    pub action: String,
    /// Page to navigate to
    pub page: Option<String>,
    /// Provider identifier
    pub provider: Option<String>,
    /// Optional status message
    pub message: Option<String>,
}

#[tauri::command]
#[specta::specta]
/// Retrieves list of all available modules (AI and services)
pub async fn get_modules() -> Result<Vec<Module>, AppError> {
    Ok(module_controller::get_all_modules())
}

#[tauri::command]
#[specta::specta]
/// Retrieves runtime status of a specific module
pub async fn get_module_status(module_id: String) -> Result<String, AppError> {
    Ok(module_controller::get_module_status(&module_id))
}

#[tauri::command]
#[specta::specta]
/// Launches a module (local or API-based)
pub async fn launch_module(module_id: String) -> Result<LaunchResponse, AppError> {
    // 1. Check if it's a known Local Module (folder exists)
    let module_path = crate::domain::modules::downloader::get_module_path(&module_id);
    if module_path.exists() && module_path.is_dir() {
        return Ok(LaunchResponse {
            action: "start_local".to_string(),
            page: None,
            provider: None,
            message: Some(format!("Starting local module: {module_id}")),
        });
    }

    // 2. Check if it's in the API Registry (optional, but good for validation)
    // For now, we adopt the "Extensible" approach: If it's not local, we assume it's an API module
    // and try to navigate to chat. This allows adding new providers in JSON without touching Rust.

    // We could validate against api_providers.json here if we wanted strictness,
    // but the user asked for max extensibility.

    Ok(LaunchResponse {
        action: "navigate".to_string(),
        page: Some("chat".to_string()),
        provider: Some(module_id),
        message: None,
    })
}

#[tauri::command]
#[specta::specta]
/// Controls a module (start, stop, restart)
pub async fn control_module(
    app: AppHandle,
    request: ControlRequest,
) -> Result<ControlResponse, AppError> {
    let module_id = request
        .module_id
        .as_ref()
        .ok_or_else(|| AppError::Validation("module_id is required".to_string()))?;

    let action: ModuleAction = request.action.parse()?;

    module_controller::control(app, module_id, action)
}
