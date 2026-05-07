//! Engine binary detection
//!
//! Determines if a local engine is installed by checking:
//! 1. `ENGINES_DIR/{engine_id}/` directory (downloaded via Axelate)
//! 2. System PATH (pre-installed by user)

use std::path::PathBuf;

use crate::domain::engine::types::EngineComputeMode;
use crate::errors::AppError;
use crate::utils::paths::ENGINES_DIR;

fn installed_engine_dir(engine_id: &str) -> PathBuf {
    ENGINES_DIR.join(engine_id)
}

/// Deletes an Axelate-managed engine directory from `ENGINES_DIR/{id}`.
///
/// System `PATH` installs are intentionally ignored because they are owned by the user.
pub async fn delete_installed_engine(engine_id: &str) -> Result<(), AppError> {
    if !is_safe_id(engine_id) {
        return Err(AppError::Validation(format!(
            "Invalid engine id: {engine_id}"
        )));
    }

    let engine_path = installed_engine_dir(engine_id);
    if !tokio::fs::try_exists(&engine_path).await? {
        return Ok(());
    }

    let engines_root = ENGINES_DIR.canonicalize()?;
    let engine_path = engine_path.canonicalize()?;
    if !engine_path.starts_with(&engines_root) {
        return Err(AppError::Validation(format!(
            "Engine path escapes engines directory: {engine_id}"
        )));
    }

    tokio::fs::remove_dir_all(engine_path).await?;
    Ok(())
}

/// Checks if an engine is installed either in `ENGINES_DIR/{id}` or on system PATH.
///
/// Returns `false` for invalid engine IDs (prevents directory traversal).
pub fn is_engine_installed(engine_id: &str, binary_name: Option<&str>) -> bool {
    if !is_safe_id(engine_id) {
        return false;
    }

    // 1. Check ENGINES_DIR/{engine_id}/ — downloaded via Axelate
    let engine_path = installed_engine_dir(engine_id);
    if engine_path.exists() && engine_path.is_dir() {
        return true;
    }

    // 2. Check PATH (user has it installed system-wide)
    if let Some(binary) = binary_name {
        if find_in_path(binary).is_some() {
            return true;
        }
    }

    false
}

/// Reads Axelate install metadata and returns the compute modes present on disk.
///
/// Empty means the install source is unknown or predates metadata tracking.
pub fn installed_compute_modes(engine_id: &str) -> Vec<EngineComputeMode> {
    if !is_safe_id(engine_id) {
        return Vec::new();
    }

    let metadata_path = installed_engine_dir(engine_id).join("metadata.json");
    let Ok(source) = std::fs::read_to_string(metadata_path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&source) else {
        return Vec::new();
    };

    match value
        .get("compute_target")
        .and_then(serde_json::Value::as_str)
    {
        Some("gpu") => vec![EngineComputeMode::Gpu],
        Some("cpu") => vec![EngineComputeMode::Cpu],
        Some("both") => vec![EngineComputeMode::Gpu, EngineComputeMode::Cpu],
        _ => Vec::new(),
    }
}

/// Returns the absolute path to an engine binary if found.
///
/// Search order:
/// 1. Walk `ENGINES_DIR/{engine_id}/` looking for a file matching `binary_name`
/// 2. Fall back to system PATH
pub fn resolve_engine_binary(engine_id: &str, binary_name: &str) -> Option<PathBuf> {
    if !is_safe_id(engine_id) {
        return None;
    }

    // 1. Walk installed engine directory
    let engine_path = installed_engine_dir(engine_id);
    if engine_path.is_dir() {
        if let Some(found) = find_binary_in_dir(&engine_path, binary_name) {
            return Some(found);
        }
    }

    // 2. System PATH fallback
    find_in_path(binary_name)
}

/// Validates that an engine ID is safe to use as a path component.
///
/// Rejects: empty, too long, path separators, `..`, leading dots.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('.')
        && !id.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        && id != ".."
        && id != "."
}

/// Walks `dir` (one level deep) looking for a file matching `binary_name`.
fn find_binary_in_dir(dir: &std::path::Path, binary_name: &str) -> Option<PathBuf> {
    // On Windows accept both `foo` and `foo.exe`
    #[cfg(target_os = "windows")]
    let candidates = [binary_name.to_string(), format!("{binary_name}.exe")];
    #[cfg(not(target_os = "windows"))]
    let candidates = [binary_name.to_string()];

    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Recurse one level deep (e.g. llama-server/bin/llama-server.exe)
            if let Some(found) = find_binary_in_dir(&path, binary_name) {
                return Some(found);
            }
        } else if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            for candidate in &candidates {
                if file_name.eq_ignore_ascii_case(candidate.as_str()) {
                    return Some(path);
                }
            }
        }
    }

    None
}

/// Searches the system PATH environment variable for a binary.
fn find_in_path(binary_name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let candidates = [
        binary_name.to_string(),
        format!("{binary_name}.exe"),
        format!("{binary_name}.cmd"),
    ];
    #[cfg(not(target_os = "windows"))]
    let candidates = [binary_name.to_string()];

    let path_var = std::env::var_os("PATH")?;

    for dir in std::env::split_paths(&path_var) {
        for candidate in &candidates {
            let full = dir.join(candidate);
            if full.is_file() {
                return Some(full);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn test_nonexistent_engine_returns_false() {
        assert!(!is_engine_installed(
            "definitely-not-installed-xyz123",
            None
        ));
    }

    #[test]
    fn test_invalid_id_returns_false() {
        // Directory traversal attempt
        assert!(!is_engine_installed("../etc/passwd", None));
        // Empty string
        assert!(!is_engine_installed("", None));
    }

    #[test]
    fn test_resolve_nonexistent_returns_none() {
        assert!(
            resolve_engine_binary("definitely-not-installed-xyz123", "no-such-binary").is_none()
        );
    }
}
