use crate::errors::AppError;
use std::fs::{self, OpenOptions};
use std::io::Write;
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

#[cfg(test)]
const TEST_APPDATA_ROOT_DIR_NAME: &str = "axelate-tests";

#[cfg(test)]
fn cleanup_legacy_test_roots() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    for legacy_root in [
        manifest_dir.join("test_appdata_roaming"),
        manifest_dir.join("test_appdata_local"),
    ] {
        if !legacy_root.exists() {
            continue;
        }

        let _ = fs::remove_dir_all(legacy_root);
    }
}

#[cfg(test)]
fn resolve_test_root(kind: &str) -> PathBuf {
    static CLEANUP_LEGACY_TEST_ROOTS: LazyLock<()> = LazyLock::new(cleanup_legacy_test_roots);
    LazyLock::force(&CLEANUP_LEGACY_TEST_ROOTS);

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

#[cfg(target_os = "windows")]
fn resolve_windows_local_data_root() -> PathBuf {
    #[cfg(test)]
    {
        resolve_test_root("local")
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

/// Engine runtime log files directory (`AxelateData/System/Runtime/Engines/Logs`)
pub static ENGINE_LOGS_DIR: LazyLock<PathBuf> = LazyLock::new(|| ENGINE_RUNTIME_DIR.join("Logs"));

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
    migrate_windows_system_root_to_roaming()?;
    migrate_legacy_module_directories()?;

    for dir in managed_directories() {
        fs::create_dir_all(dir)?;
    }

    migrate_legacy_module_runtime_logs()?;

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

fn append_file(source_path: &Path, target_path: &Path) -> Result<(), AppError> {
    ensure_parent_dir(target_path)?;

    let content = fs::read(source_path)?;
    let mut target = OpenOptions::new()
        .create(true)
        .append(true)
        .open(target_path)?;
    if target_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 0)
    {
        target.write_all(b"\n")?;
    }
    target.write_all(&content)?;
    fs::remove_file(source_path)?;
    Ok(())
}

fn migrate_legacy_module_runtime_logs() -> Result<(), AppError> {
    let legacy_module_logs_dir = LOG_DIR.join("Modules");
    if legacy_module_logs_dir.exists() {
        merge_directories(&legacy_module_logs_dir, &INTEGRATION_LOGS_DIR)?;
        remove_empty_dirs(&legacy_module_logs_dir)?;
    }

    let legacy_engine_logs_dir = LOG_DIR.join("Engines");
    if legacy_engine_logs_dir.exists() {
        merge_directories(&legacy_engine_logs_dir, &ENGINE_LOGS_DIR)?;
        remove_empty_dirs(&legacy_engine_logs_dir)?;
    }

    if !ENGINE_LOGS_DIR.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&*ENGINE_LOGS_DIR)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        let legacy_runtime_log = entry.path().join("runtime.log");
        if !legacy_runtime_log.exists() {
            continue;
        }

        let target_runtime_log = INTEGRATION_LOGS_DIR
            .join(entry.file_name())
            .join("runtime.log");

        if target_runtime_log.exists() {
            append_file(&legacy_runtime_log, &target_runtime_log)?;
        } else {
            move_file(&legacy_runtime_log, &target_runtime_log)?;
        }
    }

    Ok(())
}

fn legacy_engine_ids() -> std::collections::HashSet<String> {
    serde_json::from_str::<Vec<crate::models::config::ModuleItem>>(include_str!(
        "../../resources/config/local_modules.json"
    ))
    .unwrap_or_default()
    .into_iter()
    .filter(|item| item.type_name == "local")
    .map(|item| item.id)
    .collect()
}

fn migrate_legacy_module_directories() -> Result<(), AppError> {
    let legacy_modules_dir = SYSTEM_ROOT.join("Modules");
    if !legacy_modules_dir.exists() {
        return Ok(());
    }

    let engine_ids = legacy_engine_ids();
    fs::create_dir_all(&*INTEGRATIONS_DIR)?;
    fs::create_dir_all(&*ENGINES_DIR)?;

    for entry in fs::read_dir(&legacy_modules_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().to_string();
        let target_root = if engine_ids.contains(&id) {
            &*ENGINES_DIR
        } else {
            &*INTEGRATIONS_DIR
        };
        let target_path = target_root.join(entry.file_name());

        if target_path.exists() {
            merge_directories(&entry.path(), &target_path)?;
            remove_empty_dirs(&entry.path())?;
        } else {
            fs::rename(entry.path(), target_path)?;
        }
    }

    remove_empty_dirs(&legacy_modules_dir)?;
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

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{RESOURCES_DIR_NAME, development_resource_dir_candidates, manifest_dir};

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
}
