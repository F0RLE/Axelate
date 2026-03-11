use crate::errors::AppError;
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;

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

        let mut path = root.unwrap_or_else(|| PathBuf::from("."));
        path.push("AxelateData");
        path
    }
}

fn resolve_local_data_root() -> PathBuf {
    #[cfg(test)]
    {
        PathBuf::from("./test_appdata_local")
    }

    #[cfg(not(test))]
    {
        #[cfg(target_os = "windows")]
        {
            let root = dirs::data_local_dir()
                .or_else(|| std::env::var("LOCALAPPDATA").ok().map(PathBuf::from))
                .unwrap_or_else(resolve_config_root);

            return root.join("AxelateData");
        }

        #[cfg(not(target_os = "windows"))]
        {
            resolve_config_root()
        }
    }
}

/// User/profile data root.
/// Defaults to:
/// - Windows: `%APPDATA%/AxelateData`
/// - Linux: `$XDG_CONFIG_HOME/AxelateData` or `~/.config/AxelateData`
/// - macOS: `~/Library/Application Support/AxelateData`
pub static APPDATA_ROOT: LazyLock<PathBuf> = LazyLock::new(resolve_config_root);

/// Local machine data root.
/// Defaults to:
/// - Windows: `%LOCALAPPDATA%/AxelateData`
/// - Other OSes: same as `APPDATA_ROOT`
pub static LOCALDATA_ROOT: LazyLock<PathBuf> = LazyLock::new(resolve_local_data_root);

/// User-specific data root (`AxelateData/User`)
pub static USER_ROOT: LazyLock<PathBuf> = LazyLock::new(|| APPDATA_ROOT.join("User"));

/// Configuration directory for user settings (`AxelateData/User/Configs`)
pub static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("Configs"));

/// Directory for UI persistence state (`AxelateData/User/UI`)
pub static UI_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("UI"));

/// System root for internal app data.
/// On Windows this is stored in Local AppData to keep large/cacheable files out of Roaming.
pub static SYSTEM_ROOT: LazyLock<PathBuf> = LazyLock::new(|| LOCALDATA_ROOT.join("System"));

/// Log files directory (`AxelateData/System/Logs`)
pub static LOG_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Logs"));

/// Temporary files directory (`AxelateData/System/Temp`)
pub static TEMP_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Temp"));

/// Downloaded modules directory (`AxelateData/System/Modules`)
pub static MODULES_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Modules"));

/// Legacy downloaded modules directory in Roaming AppData (`AxelateData/System/Modules`)
pub static LEGACY_MODULES_DIR: LazyLock<PathBuf> =
    LazyLock::new(|| APPDATA_ROOT.join("System").join("Modules"));

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
pub static RESOURCES_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
    // 1. Production Check: Look relative to the running executable
    // Tauri bundles often place resources in the same folder or a specific relative structure
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .as_deref()
        .and_then(|p| p.parent())
    {
        // Common production layouts
        let prod_candidates = [
            exe_dir.join("resources"),
            exe_dir.join("_up_").join("resources"), // Some updater structures
        ];

        for path in &prod_candidates {
            // Check for locales to ensure it's a valid resource directory
            // (Prevents picking up empty target/debug/resources)
            if path.join("locales").exists() {
                return path.clone();
            }
        }
    }

    // 2. Development Check: Try source paths relative to CWD
    let candidates = [
        PathBuf::from("src-tauri").join("resources"),
        PathBuf::from("resources"),
        PathBuf::from("../src-tauri/resources"),
    ];

    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }

    // Fallback default (even if not exists, to prevent crash)
    PathBuf::from("src-tauri").join("resources")
});

/// Application cache directory (`AxelateData/System/Cache`)
pub static CACHE_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Cache"));

/// Path to env file (`AxelateData/User/Configs/.env`)
pub static FILE_ENV: LazyLock<PathBuf> = LazyLock::new(|| CONFIG_DIR.join(".env"));

/// Path to generation config (`AxelateData/User/Configs/generation_config.json`)
pub static FILE_GEN_CONFIG: LazyLock<PathBuf> =
    LazyLock::new(|| CONFIG_DIR.join("generation_config.json"));

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

/// Initializes the application filesystem structure.
/// Creates all necessary directories if they don't exist.
///
/// # Errors
/// Returns `AppError::Io` if directory creation fails.
pub fn init_filesystem() -> Result<(), AppError> {
    migrate_legacy_windows_system_root()?;

    let dirs = [
        &*APPDATA_ROOT,
        &*LOCALDATA_ROOT,
        &*CONFIG_DIR,
        &*UI_DIR,
        &*SYSTEM_ROOT,
        &*LOG_DIR,
        &*TEMP_DIR,
        &*MODULES_DIR,
        &*MODELS_DIR,
        &*CACHE_DIR,
        &*CHAT_DIR,
    ];

    for dir in dirs {
        fs::create_dir_all(dir)?;
    }

    // Cleanup old log files (keep only last MAX_LOG_FILES)
    cleanup_old_logs()?;

    Ok(())
}

fn migrate_legacy_windows_system_root() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let legacy_system_root = APPDATA_ROOT.join("System");
        if legacy_system_root == *SYSTEM_ROOT || !legacy_system_root.exists() || SYSTEM_ROOT.exists() {
            return Ok(());
        }

        if let Some(parent) = SYSTEM_ROOT.parent() {
            fs::create_dir_all(parent)?;
        }

        match fs::rename(&legacy_system_root, &*SYSTEM_ROOT) {
            Ok(()) => {
                tracing::info!(
                    from = %legacy_system_root.display(),
                    to = %SYSTEM_ROOT.display(),
                    "Migrated legacy system data to Local AppData"
                );
            }
            Err(err) => {
                tracing::warn!(
                    from = %legacy_system_root.display(),
                    to = %SYSTEM_ROOT.display(),
                    error = %err,
                    "Failed to migrate legacy system data; keeping existing layout for this run"
                );
            }
        }
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
