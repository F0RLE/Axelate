use super::types::LicenseInfo;
use crate::errors::AppError;

/// Loads license from storage
pub const fn load_license() -> Option<LicenseInfo> {
    // Placeholder - in real app would load from file/registry
    None
}

/// Saves license to encrypted storage
pub const fn save_license(_info: &LicenseInfo) -> Result<(), AppError> {
    // Placeholder - save to encrypted file
    Ok(())
}

/// Clears license from storage
pub const fn clear_license() -> Result<(), AppError> {
    Ok(())
}
