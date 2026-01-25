use super::types::LicenseInfo;

pub fn load_license() -> Option<LicenseInfo> {
    // Placeholder - in real app would load from file/registry
    None
}

pub fn save_license(_info: &LicenseInfo) -> Result<(), String> {
    // Placeholder - save to encrypted file
    Ok(())
}

pub fn clear_license() -> Result<(), String> {
    Ok(())
}
