use crate::errors::AppError;
// use serde::de::Error as _; // Import trait for .custom() - Removed as unused
use tauri::AppHandle;

pub fn get_translations(_app: &AppHandle, lang: &str) -> Result<serde_json::Value, AppError> {
    let base_content = include_str!("../../resources/locales/en.json");
    let mut translations: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(base_content).map_err(AppError::Serialization)?;

    if lang != "en" {
        let target_content = match lang {
            "ru" => Some(include_str!("../../resources/locales/ru.json")),
            "zh" => Some(include_str!("../../resources/locales/zh.json")),
            _ => None,
        };

        if let Some(content) = target_content {
            if let Ok(target_json) = serde_json::from_str::<serde_json::Value>(content) {
                if let Some(target_map) = target_json.as_object() {
                    for (k, v) in target_map {
                        translations.insert(k.clone(), v.clone());
                    }
                }
            }
        }
    }

    Ok(serde_json::Value::Object(translations))
}

// Helper kept for compatibility if needed, but unused for internal logic
pub fn get_locales_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    app.path()
        .resource_dir()
        .unwrap_or_default()
        .join("resources/locales")
}
