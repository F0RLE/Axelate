use super::types::LicenseInfo;
use crate::errors::AppError;
use crate::infrastructure::crypto::secure_storage::SecureStorage;

const LICENSE_KEY: &str = "license_data";

/// Loads license from storage
pub fn load_license() -> Option<LicenseInfo> {
    match SecureStorage::get_key(LICENSE_KEY) {
        Ok(Some(json)) => serde_json::from_str(&json).ok(),
        _ => None,
    }
}

/// Saves license to encrypted storage
pub fn save_license(info: &LicenseInfo) -> Result<(), AppError> {
    let json = serde_json::to_string(info).map_err(|e| AppError::Serialization(e.to_string()))?;
    SecureStorage::save_key(LICENSE_KEY.to_string(), json)
}

/// Clears license from storage
pub fn clear_license() -> Result<(), AppError> {
    SecureStorage::remove_key(LICENSE_KEY)
}
