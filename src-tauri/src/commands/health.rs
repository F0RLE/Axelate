use crate::services;

use crate::errors::AppError;

#[tauri::command]
#[specta::specta]
/// Checks backend health status
pub fn get_health() -> Result<String, AppError> {
    Ok(services::health::check())
}
