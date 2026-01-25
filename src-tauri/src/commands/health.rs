use crate::services;

#[tauri::command]
pub fn get_health() -> String {
    services::health::check()
}
