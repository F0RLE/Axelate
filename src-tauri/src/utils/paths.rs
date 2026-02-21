use crate::errors::AppError;
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;

/// Root directory for application data.
/// Defaults to:
/// - Windows: `%APPDATA%/AxelateData`
/// - Linux: `$XDG_CONFIG_HOME/AxelateData` or `~/.config/AxelateData`
/// - macOS: `~/Library/Application Support/AxelateData`
pub static APPDATA_ROOT: LazyLock<PathBuf> = LazyLock::new(|| {
    #[cfg(test)]
    {
        PathBuf::from("./test_appdata_root")
    }

    #[cfg(not(test))]
    {
        // 1. Try standard config dir (e.g. C:\Users\User\AppData\Roaming)
        let mut root = dirs::config_dir();

        // 2. Windows Fallback: Try APPDATA env var explicitly
        #[cfg(target_os = "windows")]
        {
            root = root.or_else(|| std::env::var("APPDATA").ok().map(PathBuf::from));
        }

        // 3. Unix Fallback: Try HOME/.config
        #[cfg(not(target_os = "windows"))]
        {
            root = root.or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|home| PathBuf::from(home).join(".config"))
            });
        }

        // 4. Ultimate Fallback: Current Directory (Development only usually)
        let mut path = root.unwrap_or_else(|| PathBuf::from("."));
        path.push("AxelateData");
        path
    }
});

/// User-specific data root (`AxelateData/User`)
pub static USER_ROOT: LazyLock<PathBuf> = LazyLock::new(|| APPDATA_ROOT.join("User"));

/// Configuration directory for user settings (`AxelateData/User/Configs`)
pub static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("Configs"));

/// Directory for UI persistence state (`AxelateData/User/UI`)
pub static UI_DIR: LazyLock<PathBuf> = LazyLock::new(|| USER_ROOT.join("UI"));

/// System root for internal app data (`AxelateData/System`)
pub static SYSTEM_ROOT: LazyLock<PathBuf> = LazyLock::new(|| APPDATA_ROOT.join("System"));

/// Log files directory (`AxelateData/System/Logs`)
pub static LOG_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Logs"));

/// Temporary files directory (`AxelateData/System/Temp`)
pub static TEMP_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Temp"));

/// Downloaded modules directory (`AxelateData/System/Modules`)
pub static MODULES_DIR: LazyLock<PathBuf> = LazyLock::new(|| SYSTEM_ROOT.join("Modules"));

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

/// Application cache directory (`AxelateData/Cache`)
pub static CACHE_DIR: LazyLock<PathBuf> = LazyLock::new(|| APPDATA_ROOT.join("Cache"));

/// Path to env file (`AxelateData/User/Configs/.env`)
pub static FILE_ENV: LazyLock<PathBuf> = LazyLock::new(|| CONFIG_DIR.join(".env"));

/// Path to generation config (`AxelateData/User/Configs/generation_config.json`)
pub static FILE_GEN_CONFIG: LazyLock<PathBuf> =
    LazyLock::new(|| CONFIG_DIR.join("generation_config.json"));

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
    let dirs = [
        &*CONFIG_DIR,
        &*UI_DIR,
        &*SYSTEM_ROOT,
        &*LOG_DIR,
        &*TEMP_DIR,
        &*MODULES_DIR,
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
