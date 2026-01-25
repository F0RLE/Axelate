use once_cell::sync::Lazy;
use std::fs;
use std::path::PathBuf;

pub static APPDATA_ROOT: Lazy<PathBuf> = Lazy::new(|| {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("FluxData");
    path
});

pub static USER_ROOT: Lazy<PathBuf> = Lazy::new(|| APPDATA_ROOT.join("User"));
pub static CONFIG_DIR: Lazy<PathBuf> = Lazy::new(|| USER_ROOT.join("Configs"));
pub static UI_DIR: Lazy<PathBuf> = Lazy::new(|| USER_ROOT.join("UI"));

pub static SYSTEM_ROOT: Lazy<PathBuf> = Lazy::new(|| APPDATA_ROOT.join("System"));
pub static LOG_DIR: Lazy<PathBuf> = Lazy::new(|| SYSTEM_ROOT.join("Logs"));
pub static TEMP_DIR: Lazy<PathBuf> = Lazy::new(|| SYSTEM_ROOT.join("Temp"));
pub static MODULES_DIR: Lazy<PathBuf> = Lazy::new(|| SYSTEM_ROOT.join("Modules"));

// Points to src-tauri/resources during dev. In prod this should be handled differently (e.g. resource_dir)
// Points to src-tauri/resources during dev. In prod this should be handled differently (e.g. resource_dir)
pub static RESOURCES_DIR: Lazy<PathBuf> = Lazy::new(|| {
    // Try multiple possible locations
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

    // Fallback default
    PathBuf::from("src-tauri").join("resources")
});

pub static CACHE_DIR: Lazy<PathBuf> = Lazy::new(|| APPDATA_ROOT.join("Cache"));

pub static FILE_ENV: Lazy<PathBuf> = Lazy::new(|| CONFIG_DIR.join(".env"));
pub static FILE_GEN_CONFIG: Lazy<PathBuf> = Lazy::new(|| CONFIG_DIR.join("generation_config.json"));
pub static FILE_UI_STATE: Lazy<PathBuf> = Lazy::new(|| UI_DIR.join("ui_state.json"));

/// Maximum number of log files to keep
const MAX_LOG_FILES: usize = 5;

pub fn init_filesystem() -> Result<(), String> {
    let dirs = [
        &*CONFIG_DIR,
        &*UI_DIR,
        &*SYSTEM_ROOT,
        &*LOG_DIR,
        &*TEMP_DIR,
        &*MODULES_DIR,
        &*CACHE_DIR,
    ];

    for dir in dirs {
        fs::create_dir_all(dir).map_err(|e| format!("Failed to create {:?}: {}", dir, e))?;
    }

    // Cleanup old log files (keep only last MAX_LOG_FILES)
    cleanup_old_logs()?;

    Ok(())
}

/// Remove old log files, keeping only the most recent MAX_LOG_FILES
fn cleanup_old_logs() -> Result<(), String> {
    if !LOG_DIR.exists() {
        return Ok(());
    }

    let mut log_files: Vec<_> = fs::read_dir(&*LOG_DIR)
        .map_err(|e| format!("Failed to read logs dir: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
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
            log::warn!("Failed to remove old log file {:?}: {}", entry.path(), e);
        }
    }

    Ok(())
}
