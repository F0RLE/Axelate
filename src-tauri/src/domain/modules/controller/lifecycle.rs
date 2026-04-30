use crate::domain::modules::controller::script_runtime;
use crate::domain::modules::controller::{Controller, process};
use crate::domain::modules::lifecycle::{CommandDefinition, ModuleManifest};
use crate::domain::modules::paths as module_paths;
use crate::errors::AppError;
use crate::models::ControlResponse;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

const MODULE_CHILD_EXIT_POLL_INTERVAL: Duration = Duration::from_secs(1);
static MODULE_LIFECYCLE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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
        let _lifecycle_guard = MODULE_LIFECYCLE_LOCK.lock().await;

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

        if let Some(entry_path) = self.resolve_script_entry_path(manifest)? {
            if let Some(existing_pid) = self
                .reconcile_existing_script_processes(&entry_path)
                .await?
            {
                return Ok(ControlResponse {
                    success: true,
                    message: format!("Module already running with PID {existing_pid}"),
                    status: Some("running".to_string()),
                });
            }
        }

        // 4. Spawn process
        let child = if script_runtime::supports_manifest(manifest) {
            script_runtime::spawn_process(&self.module_id, self.module_path, manifest).await?
        } else {
            // 3. Prepare Logging (runtime.log) with basic capping
            let log_path = self.module_log_path();
            if let Some(log_dir) = log_path.parent() {
                std::fs::create_dir_all(log_dir).map_err(|e| AppError::Io(e.to_string()))?;
            }

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

            let start_cmd = manifest
                .lifecycle
                .as_ref()
                .and_then(|l| l.start.clone())
                .ok_or_else(|| AppError::Config("No start script defined".to_string()))?;

            let mut builder = build_command(start_cmd);
            builder
                .current_dir(self.module_path)
                .stdout(Stdio::from(
                    log_file
                        .try_clone()
                        .map_err(|e| AppError::Io(e.to_string()))?,
                ))
                .stderr(Stdio::from(log_file));
            crate::domain::integration_api::apply_process_env(&mut builder);

            builder.spawn().map_err(|e| AppError::Internal {
                request_id: None,
                message: format!("Failed to spawn process: {e}"),
            })?
        };

        self.register_spawned_child(child).await
    }

    async fn register_spawned_child(&self, mut child: Child) -> Result<ControlResponse, AppError> {
        let Some(pid) = child.id().map(|pid| pid as usize) else {
            self.kill_unregistered_child(&mut child, "missing PID after spawn")
                .await;
            return Err(AppError::Internal {
                request_id: None,
                message: format!("Module {} exited before PID capture", self.module_id),
            });
        };

        self.persist_or_kill_spawned_child(&mut child, pid)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    module_id = %self.module_id,
                    pid,
                    "Failed to publish module PID file after spawn: {error}"
                );
            })?;
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
                        tokio::time::sleep(MODULE_CHILD_EXIT_POLL_INTERVAL).await;
                    }
                    Err(error) => {
                        tracing::warn!(
                            "Failed to poll child status for module {module_id}: {error}"
                        );
                        if let Some((_, mut child)) = controller_registry.remove(&module_id) {
                            if let Err(kill_error) = child.kill().await {
                                tracing::warn!(
                                    module_id = %module_id,
                                    "Failed to kill module after status polling failed: {kill_error}"
                                );
                            }
                            Self::reap_child_after_kill_attempt(&module_id, &mut child).await;
                        }
                        return;
                    }
                }
            }
        });

        Ok(ControlResponse {
            success: true,
            message: format!("Started process with PID {pid}"),
            status: Some("running".to_string()),
        })
    }

    async fn kill_unregistered_child(&self, child: &mut Child, reason: &str) {
        if let Err(error) = child.kill().await {
            tracing::warn!(
                module_id = %self.module_id,
                "Failed to kill spawned module after {reason}: {error}"
            );
        }

        Self::reap_child_after_kill_attempt(&self.module_id, child).await;
    }

    async fn reap_child_after_kill_attempt(module_id: &str, child: &mut Child) {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(
                    module_id,
                    "Failed to poll module child after kill attempt: {error}"
                );
            }
        }

        match timeout(Duration::from_secs(5), child.wait()).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => {
                tracing::warn!(
                    module_id,
                    "Failed to wait module child after kill attempt: {error}"
                );
            }
            Err(_) => {
                tracing::warn!(
                    module_id,
                    "Timed out waiting for module child after kill attempt"
                );
            }
        }
    }

    fn persist_pid(&self, pid: usize) -> Result<(), AppError> {
        let pid_file = self.module_path.join("module.pid");
        let temp_pid_file = self.module_path.join("module.pid.tmp");
        std::fs::write(&temp_pid_file, pid.to_string()).map_err(|error| {
            AppError::Io(format!(
                "Failed to write module PID temp file '{}': {error}",
                temp_pid_file.display()
            ))
        })?;

        std::fs::rename(&temp_pid_file, &pid_file).map_err(|error| {
            let _ = std::fs::remove_file(&temp_pid_file);
            AppError::Io(format!(
                "Failed to publish module PID file '{}' -> '{}': {error}",
                temp_pid_file.display(),
                pid_file.display()
            ))
        })?;

        Ok(())
    }

    async fn persist_or_kill_spawned_child(
        &self,
        child: &mut Child,
        pid: usize,
    ) -> Result<(), AppError> {
        match self.persist_pid(pid) {
            Ok(()) => Ok(()),
            Err(error) => {
                self.kill_unregistered_child(child, "PID publish failure")
                    .await;
                Err(error)
            }
        }
    }

    fn log_reconciled_pid_publish_failure(&self, error: &AppError) {
        tracing::error!(
                module_id = %self.module_id,
                "Failed to publish reconciled module PID file: {error}"
        );
    }

    fn module_log_path(&self) -> PathBuf {
        module_paths::runtime_log_path(&self.module_id)
    }
    /// Gracefully stops a module with escalation
    pub async fn stop(&self, manifest: &ModuleManifest) -> Result<ControlResponse, AppError> {
        let _lifecycle_guard = MODULE_LIFECYCLE_LOCK.lock().await;
        tracing::info!("Stopping module: {}", self.module_id);

        // 1. Run stop script if exists
        if let Some(stop_cmd) = manifest.lifecycle.as_ref().and_then(|l| l.stop.clone()) {
            if let Err(error) = self.run_command(stop_cmd, Duration::from_secs(5)).await {
                tracing::warn!(
                    module_id = %self.module_id,
                    "Module stop script failed, continuing with process termination: {error}"
                );
            }
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

            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(_status)) => {}
                Ok(Err(error)) => {
                    tracing::warn!(
                        module_id = %self.module_id,
                        "Failed to wait registered module process during stop: {error}"
                    );
                    if let Err(kill_error) = child.kill().await {
                        tracing::warn!(
                            module_id = %self.module_id,
                            "Failed to force-kill registered module process after wait error: {kill_error}"
                        );
                    }
                    Self::reap_child_after_kill_attempt(&self.module_id, &mut child).await;
                }
                Err(_) => {
                    tracing::warn!("Module {} stop timed out, forcing kill", self.module_id);
                    if let Err(error) = child.kill().await {
                        tracing::warn!(
                            module_id = %self.module_id,
                            "Failed to force-kill registered module process: {error}"
                        );
                    }
                    Self::reap_child_after_kill_attempt(&self.module_id, &mut child).await;
                }
            }
        }

        let mut process_scan_error = None;
        if let Some(entry_path) = script_entry_path.as_ref()
            && let Err(error) = self.kill_matching_script_processes(entry_path).await
        {
            tracing::warn!(
                "Failed to scan matching script processes for {} during stop: {error}",
                self.module_id
            );
            process_scan_error = Some(error);
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
                    if let Err(error) =
                        crate::domain::modules::controller::process::kill_orphan(pid)
                    {
                        tracing::warn!(
                            module_id = %self.module_id,
                            pid,
                            "Failed to force-kill orphan module process: {error}"
                        );
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        let script_entry_path = self.resolve_script_entry_path(manifest)?;
        if let Some(entry_path) = script_entry_path.as_ref() {
            self.kill_matching_script_processes(entry_path).await?;
        }

        if self
            .controller
            .is_running(&self.module_id, self.module_path)
            .await
        {
            return Err(AppError::Internal {
                request_id: None,
                message: format!("Module {} failed to stop", self.module_id),
            });
        }

        // 4. Cleanup PID file (Wait loop already verified termination)
        match std::fs::remove_file(self.module_path.join("module.pid")) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(
                    module_id = %self.module_id,
                    "Failed to remove module PID file after stop: {error}"
                );
            }
        }

        Ok(ControlResponse {
            success: process_scan_error.is_none(),
            message: process_scan_error.map_or_else(
                || format!("Module {} stopped", self.module_id),
                |error| {
                    format!(
                        "Module {} stopped; process scan failed: {error}",
                        self.module_id
                    )
                },
            ),
            status: Some("stopped".to_string()),
        })
    }

    fn resolve_script_entry_path(
        &self,
        manifest: &ModuleManifest,
    ) -> Result<Option<PathBuf>, AppError> {
        if !script_runtime::supports_manifest(manifest) {
            return Ok(None);
        }

        script_runtime::resolve_entry_path(self.module_path, manifest).map(Some)
    }

    async fn reconcile_existing_script_processes(
        &self,
        entry_path: &Path,
    ) -> Result<Option<usize>, AppError> {
        let matching_pids = self.find_matching_script_processes(entry_path).await?;
        if matching_pids.is_empty() {
            return Ok(None);
        }

        if let Some(&existing_pid) = matching_pids.first()
            && matching_pids.len() == 1
        {
            if let Err(error) = self.persist_pid(existing_pid) {
                self.log_reconciled_pid_publish_failure(&error);
                return Err(error);
            }
            return Ok(Some(existing_pid));
        }

        tracing::warn!(
            "Detected duplicate script module processes for {}: {:?}. Cleaning them before start",
            self.module_id,
            matching_pids
        );

        if let Some(mut child) = self.controller.unregister(&self.module_id) {
            if let Err(error) = child.kill().await {
                tracing::warn!(
                    module_id = %self.module_id,
                    "Failed to kill registered duplicate module child: {error}"
                );
            }
            Self::reap_child_after_kill_attempt(&self.module_id, &mut child).await;
        }

        for pid in matching_pids {
            process::kill_orphan(pid).map_err(|error| AppError::Internal {
                request_id: None,
                message: format!(
                    "Failed to clean duplicate module process {pid} for '{}': {error}",
                    self.module_id
                ),
            })?;
        }

        match std::fs::remove_file(self.module_path.join("module.pid")) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(
                    module_id = %self.module_id,
                    "Failed to remove stale module PID file after duplicate cleanup: {error}"
                );
            }
        }
        Ok(None)
    }

    async fn kill_matching_script_processes(&self, entry_path: &Path) -> Result<(), AppError> {
        for pid in self.find_matching_script_processes(entry_path).await? {
            process::kill_orphan(pid).map_err(|error| AppError::Internal {
                request_id: None,
                message: format!(
                    "Failed to kill module process {pid} for '{}': {error}",
                    self.module_id
                ),
            })?;
        }
        Ok(())
    }

    async fn find_matching_script_processes(
        &self,
        entry_path: &Path,
    ) -> Result<Vec<usize>, AppError> {
        let module_path = self.module_path.to_path_buf();
        let entry_path = entry_path.to_path_buf();

        match tokio::task::spawn_blocking(move || {
            process::find_script_module_processes(&module_path, &entry_path)
        })
        .await
        {
            Ok(pids) => Ok(pids),
            Err(error) => {
                tracing::error!(
                    "Failed to scan matching script module processes for {}: {error}",
                    self.module_id
                );
                Err(AppError::Internal {
                    request_id: None,
                    message: format!(
                        "Failed to scan module processes for '{}': {error}",
                        self.module_id
                    ),
                })
            }
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
    use crate::domain::modules::lifecycle::{
        CommandDefinition, LifecycleScripts, ModuleManifest, ModuleRuntime, ModuleRuntimeKind,
    };
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
            author: None,
            category: None,
            icon: None,
            preview: None,
            readme: None,
            settings_schema: None,
            settings_ui: None,
            runtime: ModuleRuntime {
                kind: ModuleRuntimeKind::Binary,
                version: None,
                entry: "external".to_string(),
                dependencies: None,
                package_manager: None,
            },
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
