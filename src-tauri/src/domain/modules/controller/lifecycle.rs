use crate::domain::modules::controller::Controller;
use crate::domain::modules::lifecycle::{CommandDefinition, ModuleManifest};
use crate::errors::AppError;
use crate::models::ControlResponse;
use std::fs::OpenOptions;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

fn build_command(cmd: CommandDefinition) -> Command {
    match cmd {
        CommandDefinition::Simple(script) => {
            #[cfg(target_os = "windows")]
            {
                let mut command = Command::new("cmd");
                command.args(["/C", &script]);
                command
            }
            #[cfg(not(target_os = "windows"))]
            {
                let mut command = Command::new("sh");
                command.args(["-c", &script]);
                command
            }
        }
        CommandDefinition::Structured { program, args } => {
            let mut command = Command::new(program);
            command.args(args);
            command
        }
    }
}

/// Orchestrates the lifecycle transitions for a module
#[derive(Debug)]
pub struct LifecycleExecutor<'a> {
    controller: &'a Controller,
    module_id: String,
    module_path: &'a Path,
}

impl<'a> LifecycleExecutor<'a> {
    /// Creates a new lifecycle executor for a specific module.
    pub const fn new(controller: &'a Controller, module_id: String, module_path: &'a Path) -> Self {
        Self {
            controller,
            module_id,
            module_path,
        }
    }

    /// Safely starts a module with the given manifest
    pub async fn start(&self, manifest: &ModuleManifest) -> Result<ControlResponse, AppError> {
        // 1. Guard against double-start
        // Check registry first (atomic-ish)
        if self.controller.registry.contains_key(&self.module_id) {
            return Ok(ControlResponse {
                success: true,
                message: "Module is already in registry (starting or running)".to_string(),
                status: Some("running".to_string()),
            });
        }

        if self
            .controller
            .is_running(&self.module_id, self.module_path)
            .await
        {
            return Ok(ControlResponse {
                success: true,
                message: "Module is already running (PID file)".to_string(),
                status: Some("running".to_string()),
            });
        }

        // 2. Select start command
        let start_cmd = manifest
            .lifecycle
            .as_ref()
            .and_then(|l| l.start.clone())
            .ok_or_else(|| AppError::Config("No start script defined".to_string()))?;

        // 3. Prepare Logging (runtime.log) with basic capping
        let log_path = self.module_path.join("runtime.log");

        // Simple log capping: if file > 10MB, truncate it
        if let Ok(metadata) = std::fs::metadata(&log_path)
            && metadata.len() > 10 * 1024 * 1024
        {
            tracing::info!(
                "Truncating large runtime.log ({} bytes) for {module_id}",
                metadata.len(),
                module_id = self.module_id
            );
            let _ = std::fs::remove_file(&log_path);
        }

        let log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| AppError::Internal {
                request_id: None,
                message: format!("Failed to open runtime.log: {e}"),
            })?;

        // 4. Spawn process
        let mut builder = build_command(start_cmd);

        builder
            .current_dir(self.module_path)
            .stdout(Stdio::from(
                log_file
                    .try_clone()
                    .map_err(|e| AppError::Io(e.to_string()))?,
            ))
            .stderr(Stdio::from(log_file));

        let child = builder.spawn().map_err(|e| AppError::Internal {
            request_id: None,
            message: format!("Failed to spawn process: {e}"),
        })?;

        let pid = child.id().unwrap_or(0);
        let module_id = self.module_id.clone();
        let controller_registry = self.controller.registry; // Pass registry reference to the task

        // 5. Register child in memory & Spawn auto-cleanup task
        self.controller.register(self.module_id.clone(), child);

        tokio::spawn(async move {
            loop {
                let outcome = {
                    let Some(mut child_entry) = controller_registry.get_mut(&module_id) else {
                        return;
                    };

                    child_entry.try_wait()
                };

                match outcome {
                    Ok(Some(_status)) => {
                        controller_registry.remove(&module_id);
                        tracing::info!(
                            "Module {module_id} exited naturally and was cleaned up from registry"
                        );
                        return;
                    }
                    Ok(None) => {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                    Err(error) => {
                        tracing::warn!(
                            "Failed to poll child status for module {module_id}: {error}"
                        );
                        controller_registry.remove(&module_id);
                        return;
                    }
                }
            }
        });

        // 6. Write PID file (atomic write)
        let pid_file = self.module_path.join("module.pid");
        let temp_pid_file = self.module_path.join("module.pid.tmp");
        if let Err(e) = std::fs::write(&temp_pid_file, pid.to_string()) {
            tracing::error!("Failed to write temp PID file: {e}");
        } else {
            let _ = std::fs::rename(temp_pid_file, pid_file);
        }

        Ok(ControlResponse {
            success: true,
            message: format!("Started process with PID {pid}"),
            status: Some("running".to_string()),
        })
    }

    /// Gracefully stops a module with escalation
    pub async fn stop(&self, manifest: &ModuleManifest) -> ControlResponse {
        tracing::info!("Stopping module: {}", self.module_id);

        // 1. Run stop script if exists
        if let Some(stop_cmd) = manifest.lifecycle.as_ref().and_then(|l| l.stop.clone()) {
            let _ = self.run_command(stop_cmd, Duration::from_secs(5)).await;
        }

        // 2. Attempt soft termination and wait
        let mut child_opt = self.controller.unregister(&self.module_id);

        // If we have a child handle in registry, we can wait on it
        if let Some(mut child) = child_opt.take() {
            // On Unix, try SIGTERM first
            #[cfg(not(target_os = "windows"))]
            {
                let pid = child.id().unwrap_or(0);
                if pid > 0 {
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGTERM);
                    }
                }
            }

            // Wait with timeout
            if timeout(Duration::from_secs(5), child.wait()).await.is_err() {
                tracing::warn!("Module {} stop timed out, forcing kill", self.module_id);
                let _ = child.kill().await;
            }
        }

        // 3. Escalation check (fallback for orphans or if still running)
        for attempt in 0..10 {
            if !self
                .controller
                .is_running(&self.module_id, self.module_path)
                .await
            {
                tracing::info!(
                    "Module {} successfully stopped after {} attempts",
                    self.module_id,
                    attempt
                );
                break;
            }
            if attempt == 9 {
                tracing::error!(
                    "Module {} still running after escalation, final force kill",
                    self.module_id
                );
                let pid_file = self.module_path.join("module.pid");
                if let Ok(pid_str) = std::fs::read_to_string(&pid_file)
                    && let Ok(pid) = pid_str.trim().parse::<usize>()
                {
                    // Safe kill_orphan now includes existence check
                    let _ = crate::domain::modules::controller::process::kill_orphan(pid);
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        // 4. Cleanup PID file (Wait loop already verified termination)
        let _ = std::fs::remove_file(self.module_path.join("module.pid"));

        ControlResponse {
            success: true,
            message: format!("Module {} stopped", self.module_id),
            status: Some("stopped".to_string()),
        }
    }

    async fn run_command(
        &self,
        cmd: CommandDefinition,
        limit: Duration,
    ) -> Result<String, AppError> {
        let mut builder = build_command(cmd);

        builder.current_dir(self.module_path);

        match timeout(limit, builder.output()).await {
            Ok(Ok(output)) => {
                if output.status.success() {
                    Ok(String::from_utf8_lossy(&output.stdout).to_string())
                } else {
                    Err(AppError::Internal {
                        request_id: None,
                        message: String::from_utf8_lossy(&output.stderr).to_string(),
                    })
                }
            }
            Ok(Err(e)) => Err(AppError::Io(e.to_string())),
            Err(_) => Err(AppError::Internal {
                request_id: None,
                message: "Command timed out".to_string(),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::panic)]

    use super::LifecycleExecutor;
    use crate::domain::modules::controller::Controller;
    use crate::domain::modules::lifecycle::{CommandDefinition, LifecycleScripts, ModuleManifest};
    use std::time::Duration;

    fn test_start_command() -> CommandDefinition {
        #[cfg(target_os = "windows")]
        {
            CommandDefinition::Simple("ping -n 2 127.0.0.1 > nul".to_string())
        }

        #[cfg(not(target_os = "windows"))]
        {
            CommandDefinition::Simple("sleep 1".to_string())
        }
    }

    #[tokio::test]
    async fn start_keeps_process_registered_until_exit() {
        let controller = Controller::new();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let module_id = format!("registry_test_{}", uuid::Uuid::new_v4());
        let manifest = ModuleManifest {
            api_version: "1".to_string(),
            id: module_id.clone(),
            name: "Registry Test".to_string(),
            version: "1.0.0".to_string(),
            description: String::new(),
            entry: None,
            dependencies: Vec::new(),
            lifecycle: Some(LifecycleScripts {
                init: None,
                start: Some(test_start_command()),
                stop: None,
                health: None,
            }),
            config_schema: None,
        };

        let executor = LifecycleExecutor::new(&controller, module_id.clone(), temp_dir.path());
        executor
            .start(&manifest)
            .await
            .expect("start should succeed");

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            controller.registry.contains_key(&module_id),
            "process must stay registered while still running"
        );

        for _ in 0..20 {
            if !controller.registry.contains_key(&module_id) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }

        if let Some(mut child) = controller.unregister(&module_id) {
            let _ = child.kill().await;
        }
        panic!("process registry entry was not cleaned up after exit");
    }
}
