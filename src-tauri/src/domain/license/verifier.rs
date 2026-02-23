use super::storage;
use super::types::{LicenseInfo, LicenseStatus};
use crate::errors::AppError;

/// Verifies current license status.
///
/// Currently returns [`LicenseStatus::Enterprise`] unconditionally while
/// the licensing system is disabled.
// TODO: re-enable when licensing is implemented:
//   storage::load_license().map_or(LicenseStatus::Free, |info| verify_license_info(&info))
pub const fn verify() -> LicenseStatus {
    LicenseStatus::Enterprise
}

/// Verifies a license info object
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

/// Activates a license key
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

/// Deactivates the current license
#[allow(clippy::missing_const_for_fn)] // Calls non-const storage function
pub fn deactivate() -> Result<(), AppError> {
    storage::clear_license()
}

/// Checks if a feature is available in the current license
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
