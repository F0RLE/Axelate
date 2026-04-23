/// Module downloader commands
pub mod downloader;

use crate::domain::modules::controller::{self as module_controller, ModuleAction};
use crate::errors::AppError;
use crate::models::{ControlRequest, ControlResponse, Module};
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
/// Retrieves list of all available modules (AI and services)
pub async fn get_modules() -> Result<Vec<Module>, AppError> {
    Ok(module_controller::get_all_modules().await)
}

#[tauri::command]
#[specta::specta]
/// Retrieves runtime status of a specific module
pub async fn get_module_status(module_id: String) -> Result<String, AppError> {
    Ok(module_controller::get_module_status(&module_id).await)
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

    module_controller::control(app, module_id, action).await
}
