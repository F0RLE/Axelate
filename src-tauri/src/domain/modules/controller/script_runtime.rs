use crate::domain::integration_api::SDK_API_VERSION;
use crate::domain::modules::lifecycle::{ModuleManifest, ModuleRuntimeKind};
use crate::domain::modules::paths as module_paths;
use crate::errors::AppError;
use crate::utils::paths::{CONFIG_DIR, RUNTIME_DIR};
use sha2::{Digest, Sha256};
use std::ffi::{OsStr, OsString};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::{Child, Command};

const DEFAULT_PYTHON_VERSION: &str = "3.11";
const PYTHON_REQUIREMENTS_STAMP_FILE: &str = ".axelate_requirements.sha256";
const JS_DEPENDENCIES_STAMP_FILE: &str = ".axelate_dependencies.sha256";

/// Returns true when the module can use a launcher-managed script runtime.
pub const fn supports_manifest(manifest: &ModuleManifest) -> bool {
    matches!(
        manifest.runtime.kind,
        ModuleRuntimeKind::Python | ModuleRuntimeKind::Node | ModuleRuntimeKind::Bun
    )
}

/// Resolves and validates the script entry path inside the module root.
pub fn resolve_entry_path(
    module_path: &Path,
    manifest: &ModuleManifest,
) -> Result<PathBuf, AppError> {
    if !supports_manifest(manifest) {
        return Err(AppError::Config(
            "Module runtime is not launcher-managed".to_string(),
        ));
    }

    let entry = manifest.runtime.entry.trim();
    if entry.is_empty() {
        return Err(AppError::Config(
            "Module runtime entry is missing".to_string(),
        ));
    }

    if Path::new(entry).is_absolute() {
        return Err(AppError::Validation(
            "Module runtime entry must be relative to the module root".to_string(),
        ));
    }

    let entry_path = module_path.join(entry);
    if !entry_path.exists() {
        return Err(AppError::NotFound(format!(
            "Module runtime entry not found at {}",
            entry_path.display()
        )));
    }

    let module_root = fs::canonicalize(module_path).map_err(|e| {
        AppError::Io(format!(
            "Failed to resolve module root {}: {e}",
            module_path.display()
        ))
    })?;
    let entry_path = fs::canonicalize(&entry_path).map_err(|e| {
        AppError::Io(format!(
            "Failed to resolve module runtime entry {}: {e}",
            entry_path.display()
        ))
    })?;

    if !entry_path.starts_with(&module_root) {
        return Err(AppError::Validation(
            "Module runtime entry cannot point outside the module root".to_string(),
        ));
    }

    Ok(entry_path)
}

/// Ensures the shared runtime exists and spawns the Python script module process.
pub async fn spawn_process(
    module_id: &str,
    module_path: &Path,
    manifest: &ModuleManifest,
) -> Result<Child, AppError> {
    match manifest.runtime.kind {
        ModuleRuntimeKind::Python => spawn_python_process(module_id, module_path, manifest).await,
        ModuleRuntimeKind::Node => spawn_node_process(module_id, module_path, manifest).await,
        ModuleRuntimeKind::Bun => spawn_bun_process(module_id, module_path, manifest).await,
        ModuleRuntimeKind::Binary => Err(AppError::Config(
            "Binary modules must define lifecycle.start".to_string(),
        )),
    }
}

async fn spawn_python_process(
    module_id: &str,
    module_path: &Path,
    manifest: &ModuleManifest,
) -> Result<Child, AppError> {
    let entry_path = resolve_entry_path(module_path, manifest)?;

    let runtime_root = python_runtime_root();
    tokio::fs::create_dir_all(&runtime_root)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create Python runtime root: {e}")))?;

    let uv_executable = ensure_uv_available(&runtime_root).await?;
    let python_version = resolve_python_version(manifest);
    ensure_virtualenv(
        &uv_executable,
        &runtime_root,
        module_id,
        module_path,
        &python_version,
    )
    .await?;
    ensure_requirements_installed(
        &uv_executable,
        &runtime_root,
        module_id,
        module_path,
        manifest,
        &python_version,
    )
    .await?;

    let python_path = venv_python_path(&runtime_root, module_id, &python_version);
    if !python_path.exists() {
        return Err(AppError::NotFound(format!(
            "Python runtime interpreter not found at {}",
            python_path.display()
        )));
    }

    let mut command = Command::new(&python_path);
    command
        .arg(&entry_path)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONUTF8", "1");

    spawn_runtime_command(module_id, module_path, &runtime_root, command, "Python").await
}

async fn spawn_node_process(
    module_id: &str,
    module_path: &Path,
    manifest: &ModuleManifest,
) -> Result<Child, AppError> {
    let entry_path = resolve_entry_path(module_path, manifest)?;
    let runtime_root = node_runtime_root();
    let version = resolve_runtime_version(manifest, "system");
    tokio::fs::create_dir_all(&runtime_root)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create Node runtime root: {e}")))?;

    let node_executable = find_node_executable().await?;
    let npm_executable = find_program("npm").await?;
    let env_dir = js_env_dir(&runtime_root, module_id, &version);
    ensure_js_dependencies_installed(JsDependencyInstall {
        package_manager: &npm_executable,
        runtime_root: &runtime_root,
        env_dir: &env_dir,
        module_path,
        manifest,
        module_id,
        version: &version,
        default_package_manager: "npm",
    })
    .await?;

    let mut command = Command::new(node_executable);
    command
        .arg(entry_path)
        .env("NODE_PATH", env_dir.join("node_modules"))
        .env("AXELATE_NODE_ENV_DIR", env_dir);

    spawn_runtime_command(module_id, module_path, &runtime_root, command, "Node").await
}

async fn spawn_bun_process(
    module_id: &str,
    module_path: &Path,
    manifest: &ModuleManifest,
) -> Result<Child, AppError> {
    let entry_path = resolve_entry_path(module_path, manifest)?;
    let runtime_root = bun_runtime_root();
    let version = resolve_runtime_version(manifest, "system");
    tokio::fs::create_dir_all(&runtime_root)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create Bun runtime root: {e}")))?;

    let bun_executable = find_program("bun").await?;
    let env_dir = js_env_dir(&runtime_root, module_id, &version);
    ensure_js_dependencies_installed(JsDependencyInstall {
        package_manager: &bun_executable,
        runtime_root: &runtime_root,
        env_dir: &env_dir,
        module_path,
        manifest,
        module_id,
        version: &version,
        default_package_manager: "bun",
    })
    .await?;

    let mut command = Command::new(bun_executable);
    command
        .arg(entry_path)
        .env("NODE_PATH", env_dir.join("node_modules"))
        .env("AXELATE_BUN_ENV_DIR", env_dir);

    spawn_runtime_command(module_id, module_path, &runtime_root, command, "Bun").await
}

async fn spawn_runtime_command(
    module_id: &str,
    module_path: &Path,
    language_runtime_root: &Path,
    mut command: Command,
    runtime_name: &str,
) -> Result<Child, AppError> {
    let module_runtime_root = module_paths::runtime_root(module_id);
    let module_log_dir = module_paths::log_dir(module_id);
    tokio::fs::create_dir_all(&module_runtime_root)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create module runtime directory: {e}")))?;
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

    command
        .current_dir(module_path)
        .env("BOT_CONFIG_DIR", CONFIG_DIR.as_os_str())
        .env("AXELATE_SDK_VERSION", SDK_API_VERSION)
        .env("AXELATE_CONFIG_DIR", CONFIG_DIR.as_os_str())
        .env("AXELATE_RUNTIME_DIR", RUNTIME_DIR.as_os_str())
        .env(
            "AXELATE_LANGUAGE_RUNTIME_DIR",
            language_runtime_root.as_os_str(),
        )
        .env(
            "AXELATE_MODULE_RUNTIME_DIR",
            module_runtime_root.as_os_str(),
        )
        .env("AXELATE_MODULE_DIR", module_path.as_os_str())
        .env("AXELATE_MODULE_LOG_DIR", module_log_dir.as_os_str())
        .env("AXELATE_MODULE_ID", module_id)
        .stdout(Stdio::from(log_file.try_clone().map_err(|e| {
            AppError::Io(format!("Failed to clone runtime log file: {e}"))
        })?))
        .stderr(Stdio::from(log_file));
    crate::domain::integration_api::apply_process_env(&mut command, module_id);

    command.spawn().map_err(|e| AppError::Internal {
        request_id: None,
        message: format!("Failed to spawn {runtime_name} module runtime: {e}"),
    })
}

fn python_runtime_root() -> PathBuf {
    RUNTIME_DIR.join("Python")
}

fn node_runtime_root() -> PathBuf {
    RUNTIME_DIR.join("Node")
}

fn bun_runtime_root() -> PathBuf {
    RUNTIME_DIR.join("Bun")
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

fn module_envs_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join("envs")
}

fn uv_binary_path(runtime_root: &Path) -> PathBuf {
    let file_name = if cfg!(target_os = "windows") {
        "uv.exe"
    } else {
        "uv"
    };
    uv_install_dir(runtime_root).join(file_name)
}

fn module_env_name(module_id: &str) -> String {
    stable_path_segment(module_id, "module")
}

fn python_env_name(python_version: &str) -> String {
    stable_path_segment(python_version, "python")
}

fn runtime_version_name(version: &str) -> String {
    stable_path_segment(version, "runtime")
}

fn stable_path_segment(value: &str, fallback_prefix: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            normalized.push(character);
        } else {
            normalized.push('_');
        }
    }

    let normalized = normalized.trim_matches(|character| matches!(character, '.' | '_' | '-'));
    if normalized.is_empty() {
        let hash = Sha256::digest(value.as_bytes());
        format!("{}-{}", fallback_prefix, &hex::encode(hash)[..12])
    } else if normalized == value {
        normalized.to_string()
    } else {
        let hash = Sha256::digest(value.as_bytes());
        format!("{}-{}", normalized, &hex::encode(hash)[..12])
    }
}

fn venv_dir(runtime_root: &Path, module_id: &str, python_version: &str) -> PathBuf {
    module_envs_dir(runtime_root)
        .join(python_env_name(python_version))
        .join(module_env_name(module_id))
}

fn venv_python_path(runtime_root: &Path, module_id: &str, python_version: &str) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir(runtime_root, module_id, python_version)
            .join("Scripts")
            .join("python.exe")
    } else {
        venv_dir(runtime_root, module_id, python_version)
            .join("bin")
            .join("python")
    }
}

fn requirements_stamp_path(runtime_root: &Path, module_id: &str, python_version: &str) -> PathBuf {
    venv_dir(runtime_root, module_id, python_version).join(PYTHON_REQUIREMENTS_STAMP_FILE)
}

fn js_env_dir(runtime_root: &Path, module_id: &str, version: &str) -> PathBuf {
    module_envs_dir(runtime_root)
        .join(runtime_version_name(version))
        .join(module_env_name(module_id))
}

fn js_dependencies_stamp_path(env_dir: &Path) -> PathBuf {
    env_dir.join(JS_DEPENDENCIES_STAMP_FILE)
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

fn resolve_python_version(manifest: &ModuleManifest) -> String {
    resolve_runtime_version(manifest, DEFAULT_PYTHON_VERSION)
}

fn resolve_runtime_version(manifest: &ModuleManifest, default_version: &str) -> String {
    manifest
        .runtime
        .version
        .as_deref()
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .unwrap_or(default_version)
        .to_string()
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

async fn find_program(program: &str) -> Result<OsString, AppError> {
    if command_available(program).await {
        Ok(OsString::from(program))
    } else {
        Err(AppError::NotFound(format!(
            "{program} is required by the module runtime but was not found"
        )))
    }
}

async fn find_node_executable() -> Result<OsString, AppError> {
    let bundled_node = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join("Axelate-deps").join("node").join("node.exe"));
    if let Some(path) = bundled_node
        && path.exists()
    {
        return Ok(path.into_os_string());
    }

    find_program("node").await
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
    module_id: &str,
    module_path: &Path,
    python_version: &str,
) -> Result<(), AppError> {
    if venv_python_path(runtime_root, module_id, python_version).exists() {
        return Ok(());
    }

    let mut command = Command::new(uv_executable);
    command
        .arg("venv")
        .arg(venv_dir(runtime_root, module_id, python_version))
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
    module_id: &str,
    module_path: &Path,
    manifest: &ModuleManifest,
    python_version: &str,
) -> Result<(), AppError> {
    let Some(dependencies_path) = manifest.runtime.dependencies.as_deref() else {
        return Ok(());
    };
    let requirements_path = module_path.join(dependencies_path);

    let requirements_hash = compute_sha256(&requirements_path)?;
    let stamp_path = requirements_stamp_path(runtime_root, module_id, python_version);
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
        .arg(venv_python_path(runtime_root, module_id, python_version))
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

struct JsDependencyInstall<'a> {
    package_manager: &'a OsString,
    runtime_root: &'a Path,
    env_dir: &'a Path,
    module_path: &'a Path,
    manifest: &'a ModuleManifest,
    module_id: &'a str,
    version: &'a str,
    default_package_manager: &'a str,
}

async fn ensure_js_dependencies_installed(args: JsDependencyInstall<'_>) -> Result<(), AppError> {
    let JsDependencyInstall {
        package_manager,
        runtime_root,
        env_dir,
        module_path,
        manifest,
        module_id,
        version,
        default_package_manager,
    } = args;

    let Some(dependencies_path) = manifest.runtime.dependencies.as_deref() else {
        return Ok(());
    };

    let dependencies_path = module_path.join(dependencies_path);
    let dependencies_hash = compute_sha256(&dependencies_path)?;
    let stamp_path = js_dependencies_stamp_path(env_dir);
    if stamp_path.exists()
        && fs::read_to_string(&stamp_path)
            .map(|value| value.trim().to_string())
            .ok()
            .is_some_and(|value| value == dependencies_hash)
    {
        return Ok(());
    }

    fs::create_dir_all(env_dir).map_err(|e| {
        AppError::Io(format!(
            "Failed to create JavaScript dependency env {}: {e}",
            env_dir.display()
        ))
    })?;
    let target_manifest = env_dir.join(
        dependencies_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("package.json")),
    );
    fs::copy(&dependencies_path, &target_manifest).map_err(|e| {
        AppError::Io(format!(
            "Failed to copy dependency manifest to {}: {e}",
            target_manifest.display()
        ))
    })?;

    let manager = manifest
        .runtime
        .package_manager
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_package_manager);

    let mut command = Command::new(package_manager);
    match manager {
        "npm" => {
            command.arg("install").arg("--prefix").arg(env_dir);
        }
        "bun" => {
            command.arg("install").arg("--cwd").arg(env_dir);
        }
        other => {
            return Err(AppError::Validation(format!(
                "Unsupported package manager '{other}' for module {module_id}"
            )));
        }
    }
    command
        .env("AXELATE_RUNTIME_DIR", RUNTIME_DIR.as_os_str())
        .env("AXELATE_LANGUAGE_RUNTIME_DIR", runtime_root.as_os_str())
        .env("UV_CACHE_DIR", uv_cache_dir(runtime_root).as_os_str())
        .current_dir(module_path);

    run_command(
        command,
        &format!("Failed to install {manager} dependencies for {module_id}@{version}"),
    )
    .await?;

    fs::write(&stamp_path, format!("{dependencies_hash}\n")).map_err(|e| {
        AppError::Io(format!(
            "Failed to write dependency stamp at {}: {e}",
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
    use crate::domain::modules::lifecycle::ModuleRuntime;

    fn manifest_with_runtime(kind: ModuleRuntimeKind, entry: &str) -> ModuleManifest {
        ModuleManifest {
            api_version: "1".to_string(),
            id: "python-script-module".to_string(),
            name: "Python Script Module".to_string(),
            version: "1.0.0".to_string(),
            description: String::new(),
            author: None,
            category: None,
            icon: None,
            preview: None,
            readme: None,
            settings_schema: None,
            settings_ui: None,
            runtime: ModuleRuntime {
                kind,
                version: Some("3.11".to_string()),
                entry: entry.to_string(),
                dependencies: None,
                package_manager: None,
            },
            lifecycle: None,
            config_schema: None,
        }
    }

    #[test]
    fn supports_manifest_accepts_managed_runtimes() {
        assert!(supports_manifest(&manifest_with_runtime(
            ModuleRuntimeKind::Python,
            "src/main.py"
        )));
        assert!(supports_manifest(&manifest_with_runtime(
            ModuleRuntimeKind::Node,
            "src/main.js"
        )));
        assert!(supports_manifest(&manifest_with_runtime(
            ModuleRuntimeKind::Bun,
            "src/main.ts"
        )));
        assert!(!supports_manifest(&manifest_with_runtime(
            ModuleRuntimeKind::Binary,
            "external"
        )));
    }

    #[test]
    fn resolve_entry_path_rejects_entries_outside_module_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let outside_entry = temp_dir.path().join("outside.py");
        fs::write(&outside_entry, "print('outside')").expect("write outside entry");
        let module_dir = temp_dir.path().join("module");
        fs::create_dir_all(&module_dir).expect("module dir");

        let result = resolve_entry_path(
            &module_dir,
            &manifest_with_runtime(ModuleRuntimeKind::Python, "../outside.py"),
        );

        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    #[test]
    fn resolve_entry_path_accepts_entries_inside_module_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let src_dir = temp_dir.path().join("src");
        fs::create_dir_all(&src_dir).expect("src dir");
        let entry_path = src_dir.join("main.py");
        fs::write(&entry_path, "print('ok')").expect("write entry");

        let resolved = resolve_entry_path(
            temp_dir.path(),
            &manifest_with_runtime(ModuleRuntimeKind::Python, "src/main.py"),
        )
        .expect("resolved entry");

        assert_eq!(
            resolved,
            fs::canonicalize(entry_path).expect("canonical entry")
        );
    }

    #[test]
    fn resolve_python_version_uses_default_when_manifest_omits_version() {
        let mut manifest = manifest_with_runtime(ModuleRuntimeKind::Python, "src/main.py");
        manifest.runtime.version = None;

        let version = resolve_python_version(&manifest);
        assert_eq!(version, DEFAULT_PYTHON_VERSION);
    }

    #[test]
    fn venv_dir_uses_launcher_runtime_not_module_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let runtime_root = temp_dir.path().join("Runtime").join("Python");
        let module_root = temp_dir.path().join("Modules").join("sample-integration");

        let venv = venv_dir(&runtime_root, "Axelate-sample-integration", "3.11");

        assert!(venv.starts_with(&runtime_root));
        assert!(!venv.starts_with(&module_root));
        assert_eq!(
            venv,
            runtime_root
                .join("envs")
                .join("3.11")
                .join(module_env_name("Axelate-sample-integration"))
        );
    }

    #[test]
    fn module_env_name_rejects_path_separators() {
        let name = module_env_name("../bad\\module");

        assert!(!name.contains('/'));
        assert!(!name.contains('\\'));
        assert!(!name.starts_with('.'));
    }

    #[test]
    fn requirements_stamp_lives_in_runtime_venv() {
        let runtime_root = Path::new("C:/AxelateData/System/Runtime/Python");
        let stamp_path = requirements_stamp_path(runtime_root, "sample-integration", "3.12");

        assert_eq!(
            stamp_path,
            runtime_root
                .join("envs")
                .join("3.12")
                .join("sample-integration")
                .join(PYTHON_REQUIREMENTS_STAMP_FILE)
        );
    }

    #[test]
    fn python_version_is_part_of_venv_path() {
        let runtime_root = Path::new("C:/AxelateData/System/Runtime/Python");

        assert_ne!(
            venv_dir(runtime_root, "sample-integration", "3.11"),
            venv_dir(runtime_root, "sample-integration", "3.12")
        );
    }
}
