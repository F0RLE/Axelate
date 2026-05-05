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
use serde_json::Value;
use std::collections::HashMap;

#[tauri::command]
#[specta::specta]
/// Retrieves application settings (theme, language, GPU, debug)
pub async fn get_settings(
    settings_service: tauri::State<'_, settings::SettingsService>,
) -> Result<AppSettings, AppError> {
    settings_service.get_settings().await
}

#[tauri::command]
#[specta::specta]
/// Saves application settings
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn save_settings(
    settings_service: tauri::State<'_, settings::SettingsService>,
    settings: AppSettings,
) -> Result<(), AppError> {
    settings_service.save_settings(&settings).await
}

#[tauri::command]
#[specta::specta]
/// Saves a single setting by key-value pair
pub async fn save_setting(
    settings_service: tauri::State<'_, settings::SettingsService>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    settings_service.save_setting(&key, &value).await
}

#[tauri::command]
#[specta::specta]
/// Retrieves persisted settings for a specific module.
pub async fn get_module_settings(
    settings_service: tauri::State<'_, settings::SettingsService>,
    module_id: String,
) -> Result<HashMap<String, Value>, AppError> {
    crate::domain::modules::downloader::validate_module_id(&module_id)?;
    settings_service.get_module_settings(&module_id).await
}

#[tauri::command]
#[specta::specta]
/// Saves persisted settings for a specific module.
#[allow(clippy::implicit_hasher)] // Tauri command payload uses the concrete serde HashMap shape.
pub async fn save_module_settings(
    settings_service: tauri::State<'_, settings::SettingsService>,
    module_id: String,
    settings: HashMap<String, Value>,
) -> Result<(), AppError> {
    crate::domain::modules::downloader::validate_module_id(&module_id)?;
    settings_service
        .save_module_settings(&module_id, &settings)
        .await
}

#[tauri::command]
#[specta::specta]
/// Detects and returns the current system language code
pub fn get_system_language() -> Result<String, AppError> {
    Ok(settings::get_language_sync())
}

#[cfg(test)]
mod tests {
    use super::get_system_language;

    #[test]
    fn get_system_language_returns_supported_code() {
        let result = get_system_language();
        assert!(result.is_ok());
        let lang = result.ok().unwrap_or_default();

        assert!(matches!(lang.as_str(), "en" | "ru" | "zh"));
    }
}
