use crate::errors::AppError;
use crate::models::{ControlResponse, Module};
use crate::services::{downloader, module_lifecycle};
use std::fs;
use std::process::Command;
use std::str::FromStr;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::AppHandle;

#[derive(Debug)]
pub enum ModuleAction {
    Start,
    Stop,
    Restart,
    Install,
    Uninstall,
    Update,
}

impl FromStr for ModuleAction {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "start" => Ok(ModuleAction::Start),
            "stop" => Ok(ModuleAction::Stop),
            "restart" => Ok(ModuleAction::Restart),
            "install" => Ok(ModuleAction::Install),
            "uninstall" => Ok(ModuleAction::Uninstall),
            "update" => Ok(ModuleAction::Update),
            _ => Err(AppError::Validation(format!("Invalid action: {}", s))),
        }
    }
}

pub fn get_module_status(module_id: &str) -> String {
    let module_path = downloader::get_module_path(module_id);
    let pid_file = module_path.join("module.pid");

    if pid_file.exists() {
        if let Ok(pid_str) = fs::read_to_string(&pid_file)
            && let Ok(pid_val) = pid_str.trim().parse::<usize>()
        {
            let mut sys = System::new();
            // Refresh specific PID only if possible, or all processes
            sys.refresh_processes(ProcessesToUpdate::All, true);

            if sys.process(Pid::from(pid_val)).is_some() {
                return "running".to_string();
            }
        }
        // If we're here, PID file exists but process doesn't - stale file
        let _ = fs::remove_file(pid_file);
    }
    "stopped".to_string()
}

pub fn get_all_modules() -> Vec<Module> {
    let mut modules = Vec::new();
    // Scan modules dir
    if let Ok(entries) = fs::read_dir(&*crate::utils::paths::MODULES_DIR) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type()
                && file_type.is_dir()
            {
                let id = entry.file_name().to_string_lossy().to_string();
                // Try to load manifest for details, or just basic info
                let path = entry.path();
                let (name, version, config_schema) = match module_lifecycle::load_manifest(&path) {
                    Ok(m) => (m.name, m.version, m.config_schema),
                    Err(_) => (id.clone(), "0.0.0".to_string(), None),
                };

                modules.push(Module {
                    id: id.clone(),
                    name,
                    version,
                    status: get_module_status(&id),
                    config_schema,
                });
            }
        }
    }
    modules
}

pub async fn control(
    _app: AppHandle,
    module_id: &str,
    action: ModuleAction,
) -> Result<ControlResponse, AppError> {
    // Handle Uninstall directly
    if let ModuleAction::Uninstall = action {
        downloader::delete_module(module_id).map_err(AppError::Internal)?;
        return Ok(ControlResponse {
            success: true,
            message: format!("Module {} uninstalled successfully", module_id),
            status: None,
        });
    }

    // 0. Validate ID
    downloader::validate_module_id(module_id).map_err(|e| AppError::Validation(e))?;

    // 1. Resolve path
    let module_path = downloader::get_module_path(module_id);
    if !module_path.exists() {
        return Err(AppError::NotFound(format!(
            "Module {} not found at {:?}",
            module_id, module_path
        )));
    }

    // 2. Load Manifest
    let manifest = module_lifecycle::load_manifest(&module_path)
        .map_err(|e| AppError::Config(format!("Failed to load manifest: {}", e)))?;

    // 3. Handle Start/Stop specifically for process management
    match action {
        ModuleAction::Start => {
            let start_script = manifest
                .lifecycle
                .as_ref()
                .and_then(|l| l.start.clone())
                .ok_or_else(|| AppError::Config("No start script defined".to_string()))?;

            log::info!("Spawning start script for {}: {}", module_id, start_script);

            #[cfg(target_os = "windows")]
            let child = Command::new("cmd")
                .args(["/C", &start_script])
                .current_dir(&module_path)
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to spawn process: {}", e)))?;

            #[cfg(not(target_os = "windows"))]
            let child = Command::new("sh")
                .args(["-c", &start_script])
                .current_dir(&module_path)
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to spawn process: {}", e)))?;

            let pid = child.id();
            let pid_file = module_path.join("module.pid");
            if let Err(e) = fs::write(&pid_file, pid.to_string()) {
                log::error!("Failed to write PID file: {}", e);
            }

            Ok(ControlResponse {
                success: true,
                message: format!("Started process with PID {}", pid),
                status: Some("running".to_string()),
            })
        }
        ModuleAction::Stop => {
            let pid_file = module_path.join("module.pid");
            let mut message = String::from("Stopped module");

            // 1. Kill process if PID file exists
            if pid_file.exists() {
                if let Ok(pid_str) = fs::read_to_string(&pid_file) {
                    let pid_str = pid_str.trim();
                    log::info!("Stopping {} (PID: {})", module_id, pid_str);

                    #[cfg(target_os = "windows")]
                    let kill_cmd = Command::new("taskkill")
                        .args(["/F", "/T", "/PID", pid_str])
                        .output();

                    #[cfg(not(target_os = "windows"))]
                    let kill_cmd = Command::new("kill").arg(pid_str).output();

                    match kill_cmd {
                        Ok(output) => {
                            if output.status.success() {
                                message = format!("Successfully killed PID {}", pid_str);
                            } else {
                                let stderr = String::from_utf8_lossy(&output.stderr);
                                message = format!("Failed to kill PID {}: {}", pid_str, stderr);
                                log::error!("{}", message);
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to execute kill command: {}", e);
                        }
                    }
                }
                let _ = fs::remove_file(&pid_file);
            } else {
                message = "No running process found (PID file missing)".to_string();
            }

            // 2. Run stop script if defined (for graceful cleanup)
            if let Some(stop_script) = manifest.lifecycle.as_ref().and_then(|l| l.stop.clone()) {
                log::info!("Running stop script for {}: {}", module_id, stop_script);
                // We run this blocking, just in case
                #[cfg(target_os = "windows")]
                let _ = Command::new("cmd")
                    .args(["/C", &stop_script])
                    .current_dir(&module_path)
                    .output();
            }

            Ok(ControlResponse {
                success: true,
                message,
                status: Some("stopped".to_string()),
            })
        }
        _ => {
            // For other actions (Init, Update, etc.), run blocking as before
            let script = match &manifest.lifecycle {
                Some(scripts) => match action {
                    ModuleAction::Install => scripts.init.clone(),
                    _ => None,
                },
                None => None,
            };

            if let Some(cmd_str) = script {
                log::info!("Executing blocking script for {}: {}", module_id, cmd_str);

                #[cfg(target_os = "windows")]
                let result = Command::new("cmd")
                    .args(["/C", &cmd_str])
                    .current_dir(&module_path)
                    .output();

                #[cfg(not(target_os = "windows"))]
                let result = Command::new("sh")
                    .args(["-c", &cmd_str])
                    .current_dir(&module_path)
                    .output();

                match result {
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let stderr = String::from_utf8_lossy(&output.stderr);

                        if !output.status.success() {
                            return Ok(ControlResponse {
                                success: false,
                                message: format!("Script failed: {}", stderr),
                                status: Some("error".to_string()),
                            });
                        }

                        Ok(ControlResponse {
                            success: true,
                            message: format!(
                                "Executed successfully. Output: {}",
                                stdout.chars().take(100).collect::<String>()
                            ),
                            status: Some("completed".to_string()),
                        })
                    }
                    Err(e) => Err(AppError::Internal(format!(
                        "Failed to launch command: {}",
                        e
                    ))),
                }
            } else {
                Ok(ControlResponse {
                    success: true,
                    message: "No script defined for this action".to_string(),
                    status: Some("skipped".to_string()),
                })
            }
        }
    }
}
