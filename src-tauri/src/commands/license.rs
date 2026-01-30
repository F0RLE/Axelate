// use tauri::command;

use crate::errors::AppError;
use crate::models::LicenseStatusResponse;
use crate::services::license;
use crate::services::license::types::LicenseStatus;

#[tauri::command]
pub fn get_license_status() -> Result<LicenseStatusResponse, AppError> {
    let status = license::verify();
    Ok(LicenseStatusResponse {
        status,
        email: None, // In real app, load from storage
    })
}

#[tauri::command]
pub async fn activate_license(
    key: String,
    email: Option<String>,
) -> Result<LicenseStatus, AppError> {
    license::activate(&key, email)
}

#[tauri::command]
pub async fn deactivate_license() -> Result<(), AppError> {
    license::deactivate()
}

#[tauri::command]
pub fn check_feature(feature: String) -> Result<bool, AppError> {
    Ok(license::has_feature(&feature))
}
