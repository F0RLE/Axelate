use crate::errors::AppError;
use crate::infrastructure::config::translations;
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
/// Retrieves translation strings for the specified language
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned AppHandle
pub fn get_translations(app: AppHandle, lang: &str) -> Result<serde_json::Value, AppError> {
    translations::get_translations(&app, lang)
}
