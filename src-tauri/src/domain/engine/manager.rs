//! Engine lifecycle manager
//!
//! Owns active local engine processes. Handles start, stop,
//! health checks, and hot-swap (unload the current engine before loading another).
//!
//! Axelate runs one local engine process at a time by default. Heavy text and
//! image engines compete for the same VRAM/RAM budget, so starts are serialized
//! and a new engine replaces any currently active engine.

use std::collections::HashMap;
use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, OwnedMutexGuard};
use tracing::{error, info, warn};

use crate::errors::AppError;

use super::engine_args::{build_llamacpp_args, build_sdcpp_args, sdcpp_preview_enabled};
use super::engine_runtime::{
    diagnose_engine_start_failure, find_available_local_port, is_endpoint_healthy,
    spawn_log_reader, wait_for_health,
};
use super::events::EngineEventEmitter;
use super::types::{
    Capability, EngineConfig, EngineDefinition, EngineState, EngineStatus, SlotStatus,
};

pub use super::engine_args::resolve_sdcpp_preview_path;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Internal handle for a running engine process
struct RunningEngine {
    /// Engine definition
    definition: EngineDefinition,
    /// Runtime config (retained for restart)
    #[allow(dead_code)]
    config: EngineConfig,
    /// Child process handle
    process: Child,
    /// HTTP endpoint
    endpoint: String,
    /// Whether health check passed
    healthy: bool,
}

/// Manages local engine processes (one per capability slot)
pub struct EngineManager {
    /// Running engines keyed by primary capability
    slots: Arc<Mutex<HashMap<Capability, RunningEngine>>>,
    /// Serializes start/stop transitions so engine launches cannot overlap.
    lifecycle_lock: Arc<Mutex<()>>,
    /// Serializes local inference work so one engine is not stopped mid-request by another.
    workload_lock: Arc<Mutex<()>>,
    /// Known engine definitions (loaded from registry)
    definitions: Arc<Mutex<Vec<EngineDefinition>>>,
    /// Event emitter for frontend progress notifications
    emitter: Arc<dyn EngineEventEmitter>,
}

impl std::fmt::Debug for EngineManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EngineManager").finish()
    }
}

impl EngineManager {
    /// Creates a new engine manager with the given event emitter.
    pub fn new(emitter: Arc<dyn EngineEventEmitter>) -> Self {
        Self {
            slots: Arc::new(Mutex::new(HashMap::new())),
            lifecycle_lock: Arc::new(Mutex::new(())),
            workload_lock: Arc::new(Mutex::new(())),
            definitions: Arc::new(Mutex::new(Vec::new())),
            emitter,
        }
    }

    /// Registers engine definitions (called during init)
    pub async fn register_definitions(&self, defs: Vec<EngineDefinition>) {
        let mut definitions = self.definitions.lock().await;
        *definitions = defs;
    }

    /// Returns all registered engine definitions
    pub async fn list_definitions(&self) -> Vec<EngineDefinition> {
        self.definitions.lock().await.clone()
    }

    /// Checks if a definition exists for the given engine ID
    pub async fn has_definition(&self, id: &str) -> bool {
        let id = canonical_engine_id(id);
        self.definitions.lock().await.iter().any(|d| d.id == id)
    }

    /// Gets the definition for an engine ID
    pub async fn get_definition(&self, id: &str) -> Option<EngineDefinition> {
        let id = canonical_engine_id(id);
        self.definitions
            .lock()
            .await
            .iter()
            .find(|d| d.id == id)
            .cloned()
    }

    /// Gets the current engine state (all active slots)
    pub async fn state(&self) -> EngineState {
        self.prune_dead_slots().await;

        let slots = self.slots.lock().await;
        if slots.is_empty() {
            return EngineState::Idle;
        }
        let slot_statuses: Vec<SlotStatus> = slots
            .iter()
            .map(|(cap, engine)| SlotStatus {
                capability: *cap,
                engine: EngineStatus {
                    id: engine.definition.id.clone(),
                    name: engine.definition.name.clone(),
                    capabilities: engine.definition.capabilities.clone(),
                    endpoint: engine.endpoint.clone(),
                    healthy: engine.healthy,
                },
            })
            .collect();
        EngineState::Ready {
            slots: slot_statuses,
        }
    }

    /// Gets the endpoint for a given capability (if an active engine supports it)
    pub async fn endpoint_for(&self, capability: Capability) -> Option<String> {
        self.prune_dead_slots().await;

        let slots = self.slots.lock().await;
        slots.get(&capability).and_then(|engine| {
            if engine.healthy {
                Some(engine.endpoint.clone())
            } else {
                None
            }
        })
    }

    /// Checks if any active engine supports a capability
    pub async fn supports(&self, capability: Capability) -> bool {
        self.prune_dead_slots().await;
        self.slots.lock().await.contains_key(&capability)
    }

    /// Checks if any engine is currently active
    pub async fn is_active(&self) -> bool {
        self.prune_dead_slots().await;
        !self.slots.lock().await.is_empty()
    }

    /// Gets all active engine IDs
    pub async fn active_ids(&self) -> Vec<String> {
        self.prune_dead_slots().await;
        self.slots
            .lock()
            .await
            .values()
            .map(|e| e.definition.id.clone())
            .collect()
    }

    /// Checks whether the given engine is currently running in any capability slot.
    pub async fn is_engine_running(&self, id: &str) -> bool {
        let id = canonical_engine_id(id);
        self.prune_dead_slots().await;
        self.slots
            .lock()
            .await
            .values()
            .any(|engine| engine.definition.id == id)
    }

    /// Acquires exclusive access to local inference work.
    ///
    /// Hold this guard for the full request, not just engine startup. Without it,
    /// a second local request can hot-swap the running engine while the first
    /// request is still generating.
    pub async fn acquire_local_workload(&self) -> OwnedMutexGuard<()> {
        Arc::clone(&self.workload_lock).lock_owned().await
    }

    /// Returns the active preview file path for the image engine when supported.
    pub async fn active_image_preview_path(&self) -> Option<PathBuf> {
        let slots = self.slots.lock().await;
        let engine = slots.get(&Capability::Image)?;
        if engine.definition.id != "sdcpp" && engine.definition.id != "stable-diffusion" {
            return None;
        }

        if !sdcpp_preview_enabled(&engine.config.extra_args) {
            return None;
        }

        resolve_sdcpp_preview_path(&engine.config.extra_args)
    }

    /// Start an engine in its primary capability slot.
    /// If any other local engine is running, stops it first. This keeps the
    /// launcher on a single active local engine by default.
    pub async fn start(&self, config: EngineConfig) -> Result<EngineStatus, AppError> {
        let _lifecycle_guard = self.lifecycle_lock.lock().await;
        let mut config = config;
        config.engine_id = canonical_engine_id(&config.engine_id);
        let definition = self.find_definition(&config.engine_id).await?;
        let primary_cap = definition
            .capabilities
            .first()
            .copied()
            .unwrap_or(Capability::Text);
        // Check if this exact engine AND model is already running in this slot
        {
            let mut slots = self.slots.lock().await;
            if let Some(existing) = slots.get_mut(&primary_cap) {
                if existing.definition.id == config.engine_id
                    && existing.config.model_path == config.model_path
                {
                    match existing.process.try_wait() {
                        Ok(Some(status)) => {
                            warn!(
                                engine = %config.engine_id,
                                slot = ?primary_cap,
                                exit_status = %status,
                                "Dropping stale engine slot because process already exited"
                            );
                            slots.remove(&primary_cap);
                        }
                        Err(error) => {
                            warn!(
                                engine = %config.engine_id,
                                slot = ?primary_cap,
                                error = %error,
                                "Engine process status check failed; attempting to stop it before dropping slot"
                            );
                            let stale = slots.remove(&primary_cap);
                            drop(slots);
                            if let Some(stale) = stale {
                                match Self::kill_engine_retaining_on_failure(stale).await {
                                    Ok(()) => {}
                                    Err((error, stale)) => {
                                        self.slots.lock().await.insert(primary_cap, stale);
                                        return Err(error);
                                    }
                                }
                            }
                        }
                        Ok(None) => {
                            let status = EngineStatus {
                                id: existing.definition.id.clone(),
                                name: existing.definition.name.clone(),
                                capabilities: existing.definition.capabilities.clone(),
                                endpoint: existing.endpoint.clone(),
                                healthy: existing.healthy,
                            };
                            let endpoint = existing.endpoint.clone();
                            drop(slots);

                            if is_endpoint_healthy(&endpoint).await {
                                info!(engine = %config.engine_id, slot = ?primary_cap, "Engine and model already running in slot");
                                return Ok(status);
                            }

                            warn!(
                                engine = %config.engine_id,
                                slot = ?primary_cap,
                                endpoint = %endpoint,
                                "Dropping stale engine slot because health check failed"
                            );
                            let mut slots = self.slots.lock().await;
                            let stale = slots.remove(&primary_cap);
                            drop(slots);
                            if let Some(stale) = stale {
                                Self::kill_engine(stale).await?;
                            }
                        }
                    }
                } else {
                    // Different engine or model: hot-swap below.
                }
            }
        }

        // Re-check after stale cleanup; a different caller may have started it while we probed.
        {
            let slots = self.slots.lock().await;
            if let Some(existing) = slots.get(&primary_cap) {
                if existing.definition.id == config.engine_id
                    && existing.config.model_path == config.model_path
                {
                    info!(engine = %config.engine_id, slot = ?primary_cap, "Engine and model already running in slot");
                    return Ok(EngineStatus {
                        id: existing.definition.id.clone(),
                        name: existing.definition.name.clone(),
                        capabilities: existing.definition.capabilities.clone(),
                        endpoint: existing.endpoint.clone(),
                        healthy: existing.healthy,
                    });
                }
            }
        }

        // Hot-swap: stop every active engine before starting the next one.
        let old_caps = self.slots.lock().await.keys().copied().collect::<Vec<_>>();
        for old_cap in old_caps {
            let old = self.slots.lock().await.remove(&old_cap);
            let Some(old) = old else {
                continue;
            };
            info!(
                from = %old.definition.id,
                to = %config.engine_id,
                slot = ?old_cap,
                "Hot-swapping active engine"
            );
            self.emitter
                .emit_swapping(&old.definition.id, &config.engine_id);
            if let Err((error, old)) = Self::kill_engine_retaining_on_failure(old).await {
                self.slots.lock().await.insert(old_cap, old);
                return Err(error);
            }
        }

        let binary_name = definition.binary.as_deref().ok_or_else(|| {
            AppError::Config(format!(
                "Engine '{}' has no binary defined",
                config.engine_id
            ))
        })?;

        // Resolve absolute path — never rely on PATH for spawning engines
        let binary_path = super::detector::resolve_engine_binary(&config.engine_id, binary_name)
            .ok_or_else(|| {
                AppError::Config(format!(
                    "Engine binary '{binary_name}' not found. Install engine '{}' first.",
                    config.engine_id
                ))
            })?;

        let selected_port = find_available_local_port(definition.default_port, &config.engine_id)?;
        if selected_port != definition.default_port {
            info!(
                engine = %config.engine_id,
                requested_port = definition.default_port,
                selected_port,
                "Preferred port busy, selected next free localhost port"
            );
        }

        let endpoint = format!("http://localhost:{selected_port}");

        self.emitter.emit_starting(&config.engine_id);

        // Build command with absolute path
        let mut cmd = Command::new(&binary_path);
        cmd.kill_on_drop(true);

        #[cfg(windows)]
        {
            // Local engines are background services. Do not flash a console window for them.
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        if config.engine_id == "llamacpp" {
            cmd.args(build_llamacpp_args(&config, selected_port));
        } else if config.engine_id == "sdcpp" {
            cmd.args(build_sdcpp_args(&config, selected_port));
        } else {
            // Default fallback for other engines
            cmd.arg("--port").arg(selected_port.to_string());
        }

        if config.engine_id != "sdcpp" && config.engine_id != "llamacpp" {
            if let Some(ref model) = config.model_path {
                cmd.arg("--model").arg(model);
            }

            for arg in &config.extra_args {
                cmd.arg(arg);
            }
        }

        if config.engine_id == "llamacpp" {
            if let Some(ref model) = config.model_path {
                cmd.arg("--model").arg(model);
            }
        }

        // Pipe engine stdout/stderr to files in logs directory
        let log_dir =
            crate::utils::paths::ENGINE_LOGS_DIR.join(canonical_engine_log_id(&config.engine_id));
        std::fs::create_dir_all(&log_dir).map_err(|error| {
            AppError::Io(format!(
                "Failed to create engine log directory '{}': {error}",
                log_dir.display()
            ))
        })?;

        let stdout_path = log_dir.join("stdout.log");
        let stderr_path = log_dir.join("stderr.log");

        let stdout_file = File::create(&stdout_path).map_err(|error| {
            AppError::Io(format!(
                "Failed to create engine stdout log '{}': {error}",
                stdout_path.display()
            ))
        })?;
        let stderr_file = File::create(&stderr_path).map_err(|error| {
            AppError::Io(format!(
                "Failed to create engine stderr log '{}': {error}",
                stderr_path.display()
            ))
        })?;

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        info!(
            engine = %config.engine_id,
            binary = %binary_path.display(),
            port = selected_port,
            slot = ?primary_cap,
            stdout = ?stdout_path.display(),
            stderr = ?stderr_path.display(),
            "Starting engine process"
        );

        let mut process = cmd.spawn().map_err(|e| {
            let msg = format!("Failed to start engine '{}': {e}", config.engine_id);
            self.emitter.emit_error(&config.engine_id, &msg);
            AppError::Io(msg)
        })?;

        // Spawn stdout/stderr readers
        if let Some(stdout) = process.stdout.take() {
            spawn_log_reader(
                stdout,
                Some(stdout_file),
                Arc::clone(&self.emitter),
                config.engine_id.clone(),
            );
        }

        if let Some(stderr) = process.stderr.take() {
            spawn_log_reader(
                stderr,
                Some(stderr_file),
                Arc::clone(&self.emitter),
                config.engine_id.clone(),
            );
        }

        let mut running = RunningEngine {
            definition: definition.clone(),
            config,
            process,
            endpoint: endpoint.clone(),
            healthy: false,
        };

        // Wait for health check
        match wait_for_health(&endpoint).await {
            Ok(()) => {
                if let Ok(Some(status)) = running.process.try_wait() {
                    let message = format!(
                        "Engine '{}' exited during startup: {status}",
                        running.definition.id
                    );
                    warn!(engine = %running.definition.id, %status, "Engine exited during startup");
                    self.emitter.emit_error(&running.definition.id, &message);
                    return Err(AppError::External {
                        request_id: None,
                        message,
                    });
                }
                running.healthy = true;
                info!(engine = %running.definition.id, "Engine is healthy");
                self.emitter.emit_ready(&running.definition.id, &endpoint);
            }
            Err(e) => {
                warn!(engine = %running.definition.id, error = %e, "Engine health check failed");
                let diagnosed_message = diagnose_engine_start_failure(&stderr_path)
                    .await
                    .unwrap_or_else(|| e.to_string());
                self.emitter
                    .emit_error(&running.definition.id, &diagnosed_message);
                // Kill the process if health check fails
                if let Err(error) = running.process.kill().await {
                    warn!(
                        engine = %running.definition.id,
                        error = %error,
                        "Failed to kill unhealthy engine process after startup failure"
                    );
                }
                return Err(AppError::External {
                    request_id: None,
                    message: diagnosed_message,
                });
            }
        }

        let status = EngineStatus {
            id: running.definition.id.clone(),
            name: running.definition.name.clone(),
            capabilities: running.definition.capabilities.clone(),
            endpoint: running.endpoint.clone(),
            healthy: running.healthy,
        };

        self.slots.lock().await.insert(primary_cap, running);

        Ok(status)
    }

    /// Emits an error for the engine in a slot, then stops and removes that slot.
    pub async fn stop_slot_after_error(&self, capability: Capability, message: &str) {
        let engine_id = {
            let slots = self.slots.lock().await;
            slots
                .get(&capability)
                .map(|engine| engine.definition.id.clone())
        };

        if let Some(engine_id) = engine_id {
            self.emitter.emit_error(&engine_id, message);
            let _lifecycle_guard = self.lifecycle_lock.lock().await;
            let engine = {
                let mut slots = self.slots.lock().await;
                match slots.get(&capability) {
                    Some(current) if current.definition.id == engine_id => {
                        slots.remove(&capability)
                    }
                    _ => None,
                }
            };

            if let Some(engine) = engine {
                match Self::kill_engine_retaining_on_failure(engine).await {
                    Ok(()) => {}
                    Err((error, engine)) => {
                        self.slots.lock().await.insert(capability, engine);
                        warn!(
                            slot = ?capability,
                            error = %error,
                            "Failed to stop engine slot after runtime error"
                        );
                    }
                }
            }
        }
    }

    /// Stop all running engines
    pub async fn stop(&self) -> Result<(), AppError> {
        let _lifecycle_guard = self.lifecycle_lock.lock().await;
        let engine_caps = self.slots.lock().await.keys().copied().collect::<Vec<_>>();
        let mut errors = Vec::new();
        for cap in engine_caps {
            let engine = self.slots.lock().await.remove(&cap);
            let Some(engine) = engine else {
                continue;
            };
            info!(engine = %engine.definition.id, slot = ?cap, "Stopping engine");
            if let Err((error, engine)) = Self::kill_engine_retaining_on_failure(engine).await {
                warn!(slot = ?cap, error = %error, "Failed to stop engine in slot");
                self.slots.lock().await.insert(cap, engine);
                errors.push(error.to_string());
            }
        }
        if !errors.is_empty() {
            return Err(AppError::Internal {
                request_id: None,
                message: format!("Failed to stop one or more engines: {}", errors.join("; ")),
            });
        }
        Ok(())
    }

    /// Stop engine in a specific capability slot
    pub async fn stop_slot(&self, capability: Capability) -> Result<(), AppError> {
        let _lifecycle_guard = self.lifecycle_lock.lock().await;
        let engine = self.slots.lock().await.remove(&capability);
        if let Some(engine) = engine {
            info!(engine = %engine.definition.id, slot = ?capability, "Stopping engine in slot");
            if let Err((error, engine)) = Self::kill_engine_retaining_on_failure(engine).await {
                self.slots.lock().await.insert(capability, engine);
                return Err(error);
            }
        }
        Ok(())
    }

    /// Kill an engine process and wait for exit
    async fn kill_engine(engine: RunningEngine) -> Result<(), AppError> {
        Self::kill_engine_retaining_on_failure(engine)
            .await
            .map_err(|(error, _engine)| error)
    }

    async fn kill_engine_retaining_on_failure(
        mut engine: RunningEngine,
    ) -> Result<(), (AppError, RunningEngine)> {
        if let Err(e) = engine.process.kill().await {
            error!(engine = %engine.definition.id, error = %e, "Failed to kill engine process");
            return Err((
                AppError::Internal {
                    request_id: None,
                    message: format!("Failed to kill engine '{}': {e}", engine.definition.id),
                },
                engine,
            ));
        }
        if let Err(error) = engine.process.wait().await {
            return Err((
                AppError::Internal {
                    request_id: None,
                    message: format!(
                        "Failed to wait for engine '{}' after kill: {error}",
                        engine.definition.id
                    ),
                },
                engine,
            ));
        }
        info!(engine = %engine.definition.id, "Engine stopped");
        Ok(())
    }

    async fn prune_dead_slots(&self) {
        let mut exited = Vec::new();
        let mut errored = Vec::new();
        {
            let mut slots = self.slots.lock().await;
            for (capability, engine) in slots.iter_mut() {
                match engine.process.try_wait() {
                    Ok(Some(status)) => {
                        warn!(
                            engine = %engine.definition.id,
                            slot = ?capability,
                            exit_status = %status,
                            "Pruning dead engine slot"
                        );
                        exited.push((*capability, engine.definition.id.clone()));
                    }
                    Err(error) => {
                        warn!(
                            engine = %engine.definition.id,
                            slot = ?capability,
                            error = %error,
                            "Engine process status check failed; attempting to stop before pruning"
                        );
                        errored.push((*capability, engine.definition.id.clone()));
                    }
                    Ok(None) => {}
                }
            }

            for (capability, _) in &exited {
                slots.remove(capability);
            }
        }

        for (capability, failed_engine_id) in errored {
            let engine = {
                let mut slots = self.slots.lock().await;
                match slots.get(&capability) {
                    Some(current) if current.definition.id == failed_engine_id => {
                        slots.remove(&capability)
                    }
                    _ => None,
                }
            };
            let Some(engine) = engine else {
                continue;
            };
            let engine_id = engine.definition.id.clone();
            match Self::kill_engine_retaining_on_failure(engine).await {
                Ok(()) => exited.push((capability, engine_id)),
                Err((error, engine)) => {
                    warn!(
                        slot = ?capability,
                        error = %error,
                        "Keeping engine slot because forced stop after status error failed"
                    );
                    self.slots.lock().await.insert(capability, engine);
                }
            }
        }

        for (_, engine_id) in exited {
            self.emitter
                .emit_error(&engine_id, "Local engine process exited.");
        }
    }

    /// Find an engine definition by ID
    async fn find_definition(&self, id: &str) -> Result<EngineDefinition, AppError> {
        let id = canonical_engine_id(id);
        let definitions = self.definitions.lock().await;
        definitions
            .iter()
            .find(|d| d.id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Engine '{id}' not found in registry")))
    }
}

/// Returns the registry id used internally for known engine aliases.
pub fn canonical_engine_id(engine_id: &str) -> String {
    let mut normalized = engine_id
        .trim()
        .to_ascii_lowercase()
        .replace(['.', '_'], "-");
    if let Some(stripped) = normalized.strip_suffix("-cpp") {
        normalized = stripped.to_string();
    }
    while normalized.contains("--") {
        normalized = normalized.replace("--", "-");
    }

    if normalized == "stable-diffusion" || normalized.starts_with("stable-diffusion-") {
        "sdcpp".to_string()
    } else {
        normalized
    }
}

fn canonical_engine_log_id(engine_id: &str) -> String {
    canonical_engine_id(engine_id)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;
    use crate::domain::engine::engine_runtime::classify_engine_start_failure;
    use crate::domain::engine::events::NoopEmitter;
    use crate::domain::engine::types::EngineComputeMode;
    use crate::domain::system::ports::ENGINE_LOCAL_PORT_RANGE;
    use std::net::TcpListener;
    use std::path::PathBuf;

    fn sample_config(model_path: Option<&str>) -> EngineConfig {
        EngineConfig {
            engine_id: "llamacpp".to_string(),
            compute_mode: EngineComputeMode::Gpu,
            context_size: 4096,
            model_path: model_path.map(str::to_string),
            extra_args: vec![],
        }
    }

    fn sample_sdcpp_config(model_path: Option<&str>) -> EngineConfig {
        EngineConfig {
            engine_id: "sdcpp".to_string(),
            compute_mode: EngineComputeMode::Gpu,
            context_size: 4096,
            model_path: model_path.map(str::to_string),
            extra_args: vec![],
        }
    }

    #[test]
    fn builds_single_slot_llamacpp_args_by_default() {
        let args = build_llamacpp_args(&sample_config(None), 8081);
        assert!(args.windows(2).any(|w| w == ["-ngl", "all"]));
        assert!(!args.contains(&"--parallel".to_string()));
        assert!(!args.contains(&"--reasoning".to_string()));
    }

    #[test]
    fn builds_cpu_only_llamacpp_args_when_requested() {
        let mut config = sample_config(None);
        config.compute_mode = EngineComputeMode::Cpu;

        let args = build_llamacpp_args(&config, 8081);

        assert!(args.windows(2).any(|w| w == ["--device", "none"]));
        assert!(args.windows(2).any(|w| w == ["-ngl", "0"]));
    }

    #[test]
    fn clamps_llamacpp_context_size_to_safe_minimum() {
        let mut config = sample_config(None);
        config.context_size = 1024;

        let args = build_llamacpp_args(&config, 8081);
        assert!(args.windows(2).any(|w| w == ["--ctx-size", "4096"]));
    }

    #[test]
    fn picks_preferred_port_when_it_is_free() {
        let port = 8085;
        let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
        drop(listener);

        let selected = find_available_local_port(port, "llamacpp").unwrap();

        assert_eq!(selected, port);
        assert!(ENGINE_LOCAL_PORT_RANGE.contains(&selected));
    }

    #[test]
    fn skips_busy_port_and_uses_next_free_one() {
        let busy_port = 8086;
        let _listener = TcpListener::bind(("127.0.0.1", busy_port)).unwrap();

        let selected = find_available_local_port(busy_port, "llamacpp").unwrap();

        assert_ne!(selected, busy_port);
        assert!(selected > busy_port);
        assert!(ENGINE_LOCAL_PORT_RANGE.contains(&selected));
    }

    #[test]
    fn classifies_gpu_memory_failure_from_log() {
        let message = classify_engine_start_failure(
            "cudaMalloc failed: out of memory\nfailed to allocate compute buffers",
        );

        assert_eq!(
            message.as_deref(),
            Some(
                "Not enough memory to start the local model. Reduce context size, switch compute mode, or use a smaller model."
            )
        );
    }

    #[test]
    fn classifies_system_memory_failure_from_log() {
        let message = classify_engine_start_failure("std::bad_alloc\nThe paging file is too small");

        assert_eq!(
            message.as_deref(),
            Some(
                "Not enough system memory to start the local model. Close other apps or use a smaller model."
            )
        );
    }

    #[test]
    fn builds_plain_sdcpp_model_args() {
        let args = build_sdcpp_args(
            &sample_sdcpp_config(Some("C:/models/sd15.safetensors")),
            8082,
        );

        assert!(args.windows(2).any(|w| w == ["--listen-port", "8082"]));
        assert!(
            args.windows(2)
                .any(|w| w == ["--model", "C:/models/sd15.safetensors"])
        );
    }

    #[test]
    fn builds_cpu_sdcpp_args_when_requested() {
        let mut config = sample_sdcpp_config(Some("C:/models/sd15.safetensors"));
        config.compute_mode = EngineComputeMode::Cpu;

        let args = build_sdcpp_args(&config, 8082);

        assert!(args.contains(&"--clip-on-cpu".to_string()));
        assert!(args.contains(&"--vae-on-cpu".to_string()));
    }

    #[test]
    fn canonicalizes_stable_diffusion_variants_to_sdcpp() {
        assert_eq!(canonical_engine_id("stable-diffusion"), "sdcpp");
        assert_eq!(canonical_engine_id("Stable_Diffusion.cpp"), "sdcpp");
        assert_eq!(canonical_engine_id("stable.diffusion.cpp"), "sdcpp");
    }

    #[tokio::test]
    async fn resolves_stable_diffusion_alias_to_sdcpp_definition() {
        let manager = EngineManager::new(Arc::new(NoopEmitter));
        manager
            .register_definitions(vec![EngineDefinition {
                id: "sdcpp".to_string(),
                name: "Stable Diffusion.cpp".to_string(),
                desc: String::new(),
                icon: String::new(),
                capabilities: vec![Capability::Image],
                binary: Some("sd-server".to_string()),
                repo_url: None,
                version: "1.0.0".to_string(),
                default_port: 8082,
                default_context_size: 4096,
                config_schema: None,
                installed: false,
                managed_externally: false,
            }])
            .await;

        let Some(resolved) = manager.get_definition("stable-diffusion").await else {
            panic!("stable-diffusion alias should resolve to sdcpp");
        };

        assert_eq!(resolved.id, "sdcpp");
    }

    #[test]
    fn sdcpp_keeps_user_supplied_cpu_extra_args() {
        let mut config = sample_sdcpp_config(Some("C:/models/sd15.safetensors"));
        config.extra_args = vec![
            "--offload-to-cpu".to_string(),
            "--clip-on-cpu".to_string(),
            "--vae-on-cpu".to_string(),
            "--mmap".to_string(),
        ];

        let args = build_sdcpp_args(&config, 8082);

        assert!(args.contains(&"--offload-to-cpu".to_string()));
        assert!(args.contains(&"--clip-on-cpu".to_string()));
        assert!(args.contains(&"--vae-on-cpu".to_string()));
        assert!(args.contains(&"--mmap".to_string()));
    }

    #[test]
    fn sdcpp_filters_cli_only_preview_flags_from_server_args() {
        let mut config = sample_sdcpp_config(Some("C:/models/sd15.safetensors"));
        config.extra_args = vec![
            "--preview".to_string(),
            "vae".to_string(),
            "--preview-path".to_string(),
            "C:/tmp/preview.png".to_string(),
            "--preview-interval=1".to_string(),
        ];

        let args = build_sdcpp_args(&config, 8082);

        assert!(!args.contains(&"--preview".to_string()));
        assert!(!args.contains(&"--preview-path".to_string()));
        assert!(!args.contains(&"--preview-interval=1".to_string()));
        assert!(!sdcpp_preview_enabled(&config.extra_args));
        assert!(resolve_sdcpp_preview_path(&config.extra_args).is_none());
    }

    #[test]
    fn sdcpp_filters_unsupported_flags_with_separate_values() {
        let mut config = sample_sdcpp_config(Some("C:/models/sd15.safetensors"));
        config.extra_args = vec![
            "--vae-on-gpu".to_string(),
            "1".to_string(),
            "--mmap".to_string(),
            "--preview-path".to_string(),
            "C:/tmp/preview.png".to_string(),
        ];

        let args = build_sdcpp_args(&config, 8082);

        assert!(!args.contains(&"--vae-on-gpu".to_string()));
        assert!(!args.contains(&"1".to_string()));
        assert!(!args.contains(&"--preview-path".to_string()));
        assert!(!args.contains(&"C:/tmp/preview.png".to_string()));
        assert!(args.contains(&"--mmap".to_string()));
    }

    #[test]
    fn sdcpp_resolves_launcher_preview_path_without_passing_it_to_server() {
        let mut config = sample_sdcpp_config(Some("C:/models/sd15.safetensors"));
        config.extra_args = vec![
            "--sdcpp-preview".to_string(),
            "C:/tmp/sdcpp-preview.png".to_string(),
            "--mmap".to_string(),
        ];

        let args = build_sdcpp_args(&config, 8082);

        assert_eq!(
            resolve_sdcpp_preview_path(&config.extra_args),
            Some(PathBuf::from("C:/tmp/sdcpp-preview.png"))
        );
        assert!(sdcpp_preview_enabled(&config.extra_args));
        assert!(!args.contains(&"--sdcpp-preview".to_string()));
        assert!(!args.contains(&"C:/tmp/sdcpp-preview.png".to_string()));
        assert!(args.contains(&"--mmap".to_string()));
    }

    #[test]
    fn sdcpp_preview_flag_enables_preview_without_explicit_path() {
        let extra_args = vec!["--sdcpp-preview".to_string()];

        assert!(sdcpp_preview_enabled(&extra_args));
        assert!(resolve_sdcpp_preview_path(&extra_args).is_none());
    }
}
