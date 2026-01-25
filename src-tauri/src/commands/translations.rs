use crate::services::translations;
use tauri::AppHandle;
use crate::errors::AppError;

#[tauri::command]
pub fn get_translations(app: AppHandle, lang: String) -> Result<serde_json::Value, AppError> {
    translations::get_translations(&app, &lang)
}
