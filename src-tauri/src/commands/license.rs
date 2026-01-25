// use tauri::command;

use crate::services::license;
use crate::services::license::types::LicenseStatus;
use crate::models::LicenseStatusResponse;

#[tauri::command]
pub fn get_license_status() -> LicenseStatusResponse {
    let status = license::verify();
    LicenseStatusResponse {
        status,
        email: None, // In real app, load from storage
    }
}

#[tauri::command]
pub async fn activate_license(key: String, email: Option<String>) -> Result<LicenseStatus, String> {
    license::activate(&key, email)
}

#[tauri::command]
pub async fn deactivate_license() -> Result<(), String> {
    license::deactivate()
}

#[tauri::command]
pub fn check_feature(feature: String) -> bool {
    license::has_feature(&feature)
}
