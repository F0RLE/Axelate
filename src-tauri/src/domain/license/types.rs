use serde::{Deserialize, Serialize};
use specta::Type;

/// License tier status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
pub enum LicenseStatus {
    /// Free tier
    Free,
    /// Pro tier
    Pro,
    /// Enterprise tier
    Enterprise,
    /// Expired license
    Expired,
    /// Invalid license key
    Invalid,
}

/// License information
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LicenseInfo {
    /// License key
    pub key: String,
    /// User email
    pub email: Option<String>,
    /// License tier
    pub tier: LicenseStatus,
    /// Expiration timestamp
    pub expires_at: Option<i64>,
}
