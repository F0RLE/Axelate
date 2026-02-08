//! License management module
//!
//! Handles license verification, activation, and feature gating

/// License storage operations
pub mod storage;
/// License types and status
pub mod types;
/// License verification logic
pub mod verifier;

pub use types::{LicenseInfo, LicenseStatus};
pub use verifier::{activate, deactivate, has_feature, verify};
