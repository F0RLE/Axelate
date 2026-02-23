use crate::errors::AppError;
use crate::infrastructure::config::translations;

#[tauri::command]
#[specta::specta]
/// Retrieves translation strings for the specified language
pub fn get_translations(lang: &str) -> Result<serde_json::Value, AppError> {
    translations::get_translations(lang)
}
