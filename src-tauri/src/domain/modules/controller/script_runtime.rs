use crate::domain::modules::lifecycle::ModuleManifest;
use crate::errors::AppError;
use crate::utils::paths::{CONFIG_DIR, LOG_DIR, RUNTIME_DIR};
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::{Child, Command};

const DEFAULT_PYTHON_VERSION: &str = "3.11";
const REQUIREMENTS_STAMP_FILE: &str = ".axelate_requirements.sha256";

/// Returns true when the module can use the shared Python script runtime.
pub fn supports_manifest(manifest: &ModuleManifest) -> bool {
    manifest.entry.as_ref().is_some_and(|entry| {
        Path::new(entry.trim_end())
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("py"))
    })
}

/// Ensures the shared runtime exists and spawns the Python script module process.
pub async fn spawn_process(
    module_path: &Path,
    manifest: &ModuleManifest,
) -> Result<Child, AppError> {
    let entry = manifest
        .entry
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Config("Python script module entry is missing".to_string()))?;

    let runtime_root = python_runtime_root();
    tokio::fs::create_dir_all(&runtime_root)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create Python runtime root: {e}")))?;

    let uv_executable = ensure_uv_available(&runtime_root).await?;
    let python_version = resolve_python_version(module_path)?;
    ensure_virtualenv(&uv_executable, &runtime_root, module_path, &python_version).await?;
    ensure_requirements_installed(&uv_executable, &runtime_root, module_path).await?;

    let python_path = venv_python_path(module_path);
    if !python_path.exists() {
        return Err(AppError::NotFound(format!(
            "Python virtualenv interpreter not found at {}",
            python_path.display()
        )));
    }

    let entry_path = module_path.join(&entry);
    if !entry_path.exists() {
        return Err(AppError::NotFound(format!(
            "Python module entry not found at {}",
            entry_path.display()
        )));
    }

    let module_runtime_root = module_runtime_root(&manifest.id);
    let module_log_dir = module_log_dir(&manifest.id);
    tokio::fs::create_dir_all(&module_log_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create module log directory: {e}")))?;

    let log_path = module_log_dir.join("runtime.log");
    cap_large_log_file(&log_path);
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| AppError::Io(format!("Failed to open runtime log: {e}")))?;

    let mut command = Command::new(&python_path);
    command
        .arg(&entry_path)
        .current_dir(module_path)
        .env("BOT_CONFIG_DIR", CONFIG_DIR.as_os_str())
        .env("AXELATE_CONFIG_DIR", CONFIG_DIR.as_os_str())
        .env("AXELATE_RUNTIME_DIR", runtime_root.as_os_str())
        .env(
            "AXELATE_MODULE_RUNTIME_DIR",
            module_runtime_root.as_os_str(),
        )
        .env("AXELATE_MODULE_ID", &manifest.id)
        .env("AXELATE_HTTP_API_BASE", "http://127.0.0.1:3000")
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONUTF8", "1")
        .stdout(Stdio::from(log_file.try_clone().map_err(|e| {
            AppError::Io(format!("Failed to clone runtime log file: {e}"))
        })?))
        .stderr(Stdio::from(log_file));

    command.spawn().map_err(|e| AppError::Internal {
        request_id: None,
        message: format!("Failed to spawn Python script module: {e}"),
    })
}

fn python_runtime_root() -> PathBuf {
    RUNTIME_DIR.join("Python")
}

fn module_runtime_root(module_id: &str) -> PathBuf {
    RUNTIME_DIR.join("Modules").join(module_id)
}

fn module_log_dir(module_id: &str) -> PathBuf {
    LOG_DIR.join("Engines").join(module_id)
}

fn uv_install_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join("uv")
}

fn uv_cache_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join("cache")
}

fn managed_python_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join("managed")
}

fn uv_binary_path(runtime_root: &Path) -> PathBuf {
    let file_name = if cfg!(target_os = "windows") {
        "uv.exe"
    } else {
        "uv"
    };
    uv_install_dir(runtime_root).join(file_name)
}

fn venv_dir(module_path: &Path) -> PathBuf {
    module_path.join(".venv")
}

fn venv_python_path(module_path: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir(module_path).join("Scripts").join("python.exe")
    } else {
        venv_dir(module_path).join("bin").join("python")
    }
}

fn requirements_stamp_path(module_path: &Path) -> PathBuf {
    venv_dir(module_path).join(REQUIREMENTS_STAMP_FILE)
}

fn cap_large_log_file(log_path: &Path) {
    if let Ok(metadata) = fs::metadata(log_path)
        && metadata.len() > 10 * 1024 * 1024
    {
        tracing::info!(
            "Truncating large Python module runtime log at {} ({} bytes)",
            log_path.display(),
            metadata.len()
        );
        let _ = fs::remove_file(log_path);
    }
}

fn resolve_python_version(module_path: &Path) -> Result<String, AppError> {
    let version_path = module_path.join(".python-version");
    if !version_path.exists() {
        return Ok(DEFAULT_PYTHON_VERSION.to_string());
    }

    let version = fs::read_to_string(&version_path).map_err(|e| {
        AppError::Io(format!(
            "Failed to read python version file at {}: {e}",
            version_path.display()
        ))
    })?;

    let normalized = version.trim().to_string();
    if normalized.is_empty() {
        Ok(DEFAULT_PYTHON_VERSION.to_string())
    } else {
        Ok(normalized)
    }
}

async fn ensure_uv_available(runtime_root: &Path) -> Result<OsString, AppError> {
    let bundled_uv = uv_binary_path(runtime_root);
    if bundled_uv.exists() {
        return Ok(bundled_uv.into_os_string());
    }

    if command_available("uv").await {
        return Ok(OsString::from("uv"));
    }

    install_uv(runtime_root).await?;

    let bundled_uv = uv_binary_path(runtime_root);
    if bundled_uv.exists() {
        Ok(bundled_uv.into_os_string())
    } else {
        Err(AppError::NotFound(format!(
            "uv was not installed into {}",
            uv_install_dir(runtime_root).display()
        )))
    }
}

async fn command_available(program: &str) -> bool {
    match Command::new(program)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
    {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

async fn install_uv(runtime_root: &Path) -> Result<(), AppError> {
    tokio::fs::create_dir_all(uv_install_dir(runtime_root))
        .await
        .map_err(|e| AppError::Io(format!("Failed to create uv install directory: {e}")))?;

    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("powershell");
        command.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "irm https://astral.sh/uv/install.ps1 | iex",
        ]);
        command
    } else {
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "if command -v curl >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh; elif command -v wget >/dev/null 2>&1; then wget -qO- https://astral.sh/uv/install.sh | sh; else echo 'curl or wget is required to install uv' >&2; exit 1; fi",
        ]);
        command
    };

    command
        .env(
            "UV_UNMANAGED_INSTALL",
            uv_install_dir(runtime_root).as_os_str(),
        )
        .env("UV_NO_MODIFY_PATH", "1");

    run_command(command, "Failed to install uv").await
}

async fn ensure_virtualenv(
    uv_executable: &OsString,
    runtime_root: &Path,
    module_path: &Path,
    python_version: &str,
) -> Result<(), AppError> {
    if venv_python_path(module_path).exists() {
        return Ok(());
    }

    let mut command = Command::new(uv_executable);
    command
        .arg("venv")
        .arg(venv_dir(module_path))
        .arg("--python")
        .arg(python_version)
        .env("UV_CACHE_DIR", uv_cache_dir(runtime_root).as_os_str())
        .env(
            "UV_PYTHON_INSTALL_DIR",
            managed_python_dir(runtime_root).as_os_str(),
        )
        .env("UV_PYTHON_PREFERENCE", "managed")
        .current_dir(module_path);

    run_command(command, "Failed to create Python virtual environment").await
}

async fn ensure_requirements_installed(
    uv_executable: &OsString,
    runtime_root: &Path,
    module_path: &Path,
) -> Result<(), AppError> {
    let requirements_path = module_path.join("requirements.txt");
    if !requirements_path.exists() {
        return Ok(());
    }

    let requirements_hash = compute_sha256(&requirements_path)?;
    let stamp_path = requirements_stamp_path(module_path);
    if stamp_path.exists()
        && fs::read_to_string(&stamp_path)
            .map(|value| value.trim().to_string())
            .ok()
            .is_some_and(|value| value == requirements_hash)
    {
        return Ok(());
    }

    let mut command = Command::new(uv_executable);
    command
        .arg("pip")
        .arg("install")
        .arg("--python")
        .arg(venv_python_path(module_path))
        .arg("-r")
        .arg(&requirements_path)
        .env("UV_CACHE_DIR", uv_cache_dir(runtime_root).as_os_str())
        .env(
            "UV_PYTHON_INSTALL_DIR",
            managed_python_dir(runtime_root).as_os_str(),
        )
        .env("UV_PYTHON_PREFERENCE", "managed")
        .current_dir(module_path);

    run_command(command, "Failed to install Python module requirements").await?;

    if let Some(parent) = stamp_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AppError::Io(format!(
                "Failed to create requirements stamp directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    fs::write(&stamp_path, format!("{requirements_hash}\n")).map_err(|e| {
        AppError::Io(format!(
            "Failed to write requirements stamp at {}: {e}",
            stamp_path.display()
        ))
    })?;

    Ok(())
}

fn compute_sha256(path: &Path) -> Result<String, AppError> {
    let content = fs::read(path).map_err(|e| {
        AppError::Io(format!(
            "Failed to read file for hashing at {}: {e}",
            path.display()
        ))
    })?;

    Ok(hex::encode(Sha256::digest(content)))
}

async fn run_command(mut command: Command, context: &str) -> Result<(), AppError> {
    let output = command.output().await.map_err(|e| AppError::External {
        request_id: None,
        message: format!("{context}: {e}"),
    })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "Unknown command failure".to_string()
    };

    Err(AppError::External {
        request_id: None,
        message: format!("{context}: {details}"),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::*;

    fn manifest_with_entry(entry: Option<&str>) -> ModuleManifest {
        ModuleManifest {
            api_version: "1".to_string(),
            id: "python-script-module".to_string(),
            name: "Python Script Module".to_string(),
            version: "1.0.0".to_string(),
            description: String::new(),
            author: None,
            category: None,
            icon: None,
            readme: None,
            settings_schema: None,
            settings_ui: None,
            entry: entry.map(ToString::to_string),
            dependencies: Vec::new(),
            lifecycle: None,
            config_schema: None,
        }
    }

    #[test]
    fn supports_manifest_accepts_python_entries() {
        assert!(supports_manifest(&manifest_with_entry(Some("src/main.py"))));
        assert!(!supports_manifest(&manifest_with_entry(Some("main.ts"))));
        assert!(!supports_manifest(&manifest_with_entry(None)));
    }

    #[test]
    fn resolve_python_version_uses_default_when_file_missing() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let version = resolve_python_version(temp_dir.path()).expect("python version");
        assert_eq!(version, DEFAULT_PYTHON_VERSION);
    }
}
