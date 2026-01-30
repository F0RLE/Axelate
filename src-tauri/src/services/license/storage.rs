use super::types::LicenseInfo;
use crate::errors::AppError;

pub fn load_license() -> Option<LicenseInfo> {
    // Placeholder - in real app would load from file/registry
    None
}

pub fn save_license(_info: &LicenseInfo) -> Result<(), AppError> {
    // Placeholder - save to encrypted file
    Ok(())
}

pub fn clear_license() -> Result<(), AppError> {
    Ok(())
}
