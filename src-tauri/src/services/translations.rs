use crate::errors::AppError;
// use serde::de::Error as _; // Import trait for .custom() - Removed as unused
use tauri::AppHandle;

pub fn get_translations(_app: &AppHandle, lang: &str) -> Result<serde_json::Value, AppError> {
    let json_content = match lang {
        "en" => Some(include_str!("../../resources/locales/en.json")),
        "ru" => Some(include_str!("../../resources/locales/ru.json")),
        "zh" => Some(include_str!("../../resources/locales/zh.json")),
        _ => None,
    };

    let content =
        json_content.ok_or_else(|| AppError::NotFound(format!("Locale '{}' not found", lang)))?;

    serde_json::from_str(content).map_err(AppError::Serialization)
}

// Helper kept for compatibility if needed, but unused for internal logic
pub fn get_locales_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    app.path()
        .resource_dir()
        .unwrap_or_default()
        .join("resources/locales")
}
