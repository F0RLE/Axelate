use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LicenseStatus {
    Free,
    Pro,
    Enterprise,
    Expired,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub key: String,
    pub email: Option<String>,
    pub tier: LicenseStatus,
    pub expires_at: Option<i64>,
}
