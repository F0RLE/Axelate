pub mod storage;
pub mod types;
pub mod verifier;

pub use types::{LicenseInfo, LicenseStatus};
pub use verifier::{activate, deactivate, has_feature, verify};
