use crate::errors::AppError;
use crate::models::AppSettings;
use crate::services::settings::{self};

#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, AppError> {
    settings::get_settings()
}

#[tauri::command]
pub async fn save_settings(settings: AppSettings) -> Result<(), AppError> {
    settings::save_settings(settings)
}

#[tauri::command]
pub async fn save_setting(key: String, value: String) -> Result<(), AppError> {
    settings::save_setting(&key, &value)
}

#[tauri::command]
pub fn get_system_language() -> String {
    settings::get_language()
}
