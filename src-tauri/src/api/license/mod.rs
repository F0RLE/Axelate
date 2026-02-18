// use tauri::command;

use crate::domain::license;
use crate::domain::license::types::LicenseStatus;
use crate::errors::AppError;
use crate::models::LicenseStatusResponse;

#[tauri::command]
#[specta::specta]
/// Retrieves current license activation status
#[allow(clippy::missing_const_for_fn)] // Wrapper around const verify() function
pub fn get_license_status() -> Result<LicenseStatusResponse, AppError> {
    let status = license::verify();
    Ok(LicenseStatusResponse {
        status,
        email: None, // In real app, load from storage
    })
}

#[tauri::command]
#[specta::specta]
/// Activates a license key with optional email
pub async fn activate_license(
    key: String,
    email: Option<String>,
) -> Result<LicenseStatus, AppError> {
    license::activate(&key, email)
}

#[tauri::command]
#[specta::specta]
/// Deactivates the current license
pub async fn deactivate_license() -> Result<(), AppError> {
    license::deactivate()
}

#[tauri::command]
#[specta::specta]
/// Checks if a specific feature is enabled by the current license
pub fn check_feature(feature: &str) -> Result<bool, AppError> {
    Ok(license::has_feature(feature))
}
