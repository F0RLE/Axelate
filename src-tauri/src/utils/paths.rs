use crate::errors::AppError;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

#[cfg(not(test))]
const APPDATA_DIR_NAME: &str = "AxelateData";
const RESOURCES_DIR_NAME: &str = "resources";
const LOCALES_DIR_NAME: &str = "locales";

#[cfg(not(test))]
fn append_appdata_dir(root: &Path) -> PathBuf {
    root.join(APPDATA_DIR_NAME)
}

fn resolve_config_root() -> PathBuf {
    #[cfg(test)]
    {
        PathBuf::from("./test_appdata_roaming")
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

#[cfg(target_os = "windows")]
fn resolve_windows_local_data_root() -> PathBuf {
    #[cfg(test)]
    {
        PathBuf::from("./test_appdata_local")
    }

    #[cfg(not(test))]
    {
        let root = dirs::data_local_dir()
            .or_else(|| std::env::var("LOCALAPPDATA").ok().map(PathBuf::from))
            .unwrap_or_else(resolve_config_root);

        append_appdata_dir(&root)
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

fn development_resource_dir_candidates() -> [PathBuf; 3] {
    [
        PathBuf::from("src-tauri").join(RESOURCES_DIR_NAME),
        PathBuf::from(RESOURCES_DIR_NAME),
        PathBuf::from("../src-tauri").join(RESOURCES_DIR_NAME),
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

    PathBuf::from("src-tauri").join(RESOURCES_DIR_NAME)
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

/// Log files directory (`AxelateData/System/Logs`)
pub static LOG_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Logs"));

/// Temporary files directory (`AxelateData/System/Temp`)
pub static TEMP_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Temp"));

/// Downloaded modules directory (`AxelateData/System/Modules`)
pub static MODULES_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Modules"));

/// Shared runtime directory for managed language/tool runtimes (`AxelateData/System/Runtime`)
pub static RUNTIME_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Runtime"));

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

/// Directory for Chat history (`AxelateData/User/Chat`)
pub static CHAT_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("Chat"));

/// Path to chat history file (`AxelateData/User/Chat/history.json`)
pub static FILE_CHAT_HISTORY: LazyLock<PathBuf> = LazyLock::new(|| CHAT_DIR.join("history.json"));

/// Maximum number of log files to keep
const MAX_LOG_FILES: usize = 5;

fn managed_directories() -> [&'static PathBuf; 11] {
    [
        &*APPDATA_ROOT,
        &*CONFIG_DIR,
        &*UI_DIR,
        &*SYSTEM_ROOT,
        &*LOG_DIR,
        &*TEMP_DIR,
        &*MODULES_DIR,
        &*RUNTIME_DIR,
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
    migrate_windows_system_root_to_roaming()?;

    for dir in managed_directories() {
        fs::create_dir_all(dir)?;
    }

    // Cleanup old log files (keep only last MAX_LOG_FILES)
    cleanup_old_logs()?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn legacy_windows_system_root() -> PathBuf {
    resolve_windows_local_data_root().join("System")
}

fn ensure_parent_dir(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    Ok(())
}

fn move_file(source_path: &Path, target_path: &Path) -> Result<(), AppError> {
    ensure_parent_dir(target_path)?;

    if fs::rename(source_path, target_path).is_err() {
        fs::copy(source_path, target_path)?;
        fs::remove_file(source_path)?;
    }

    Ok(())
}

fn migrate_windows_system_root_to_roaming() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let legacy_system_root = legacy_windows_system_root();
        if legacy_system_root == *SYSTEM_ROOT || !legacy_system_root.exists() {
            return Ok(());
        }

        ensure_parent_dir(&SYSTEM_ROOT)?;

        if matches!(fs::rename(&legacy_system_root, &*SYSTEM_ROOT), Ok(())) {
            tracing::info!(
                from = %legacy_system_root.display(),
                to = %SYSTEM_ROOT.display(),
                "Migrated system data from Local AppData to Roaming AppData"
            );
        } else {
            merge_directories(&legacy_system_root, &SYSTEM_ROOT)?;
            remove_empty_dirs(&legacy_system_root)?;
            tracing::info!(
                from = %legacy_system_root.display(),
                to = %SYSTEM_ROOT.display(),
                "Merged legacy system data from Local AppData into Roaming AppData"
            );
        }
    }

    Ok(())
}

fn merge_directories(source: &Path, target: &Path) -> Result<(), AppError> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            merge_directories(&source_path, &target_path)?;
            remove_empty_dirs(&source_path)?;
            continue;
        }

        if target_path.exists() {
            fs::remove_file(&source_path)?;
            continue;
        }

        move_file(&source_path, &target_path)?;
    }

    Ok(())
}

fn remove_empty_dirs(path: &Path) -> Result<(), AppError> {
    if !path.exists() || !path.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        if entry.file_type()?.is_dir() {
            remove_empty_dirs(&child)?;
        }
    }

    if fs::read_dir(path)?.next().is_none() {
        fs::remove_dir(path)?;
    }

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

    // Sort by modification time (oldest first)
    log_files.sort_by(|a, b| {
        let time_a = a.metadata().and_then(|m| m.modified()).ok();
        let time_b = b.metadata().and_then(|m| m.modified()).ok();
        time_a.cmp(&time_b)
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
