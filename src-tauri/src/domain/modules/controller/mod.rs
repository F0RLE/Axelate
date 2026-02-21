use crate::domain::modules::{downloader, lifecycle as module_lifecycle};
use crate::errors::AppError;
use crate::models::{ControlResponse, Module};
use dashmap::DashMap;
use std::path::Path;
use std::str::FromStr;
use tauri::AppHandle;
use tokio::fs;
use tokio::process::Child;

/// Lifecycle management logic
pub mod lifecycle;
/// OS-specific process monitoring
pub mod process;

pub use self::lifecycle::LifecycleExecutor;

/// In-memory registry for active child processes.
static PROCESS_REGISTRY: std::sync::LazyLock<DashMap<String, Child>> =
    std::sync::LazyLock::new(DashMap::new);

/// High-level API for module control
#[derive(Debug)]
pub struct Controller {
    pub(crate) registry: &'static DashMap<String, Child>,
}

impl Default for Controller {
    fn default() -> Self {
        Self::new()
    }
}

impl Controller {
    /// Creates a new instance of the module controller.
    pub fn new() -> Self {
        Self {
            registry: &PROCESS_REGISTRY,
        }
    }

    /// Checks if a module is currently running (checking memory first, then PID file fallback)
    pub async fn is_running(&self, module_id: &str, module_path: &Path) -> bool {
        // 1. Check in-memory registry
        if let Some(child) = self.registry.get(module_id)
            && let Some(pid) = child.id()
            && process::is_running(pid as usize)
        {
            return true;
        }

        // 2. Fallback to PID file (e.g. if app restarted but module stayed alive)
        let pid_file = module_path.join("module.pid");
        if pid_file.exists()
            && let Ok(pid_str) = fs::read_to_string(&pid_file).await
            && let Ok(pid) = pid_str.trim().parse::<usize>()
            && process::is_running(pid)
        {
            return true;
        }

        false
    }

    /// Registers a new active child process
    pub fn register(&self, module_id: String, child: Child) {
        self.registry.insert(module_id, child);
    }

    /// Unregisters a process
    pub fn unregister(&self, module_id: &str) -> Option<Child> {
        self.registry.remove(module_id).map(|(_, child)| child)
    }
}

// ==================================================================================
// Public API Bridge
// ==================================================================================

/// Module control actions (start, stop, etc.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleAction {
    /// Start the module process
    Start,
    /// Stop the module process
    Stop,
    /// Stop and then start the module
    Restart,
    /// Run installation hooks
    Install,
    /// Cleanly remove module files
    Uninstall,
    /// Run update hooks
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

/// Scans directories for modules
pub async fn get_all_modules() -> Vec<Module> {
    let mut modules = Vec::new();
    let controller = Controller::new();

    if let Ok(mut entries) = fs::read_dir(&*crate::utils::paths::MODULES_DIR).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(file_type) = entry.file_type().await
                && file_type.is_dir()
            {
                let id = entry.file_name().to_string_lossy().to_string();
                let path = entry.path();

                let (name, version, config_schema) =
                    match module_lifecycle::ManifestLoader::load(&path) {
                        Ok(m) => (m.name, m.version, m.config_schema),
                        Err(_) => (id.clone(), "0.0.0".to_string(), None),
                    };

                let status = if controller.is_running(&id, &path).await {
                    "running".to_string()
                } else {
                    "stopped".to_string()
                };

                modules.push(Module {
                    id: id.clone(),
                    name,
                    description: String::new(),
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

/// Gets the runtime status of a specific module.
pub async fn get_module_status(module_id: &str) -> String {
    let controller = Controller::new();
    let module_path = downloader::get_module_path(module_id);
    if controller.is_running(module_id, &module_path).await {
        "running".to_string()
    } else {
        "stopped".to_string()
    }
}

/// Main entry point for controlling module lifecycle actions.
pub async fn control(
    _app: AppHandle,
    module_id: &str,
    action: ModuleAction,
) -> Result<ControlResponse, AppError> {
    let controller = Controller::new();
    downloader::validate_module_id(module_id)?;
    let module_path = downloader::get_module_path(module_id);

    if action == ModuleAction::Uninstall {
        let executor = LifecycleExecutor::new(&controller, module_id.to_string(), &module_path);
        if let Ok(manifest) = module_lifecycle::ManifestLoader::load(&module_path) {
            let _ = executor.stop(&manifest).await;
        } else {
            let pid_file = module_path.join("module.pid");
            if let Ok(pid_str) = std::fs::read_to_string(&pid_file)
                && let Ok(pid) = pid_str.trim().parse::<usize>()
            {
                let _ = process::kill_orphan(pid);
            }
        }
        downloader::delete_module(module_id).await?;
        return Ok(ControlResponse {
            success: true,
            message: format!("Module {module_id} uninstalled successfully"),
            status: None,
        });
    }

    if !module_path.exists() {
        return Err(AppError::NotFound(format!("Module {module_id} not found")));
    }

    let manifest = module_lifecycle::ManifestLoader::load(&module_path)?;
    let executor = LifecycleExecutor::new(&controller, module_id.to_string(), &module_path);

    match action {
        ModuleAction::Start => executor.start(&manifest).await,
        ModuleAction::Stop => Ok(executor.stop(&manifest).await),
        ModuleAction::Restart => {
            tracing::info!("Restarting module: {module_id}");
            let _ = executor.stop(&manifest).await;

            // Wait for it to actually die (up to 5s) with survival check
            let mut terminated = false;
            for attempt in 0..20 {
                if !controller.is_running(module_id, &module_path).await {
                    terminated = true;
                    tracing::info!(
                        "Module {module_id} terminated after {attempt} attempts during restart"
                    );
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }

            if !terminated {
                return Err(AppError::Internal {
                    request_id: None,
                    message: format!("Module {module_id} failed to terminate during restart"),
                });
            }

            executor.start(&manifest).await
        }
        _ => Ok(ControlResponse {
            success: false,
            message: "Not implemented".to_string(),
            status: None,
        }),
    }
}
