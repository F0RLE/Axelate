use crate::services;

use crate::errors::AppError;

#[tauri::command]
pub fn get_health() -> Result<String, AppError> {
    Ok(services::health::check())
}
