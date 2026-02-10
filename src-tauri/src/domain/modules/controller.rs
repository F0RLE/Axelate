use crate::domain::modules::{downloader, lifecycle as module_lifecycle};
use crate::errors::AppError;
use crate::models::{ControlResponse, Module};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::AppHandle;

/// Module control actions
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleAction {
    /// Start a module
    Start,
    /// Stop a module
    Stop,
    /// Restart a module
    Restart,
    /// Install a module
    Install,
    /// Uninstall a module
    Uninstall,
    /// Update a module
    Update,
}

impl FromStr for ModuleAction {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "start" => Ok(Self::Start),
            "stop" => Ok(Self::Stop),
            "restart" => Ok(Self::Restart),
            "install" => Ok(Self::Install),
            "uninstall" => Ok(Self::Uninstall),
            "update" => Ok(Self::Update),
            _ => Err(AppError::Validation(format!("Invalid action: {s}"))),
        }
    }
}

/// Manages low-level process operations (PID files, spawning, killing)
struct ProcessManager;

impl ProcessManager {
    /// Checks if a process with the given PID is running
    fn is_running(pid: usize) -> bool {
        let mut sys = System::new();
        // Refresh specific PID only if possible, or all processes
        sys.refresh_processes(ProcessesToUpdate::All, true);
        sys.process(Pid::from(pid)).is_some()
    }

    /// Reads a PID from a file if it exists and is valid
    fn read_pid_file(path: &Path) -> Option<usize> {
        if path.exists() {
            if let Ok(pid_str) = fs::read_to_string(path) {
                return pid_str.trim().parse::<usize>().ok();
            }
        }
        None
    }

    /// Writes a PID to a file
    fn write_pid_file(path: &Path, pid: u32) -> Result<(), AppError> {
        fs::write(path, pid.to_string())
            .map_err(|e| AppError::Internal(format!("Failed to write PID file: {e}")))
    }

    /// Removes a PID file if it exists
    fn remove_pid_file(path: &Path) {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    /// Spawns a background process using the appropriate shell
    fn spawn_background(script: &str, cwd: &Path) -> Result<u32, AppError> {
        log::info!("Spawning background script: {script}");

        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("cmd");
        #[cfg(target_os = "windows")]
        let cmd = cmd.args(["/C", script]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        let cmd = cmd.args(["-c", script]);

        let child = cmd
            .current_dir(cwd)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to spawn process: {e}")))?;

        Ok(child.id())
    }

    /// Runs a blocking command and returns its output
    fn run_blocking(script: &str, cwd: &Path) -> Result<String, AppError> {
        log::info!("Executing blocking script: {script}");

        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("cmd");
        #[cfg(target_os = "windows")]
        let cmd = cmd.args(["/C", script]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        let cmd = cmd.args(["-c", script]);

        let output = cmd
            .current_dir(cwd)
            .output()
            .map_err(|e| AppError::Internal(format!("Failed to launch command: {e}")))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(AppError::Internal(format!("Script failed: {stderr}")));
        }

        Ok(stdout)
    }

    /// Kills a process by PID
    fn kill_process(pid: usize) -> Result<String, String> {
        let pid_str = pid.to_string();
        log::info!("Killing process PID: {pid_str}");

        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("taskkill");
        #[cfg(target_os = "windows")]
        let cmd = cmd.args(["/F", "/T", "/PID", &pid_str]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("kill");
        #[cfg(not(target_os = "windows"))]
        let cmd = cmd.arg(&pid_str);

        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    Ok(format!("Successfully killed PID {pid_str}"))
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Err(format!("Failed to kill PID {pid_str}: {stderr}"))
                }
            }
            Err(e) => Err(format!("Failed to execute kill command: {e}")),
        }
    }
}

/// Scans directories for modules
struct ModuleScanner;

impl ModuleScanner {
    /// returns all installed modules found in the modules directory
    fn scan_all() -> Vec<Module> {
        let mut modules = Vec::new();
        // Scan modules dir
        if let Ok(entries) = fs::read_dir(&*crate::utils::paths::MODULES_DIR) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type()
                    && file_type.is_dir()
                {
                    let id = entry.file_name().to_string_lossy().to_string();
                    let path = entry.path();

                    // Try to load manifest for details, or fallback to basic info
                    let (name, version, config_schema) =
                        match module_lifecycle::ManifestLoader::load(&path) {
                            Ok(m) => (m.name, m.version, m.config_schema),
                            Err(_) => (id.clone(), "0.0.0".to_string(), None),
                        };

                    // Determine status dynamically
                    let status = ModuleController::get_status_from_path(&path);

                    modules.push(Module {
                        id: id.clone(),
                        name,
                        description: String::new(), // Default description
                        version,
                        author: String::new(),
                        category: "service".to_string(),
                        icon: String::new(),
                        path: path.to_string_lossy().to_string(),
                        installed: true,
                        local: true,
                        enabled: true,
                        status: Some(status),
                        is_deletable: true,
                        config: std::collections::HashMap::new(),
                        config_schema,
                    });
                }
            }
        }
        modules
    }
}

/// High-level controller for module lifecycle actions
struct ModuleController {
    module_id: String,
    module_path: PathBuf,
}

impl ModuleController {
    fn new(module_id: &str) -> Result<Self, AppError> {
        // Validation logic
        downloader::validate_module_id(module_id)?;
        let module_path = downloader::get_module_path(module_id);

        if !module_path.exists() {
            return Err(AppError::NotFound(format!(
                "Module {module_id} not found at {}",
                module_path.display()
            )));
        }

        Ok(Self {
            module_id: module_id.to_string(),
            module_path,
        })
    }

    /// Gets status string by checking PID file in the given path
    fn get_status_from_path(path: &Path) -> String {
        let pid_file = path.join("module.pid");
        if let Some(pid) = ProcessManager::read_pid_file(&pid_file) {
            if ProcessManager::is_running(pid) {
                return "running".to_string();
            }
            // Stale PID file
            ProcessManager::remove_pid_file(&pid_file);
        }
        "stopped".to_string()
    }

    /// Orchestrates the requested action
    fn execute(&self, action: ModuleAction) -> Result<ControlResponse, AppError> {
        match action {
            ModuleAction::Start => self.start(),
            ModuleAction::Stop => self.stop(),
            ModuleAction::Restart => self.restart(),
            ModuleAction::Install => self.run_lifecycle_script("init"),
            ModuleAction::Update => self.run_lifecycle_script("update"), // Assuming 'update' script might exist or just generic script execution
            // Uninstall is handled specially before creating the controller usually, but if called here:
            ModuleAction::Uninstall => {
                // Deletion logic should likely be outside or careful here as self.module_path will vanish
                // But strictly following the signature:
                downloader::delete_module(&self.module_id)?;
                Ok(ControlResponse {
                    success: true,
                    message: format!("Module {} uninstalled successfully", self.module_id),
                    status: None,
                })
            }
        }
    }

    fn start(&self) -> Result<ControlResponse, AppError> {
        let manifest = module_lifecycle::ManifestLoader::load(&self.module_path)
            .map_err(|e| AppError::Config(format!("Failed to load manifest: {e}")))?;

        let start_script = manifest
            .lifecycle
            .as_ref()
            .and_then(|l| l.start.clone())
            .ok_or_else(|| AppError::Config("No start script defined".to_string()))?;

        let pid = ProcessManager::spawn_background(&start_script, &self.module_path)?;
        ProcessManager::write_pid_file(&self.module_path.join("module.pid"), pid)?;

        Ok(ControlResponse {
            success: true,
            message: format!("Started process with PID {pid}"),
            status: Some("running".to_string()),
        })
    }

    fn stop(&self) -> Result<ControlResponse, AppError> {
        let pid_file = self.module_path.join("module.pid");
        let message = if let Some(pid) = ProcessManager::read_pid_file(&pid_file) {
            let msg = match ProcessManager::kill_process(pid) {
                Ok(msg) => msg,
                Err(e) => {
                    log::error!("{e}");
                    e
                }
            };
            ProcessManager::remove_pid_file(&pid_file);
            msg
        } else {
            "No running process found (PID file missing)".to_string()
        };

        // 2. Run stop hook
        let _ = self.run_lifecycle_script_silent("stop");

        Ok(ControlResponse {
            success: true,
            message,
            status: Some("stopped".to_string()),
        })
    }

    fn restart(&self) -> Result<ControlResponse, AppError> {
        let _ = self.stop()?;
        // Short delay could be added here if needed
        self.start()
    }

    /// Runs a lifecycle script (init, update, stop) blocking
    fn run_lifecycle_script(&self, script_name: &str) -> Result<ControlResponse, AppError> {
        let manifest = module_lifecycle::ManifestLoader::load(&self.module_path)
            .map_err(|e| AppError::Config(format!("Failed to load manifest: {e}")))?;

        // Map action name to script field
        let script = manifest.lifecycle.as_ref().and_then(|scripts| {
            match script_name {
                "init" => scripts.init.clone(),
                "stop" => scripts.stop.clone(),
                // Add others if Manifest supports them, currently 'update' isn't in LifecycleScripts struct shown previously
                // defaulting to None if not found
                _ => None,
            }
        });

        if let Some(cmd) = script {
            match ProcessManager::run_blocking(&cmd, &self.module_path) {
                Ok(output) => Ok(ControlResponse {
                    success: true,
                    message: format!(
                        "Executed successfully. Output: {}",
                        output.chars().take(100).collect::<String>()
                    ),
                    status: Some("completed".to_string()),
                }),
                Err(e) => Ok(ControlResponse {
                    success: false,
                    message: format!("Script failed: {e}"),
                    status: Some("error".to_string()),
                }),
            }
        } else {
            Ok(ControlResponse {
                success: true,
                message: "No script defined for this action".to_string(),
                status: Some("skipped".to_string()),
            })
        }
    }

    /// Helper for stop script which shouldn't fail the whole stop operation
    fn run_lifecycle_script_silent(&self, script_name: &str) -> Option<()> {
        match self.run_lifecycle_script(script_name) {
            Ok(_) => Some(()),
            Err(e) => {
                log::warn!("Silent script execution failed: {e}");
                None
            }
        }
    }
}

// ==================================================================================
// Public API Wrappers
// ==================================================================================

/// Gets the runtime status of a module (running/stopped)
pub fn get_module_status(module_id: &str) -> String {
    let module_path = downloader::get_module_path(module_id);
    ModuleController::get_status_from_path(&module_path)
}

/// Scans and returns all installed modules
pub fn get_all_modules() -> Vec<Module> {
    ModuleScanner::scan_all()
}

/// Controls a module (start, stop, restart, install, uninstall, update)
#[allow(clippy::needless_pass_by_value)]
pub fn control(
    _app: AppHandle,
    module_id: &str,
    action: ModuleAction,
) -> Result<ControlResponse, AppError> {
    // Handle Uninstall separately if the module folder might be gone or we want to bypass Controller init
    if matches!(action, ModuleAction::Uninstall) {
        // We can use the controller if the folder exists, or fall back to direct deletion
        // But let's stay consistent. If folder exists, use controller to stop it first?
        // Simplest is direct call as before if we want to support uninstalling broken modules
        downloader::delete_module(module_id)?;
        return Ok(ControlResponse {
            success: true,
            message: format!("Module {module_id} uninstalled successfully"),
            status: None,
        });
    }

    let controller = ModuleController::new(module_id)?;
    controller.execute(action)
}
