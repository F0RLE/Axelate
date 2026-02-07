use crate::services::license::LicenseStatus;
use serde::{Deserialize, Serialize};
use specta::Type;

/// License activation status response
#[derive(Serialize, Deserialize, Type, Debug)]
pub struct LicenseStatusResponse {
    /// Current license activation status
    pub status: LicenseStatus,
    /// Email address associated with the license
    pub email: Option<String>,
}
