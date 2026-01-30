use crate::errors::AppError;
use crate::services::theme;
use std::collections::HashMap;

#[tauri::command]
pub fn get_theme_colors() -> Result<HashMap<String, String>, AppError> {
    Ok(theme::get_theme_colors())
}
