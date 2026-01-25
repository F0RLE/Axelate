use serde::{Deserialize, Serialize};
use crate::services::license::LicenseStatus;

#[derive(Serialize, Deserialize)]
pub struct LicenseStatusResponse {
    pub status: LicenseStatus,
    pub email: Option<String>,
}
