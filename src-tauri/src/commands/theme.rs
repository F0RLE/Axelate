use crate::services::theme;
use std::collections::HashMap;

#[tauri::command]
pub fn get_theme_colors() -> HashMap<String, String> {
    theme::get_theme_colors()
}
