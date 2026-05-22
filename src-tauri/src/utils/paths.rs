use crate::errors::AppError;
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::SystemTime;

#[cfg(not(test))]
const APPDATA_DIR_NAME: &str = "AxelateData";
const RESOURCES_DIR_NAME: &str = "resources";
const LOCALES_DIR_NAME: &str = "locales";

#[cfg(not(test))]
fn append_appdata_dir(root: &Path) -> PathBuf {
    root.join(APPDATA_DIR_NAME)
}

#[cfg(test)]
const TEST_APPDATA_ROOT_DIR_NAME: &str = "axelate-tests";

#[cfg(test)]
fn resolve_test_root(kind: &str) -> PathBuf {
    std::env::temp_dir()
        .join(TEST_APPDATA_ROOT_DIR_NAME)
        .join(std::process::id().to_string())
        .join(kind)
}

fn resolve_config_root() -> PathBuf {
    #[cfg(test)]
    {
        resolve_test_root("roaming")
    }

    #[cfg(not(test))]
    {
        let mut root = dirs::config_dir();

        #[cfg(target_os = "windows")]
        {
            root = root.or_else(|| std::env::var("APPDATA").ok().map(PathBuf::from));
        }

        #[cfg(not(target_os = "windows"))]
        {
            root = root.or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|home| PathBuf::from(home).join(".config"))
            });
        }

        append_appdata_dir(&root.unwrap_or_else(|| PathBuf::from(".")))
    }
}

fn is_valid_resource_dir(path: &Path) -> bool {
    path.join(LOCALES_DIR_NAME).exists()
}

fn production_resource_dir_candidates() -> Vec<PathBuf> {
    std::env::current_exe()
        .ok()
        .as_deref()
        .and_then(Path::parent)
        .map(|exe_dir| {
            vec![
                exe_dir.join(RESOURCES_DIR_NAME),
                exe_dir.join("_up_").join(RESOURCES_DIR_NAME),
            ]
        })
        .unwrap_or_default()
}

fn manifest_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn development_resource_dir_candidates() -> [PathBuf; 3] {
    [
        manifest_dir().join(RESOURCES_DIR_NAME),
        manifest_dir().parent().map_or_else(
            || manifest_dir().join(RESOURCES_DIR_NAME),
            |parent| parent.join(RESOURCES_DIR_NAME),
        ),
        manifest_dir().parent().and_then(Path::parent).map_or_else(
            || manifest_dir().join(RESOURCES_DIR_NAME),
            |parent| parent.join("src-tauri").join(RESOURCES_DIR_NAME),
        ),
    ]
}

fn resolve_resources_dir() -> PathBuf {
    for path in production_resource_dir_candidates() {
        if is_valid_resource_dir(&path) {
            return path;
        }
    }

    for path in development_resource_dir_candidates() {
        if path.exists() {
            return path;
        }
    }

    manifest_dir().join(RESOURCES_DIR_NAME)
}

/// User/profile data root.
/// Defaults to:
/// - Windows: `%APPDATA%/AxelateData`
/// - Linux: `$XDG_CONFIG_HOME/AxelateData` or `~/.config/AxelateData`
/// - macOS: `~/Library/Application Support/AxelateData`
pub static APPDATA_ROOT: LazyLock<PathBuf> = LazyLock::new(resolve_config_root);

/// User-specific data root (`AxelateData/User`)
pub static USER_ROOT: LazyLock<PathBuf> = LazyLock::new(|| APPDATA_ROOT.join("User"));

/// Configuration directory for user settings (`AxelateData/User/Configs`)
pub static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("Configs"));

/// Directory for UI persistence state (`AxelateData/User/UI`)
pub static UI_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("UI"));

/// System root for internal app data (`AxelateData/System`).
pub static SYSTEM_ROOT: LazyLock<PathBuf> = LazyLock::new(|| APPDATA_ROOT.join("System"));

/// Shared runtime directory for managed language/tool runtimes (`AxelateData/System/Runtime`)
pub static RUNTIME_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Runtime"));

/// Runtime root for launcher-managed AI engines (`AxelateData/System/Runtime/Engines`)
pub static ENGINE_RUNTIME_DIR: LazyLock<PathBuf> = LazyLock::new(|| RUNTIME_DIR.join("Engines"));

/// Downloaded integration packages directory (`AxelateData/System/Integrations`)
pub static INTEGRATIONS_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Integrations"));

/// Downloaded launcher-managed AI engines directory (`AxelateData/System/Engines`)
pub static ENGINES_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Engines"));

/// Log files directory (`AxelateData/System/Logs`)
pub static LOG_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Logs"));

/// Engine runtime log files directory (`AxelateData/System/Logs/Engines`)
pub static ENGINE_LOGS_DIR: LazyLock<PathBuf> = LazyLock::new(|| LOG_DIR.join("Engines"));

/// Integration runtime log files directory (`AxelateData/System/Logs/Integrations`)
pub static INTEGRATION_LOGS_DIR: LazyLock<PathBuf> = LazyLock::new(|| LOG_DIR.join("Integrations"));

/// Temporary files directory (`AxelateData/System/Temp`)
pub static TEMP_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Temp"));

/// Downloaded or user-provided model files directory (`AxelateData/System/Models`)
pub static MODELS_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Models"));

/// Path to application resources.
///
/// # Resolution Logic
/// 1. Tries to locate resources relative to the running executable (Production).
/// 2. If not found, falls back to source directories (Development).
///
/// This Lazy initialization performs I/O checks (filesystem existence)
/// to determine the correct path.
pub static RESOURCES_DIR: LazyLock<PathBuf> = LazyLock::new(resolve_resources_dir);

/// Application cache directory (`AxelateData/System/Cache`)
pub static CACHE_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Cache"));

/// Path to application settings file (`AxelateData/User/Configs/app_settings.json`)
pub static FILE_APP_SETTINGS: LazyLock<PathBuf> =
    LazyLock::new(|| CONFIG_DIR.join("app_settings.json"));

/// Path to generation config (`AxelateData/User/Configs/generation_config.json`)
pub static FILE_GEN_CONFIG: LazyLock<PathBuf> =
    LazyLock::new(|| CONFIG_DIR.join("generation_config.json"));

/// Path to module settings store (`AxelateData/User/Configs/module_settings.json`)
pub static FILE_MODULE_SETTINGS: LazyLock<PathBuf> =
    LazyLock::new(|| CONFIG_DIR.join("module_settings.json"));

/// Path to engine user config (`AxelateData/User/Configs/engine_config.json`)
pub static FILE_ENGINE_CONFIG: LazyLock<PathBuf> =
    LazyLock::new(|| CONFIG_DIR.join("engine_config.json"));

/// Path to UI state file (`AxelateData/User/UI/ui_state.json`)
pub static FILE_UI_STATE: LazyLock<PathBuf> = LazyLock::new(|| UI_DIR.join("ui_state.json"));

/// Path to Agent Control profiles and audit state (`AxelateData/User/Configs/agent_control.json`)
pub static FILE_AGENT_CONTROL: LazyLock<PathBuf> =
    LazyLock::new(|| CONFIG_DIR.join("agent_control.json"));

/// Directory for Chat history (`AxelateData/User/Chat`)
pub static CHAT_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("Chat"));

/// Path to chat history file (`AxelateData/User/Chat/history.json`)
pub static FILE_CHAT_HISTORY: LazyLock<PathBuf> = LazyLock::new(|| CHAT_DIR.join("history.json"));

/// Maximum number of log files to keep
const MAX_LOG_FILES: usize = 5;

fn managed_directories() -> [&'static PathBuf; 15] {
    [
        &*APPDATA_ROOT,
        &*CONFIG_DIR,
        &*UI_DIR,
        &*SYSTEM_ROOT,
        &*RUNTIME_DIR,
        &*ENGINE_RUNTIME_DIR,
        &*LOG_DIR,
        &*ENGINE_LOGS_DIR,
        &*INTEGRATION_LOGS_DIR,
        &*TEMP_DIR,
        &*INTEGRATIONS_DIR,
        &*ENGINES_DIR,
        &*MODELS_DIR,
        &*CACHE_DIR,
        &*CHAT_DIR,
    ]
}

/// Initializes the application filesystem structure.
/// Creates all necessary directories if they don't exist.
///
/// # Errors
/// Returns `AppError::Io` if directory creation fails.
pub fn init_filesystem() -> Result<(), AppError> {
    for dir in managed_directories() {
        fs::create_dir_all(dir)?;
    }

    // Cleanup old log files (keep only last MAX_LOG_FILES)
    cleanup_old_logs()?;

    Ok(())
}

/// Remove old log files, keeping only the most recent MAX_LOG_FILES.
///
/// # Errors
/// Returns `AppError::Io` if reading the directory or deleting files fails.
fn cleanup_old_logs() -> Result<(), AppError> {
    if !LOG_DIR.exists() {
        return Ok(());
    }

    let mut log_files: Vec<_> = fs::read_dir(&*LOG_DIR)?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
        .collect();

    if log_files.len() <= MAX_LOG_FILES {
        return Ok(());
    }

    // Sort by modification time (oldest first). Files with unreadable metadata stay last so
    // cleanup does not delete them ahead of logs whose age is known.
    log_files.sort_by(|a, b| {
        let time_a = a.metadata().and_then(|m| m.modified()).ok();
        let time_b = b.metadata().and_then(|m| m.modified()).ok();
        compare_log_modified_times(time_a, time_b)
    });

    // Remove oldest files
    let to_remove = log_files.len() - MAX_LOG_FILES;
    for entry in log_files.into_iter().take(to_remove) {
        if let Err(e) = fs::remove_file(entry.path()) {
            tracing::warn!(
                "Failed to remove old log file {}: {e}",
                entry.path().display()
            );
        }
    }

    Ok(())
}

fn compare_log_modified_times(left: Option<SystemTime>, right: Option<SystemTime>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{
        RESOURCES_DIR_NAME, compare_log_modified_times, development_resource_dir_candidates,
        manifest_dir,
    };
    use std::cmp::Ordering;
    use std::time::{Duration, SystemTime};

    #[test]
    fn development_resource_dir_candidates_are_manifest_relative() {
        let manifest = manifest_dir();
        let candidates = development_resource_dir_candidates();

        assert_eq!(candidates[0], manifest.join(RESOURCES_DIR_NAME));
        assert_eq!(
            candidates[1],
            manifest
                .parent()
                .expect("manifest dir should have a parent")
                .join(RESOURCES_DIR_NAME)
        );
        assert_eq!(
            candidates[2],
            manifest
                .parent()
                .and_then(std::path::Path::parent)
                .expect("workspace root should have a parent")
                .join("src-tauri")
                .join(RESOURCES_DIR_NAME)
        );
    }

    #[test]
    fn log_cleanup_orders_unreadable_metadata_after_known_times() {
        let old = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
        let new = SystemTime::UNIX_EPOCH + Duration::from_secs(2);

        assert_eq!(
            compare_log_modified_times(Some(old), Some(new)),
            Ordering::Less
        );
        assert_eq!(
            compare_log_modified_times(Some(new), Some(old)),
            Ordering::Greater
        );
        assert_eq!(compare_log_modified_times(Some(old), None), Ordering::Less);
        assert_eq!(
            compare_log_modified_times(None, Some(old)),
            Ordering::Greater
        );
        assert_eq!(compare_log_modified_times(None, None), Ordering::Equal);
    }
}
