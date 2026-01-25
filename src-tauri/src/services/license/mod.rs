pub mod types;
pub mod storage;
pub mod verifier;

pub use types::{LicenseInfo, LicenseStatus};
pub use verifier::{verify, activate, deactivate, has_feature};
