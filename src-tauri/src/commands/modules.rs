use crate::errors::AppError;
use crate::models::{ControlRequest, ControlResponse, Module};
use crate::services::module_controller::{self, ModuleAction};
use tauri::AppHandle;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchResponse {
    pub action: String,
    pub page: Option<String>,
    pub provider: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn get_modules() -> Result<Vec<Module>, AppError> {
    Ok(module_controller::get_all_modules())
}

#[tauri::command]
pub async fn get_module_status(module_id: String) -> Result<String, AppError> {
    Ok(module_controller::get_module_status(&module_id))
}

#[tauri::command]
pub async fn launch_module(module_id: String) -> Result<LaunchResponse, AppError> {
    // 1. Check if it's a known Local Module (folder exists)
    let module_path = crate::services::downloader::get_module_path(&module_id);
    if module_path.exists() && module_path.is_dir() {
        return Ok(LaunchResponse {
            action: "start_local".to_string(),
            page: None,
            provider: None,
            message: Some(format!("Starting local module: {}", module_id)),
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
pub async fn control_module(
    app: AppHandle,
    request: ControlRequest,
) -> Result<ControlResponse, AppError> {
    let module_id = request
        .module_id
        .as_ref()
        .ok_or_else(|| AppError::Validation("module_id is required".to_string()))?;

    let action: ModuleAction = request.action.parse()?;

    module_controller::control(app, module_id, action).await
}
