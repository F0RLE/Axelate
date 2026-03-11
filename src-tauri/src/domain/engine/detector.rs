//! Engine binary detection
//!
//! Determines if a local engine is installed by checking:
//! 1. `MODULES_DIR/{engine_id}/` directory (downloaded via Axelate)
//! 2. System PATH (pre-installed by user)

use std::path::PathBuf;

use crate::utils::paths::{LEGACY_MODULES_DIR, MODULES_DIR};

fn installed_engine_dirs(engine_id: &str) -> [PathBuf; 2] {
    [MODULES_DIR.join(engine_id), LEGACY_MODULES_DIR.join(engine_id)]
}

/// Checks if an engine is installed either in `MODULES_DIR/{id}` or on system PATH.
///
/// Returns `false` for invalid engine IDs (prevents directory traversal).
pub fn is_engine_installed(engine_id: &str, binary_name: Option<&str>) -> bool {
    if !is_safe_id(engine_id) {
        return false;
    }

    // 1. Check MODULES_DIR/{engine_id}/ — downloaded via Axelate
    for module_path in installed_engine_dirs(engine_id) {
        if module_path.exists() && module_path.is_dir() {
            return true;
        }
    }

    // 2. Check PATH (user has it installed system-wide)
    if let Some(binary) = binary_name {
        if find_in_path(binary).is_some() {
            return true;
        }
    }

    false
}

/// Returns the absolute path to an engine binary if found.
///
/// Search order:
/// 1. Walk `MODULES_DIR/{engine_id}/` looking for a file matching `binary_name`
/// 2. Fall back to system PATH
pub fn resolve_engine_binary(engine_id: &str, binary_name: &str) -> Option<PathBuf> {
    if !is_safe_id(engine_id) {
        return None;
    }

    // 1. Walk installed module directory
    for module_path in installed_engine_dirs(engine_id) {
        if module_path.is_dir() {
            if let Some(found) = find_binary_in_dir(&module_path, binary_name) {
                return Some(found);
            }
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
