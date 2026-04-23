use crate::errors::AppError;
use crate::infrastructure::config::theme;
use std::collections::HashMap;

#[tauri::command]
#[specta::specta]
/// Retrieves current theme color palette
pub fn get_theme_colors() -> Result<HashMap<String, String>, AppError> {
    Ok(theme::get_theme_colors())
}
