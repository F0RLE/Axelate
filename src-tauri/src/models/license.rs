use crate::services::license::LicenseStatus;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct LicenseStatusResponse {
    pub status: LicenseStatus,
    pub email: Option<String>,
}
