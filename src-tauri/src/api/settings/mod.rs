/// Theme settings commands
pub mod theme;
/// Translation/Locale settings commands
pub mod translations;
/// UI State settings commands
pub mod ui_state;
/// Window settings commands
pub mod window_settings;

use crate::errors::AppError;
use crate::infrastructure::config::settings::{self};
use crate::models::AppSettings;

#[tauri::command]
#[specta::specta]
/// Retrieves application settings (theme, language, GPU, debug)
pub async fn get_settings() -> Result<AppSettings, AppError> {
    settings::get_settings()
}

#[tauri::command]
#[specta::specta]
/// Saves application settings
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn save_settings(settings: AppSettings) -> Result<(), AppError> {
    settings::save_settings(&settings)
}

#[tauri::command]
#[specta::specta]
/// Saves a single setting by key-value pair
pub async fn save_setting(key: String, value: String) -> Result<(), AppError> {
    settings::save_setting(&key, &value)
}

#[tauri::command]
#[specta::specta]
/// Detects and returns the current system language code
pub fn get_system_language() -> Result<String, AppError> {
    Ok(settings::get_language())
}
