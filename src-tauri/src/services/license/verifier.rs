use super::storage;
use super::types::{LicenseInfo, LicenseStatus};
use crate::errors::AppError;

pub fn verify() -> LicenseStatus {
    // TEMPORARY: Licensing disabled as per user request
    LicenseStatus::Enterprise
    /*
    match storage::load_license() {
        Some(info) => verify_license_info(&info),
        None => LicenseStatus::Free,
    }
    */
}

pub fn verify_license_info(info: &LicenseInfo) -> LicenseStatus {
    // Basic verification logic
    if info.key.starts_with("PRO-") {
        LicenseStatus::Pro
    } else if info.key.starts_with("ENT-") {
        LicenseStatus::Enterprise
    } else {
        LicenseStatus::Invalid
    }
}

pub fn activate(key: &str, email: Option<String>) -> Result<LicenseStatus, AppError> {
    let status = if key.starts_with("PRO-") {
        LicenseStatus::Pro
    } else if key.starts_with("ENT-") {
        LicenseStatus::Enterprise
    } else {
        return Err(AppError::Validation(
            "Invalid license key format".to_string(),
        ));
    };

    let info = LicenseInfo {
        key: key.to_string(),
        email,
        tier: status.clone(),
        expires_at: None,
    };

    storage::save_license(&info)?;
    Ok(status)
}

pub fn deactivate() -> Result<(), AppError> {
    storage::clear_license()
}

pub fn has_feature(feature: &str) -> bool {
    let status = verify();
    match status {
        LicenseStatus::Enterprise => true,
        LicenseStatus::Pro => {
            // Pro features list
            matches!(feature, "advanced_stats" | "custom_themes")
        }
        _ => false,
    }
}
