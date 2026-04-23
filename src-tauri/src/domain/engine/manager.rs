//! Engine lifecycle manager
//!
//! Owns active local engine processes. Handles start, stop,
//! health checks, and hot-swap (unload one engine before loading another).
//!
//! Supports **multiple capability slots** — e.g. a text engine and an
//! image engine can run simultaneously, each occupying its own slot.
//! Within a slot, only one engine is loaded at a time (hot-swap).

use std::collections::HashMap;
use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::errors::AppError;

use super::engine_args::{build_llamacpp_args, build_sdcpp_args, sdcpp_preview_enabled};
use super::engine_runtime::{
    diagnose_engine_start_failure, find_available_local_port, spawn_log_reader, wait_for_health,
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
        self.definitions.lock().await.iter().any(|d| d.id == id)
    }

    /// Gets the definition for an engine ID
    pub async fn get_definition(&self, id: &str) -> Option<EngineDefinition> {
        self.definitions
            .lock()
            .await
            .iter()
            .find(|d| d.id == id)
            .cloned()
    }

    /// Gets the current engine state (all active slots)
    pub async fn state(&self) -> EngineState {
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
        self.slots.lock().await.contains_key(&capability)
    }

    /// Checks if any engine is currently active
    pub async fn is_active(&self) -> bool {
        !self.slots.lock().await.is_empty()
    }

    /// Gets all active engine IDs
    pub async fn active_ids(&self) -> Vec<String> {
        self.slots
            .lock()
            .await
            .values()
            .map(|e| e.definition.id.clone())
            .collect()
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
    /// If another engine occupies that slot, stops it first (hot-swap).
    /// Other slots are left untouched.
    pub async fn start(&self, config: EngineConfig) -> Result<EngineStatus, AppError> {
        let definition = self.find_definition(&config.engine_id).await?;
        let primary_cap = definition
            .capabilities
            .first()
            .copied()
            .unwrap_or(Capability::Text);
        // Check if this exact engine AND model is already running in this slot
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

        // Hot-swap: stop existing engine in this slot (if different)
        let old = self.slots.lock().await.remove(&primary_cap);
        if let Some(old) = old {
            info!(
                from = %old.definition.id,
                to = %config.engine_id,
                slot = ?primary_cap,
                "Hot-swapping engine in slot"
            );
            self.emitter
                .emit_swapping(&old.definition.id, &config.engine_id);
            Self::kill_engine(old).await;
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
            let sdcpp_args = build_sdcpp_args(&config, selected_port).inspect_err(|error| {
                self.emitter
                    .emit_error(&config.engine_id, &error.to_string());
            })?;
            cmd.args(sdcpp_args);
        } else {
            // Default fallback for other engines
            cmd.arg("--port").arg(selected_port.to_string());
        }

        if config.engine_id != "sdcpp" {
            if let Some(ref model) = config.model_path {
                cmd.arg("--model").arg(model);
            }

            for arg in &config.extra_args {
                cmd.arg(arg);
            }
        }

        // Pipe engine stdout/stderr to files in logs directory
        let log_dir = crate::utils::paths::LOG_DIR
            .join("Engines")
            .join(&config.engine_id);
        let _ = std::fs::create_dir_all(&log_dir);

        let stdout_path = log_dir.join("stdout.log");
        let stderr_path = log_dir.join("stderr.log");

        let stdout_file = File::create(&stdout_path).ok();
        let stderr_file = File::create(&stderr_path).ok();

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
                stdout_file,
                Arc::clone(&self.emitter),
                config.engine_id.clone(),
            );
        }

        if let Some(stderr) = process.stderr.take() {
            spawn_log_reader(
                stderr,
                stderr_file,
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
                let _ = running.process.kill().await;
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

    /// Stop all running engines
    pub async fn stop(&self) -> Result<(), AppError> {
        let engines: Vec<(Capability, RunningEngine)> = self.slots.lock().await.drain().collect();
        for (cap, engine) in engines {
            info!(engine = %engine.definition.id, slot = ?cap, "Stopping engine");
            Self::kill_engine(engine).await;
        }
        Ok(())
    }

    /// Stop engine in a specific capability slot
    pub async fn stop_slot(&self, capability: Capability) -> Result<(), AppError> {
        let engine = self.slots.lock().await.remove(&capability);
        if let Some(engine) = engine {
            info!(engine = %engine.definition.id, slot = ?capability, "Stopping engine in slot");
            Self::kill_engine(engine).await;
        }
        Ok(())
    }

    /// Kill an engine process and wait for exit
    async fn kill_engine(mut engine: RunningEngine) {
        if let Err(e) = engine.process.kill().await {
            error!(engine = %engine.definition.id, error = %e, "Failed to kill engine process");
        }
        let _ = engine.process.wait().await;
        info!(engine = %engine.definition.id, "Engine stopped");
    }

    /// Find an engine definition by ID
    async fn find_definition(&self, id: &str) -> Result<EngineDefinition, AppError> {
        let definitions = self.definitions.lock().await;
        definitions
            .iter()
            .find(|d| d.id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Engine '{id}' not found in registry")))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;
    use crate::domain::engine::engine_runtime::classify_engine_start_failure;
    use crate::domain::system::ports::ENGINE_LOCAL_PORT_RANGE;
    use std::fs;
    use std::net::TcpListener;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_config(model_path: Option<&str>) -> EngineConfig {
        EngineConfig {
            engine_id: "llamacpp".to_string(),
            gpu_layers: -1,
            context_size: 4096,
            model_path: model_path.map(str::to_string),
            vae_path: None,
            llm_path: None,
            extra_args: vec![],
        }
    }

    fn sample_sdcpp_config(model_path: Option<&str>) -> EngineConfig {
        EngineConfig {
            engine_id: "sdcpp".to_string(),
            gpu_layers: -1,
            context_size: 4096,
            model_path: model_path.map(str::to_string),
            vae_path: None,
            llm_path: None,
            extra_args: vec![],
        }
    }

    #[test]
    fn builds_single_slot_llamacpp_args_by_default() {
        let args = build_llamacpp_args(&sample_config(None), 8081);
        assert!(args.windows(2).any(|w| w == ["--parallel", "1"]));
        assert!(args.windows(2).any(|w| w == ["--reasoning", "off"]));
    }

    #[test]
    fn clamps_llamacpp_context_size_to_safe_minimum() {
        let mut config = sample_config(None);
        config.context_size = 1024;

        let args = build_llamacpp_args(&config, 8081);
        assert!(args.windows(2).any(|w| w == ["--ctx-size", "4096"]));
    }

    #[test]
    fn adds_qwen_specific_llamacpp_args() {
        let args = build_llamacpp_args(&sample_config(Some("Qwen3.5-9B-Q4_K_M.gguf")), 8081);
        assert!(args.contains(&"--jinja".to_string()));
        assert!(
            args.windows(2)
                .any(|w| w == ["--reasoning-format", "deepseek"])
        );
        assert!(args.contains(&"--no-context-shift".to_string()));
        assert!(args.windows(2).any(|w| w == ["--flash-attn", "on"]));
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
                "Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model."
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
        )
        .unwrap();

        assert!(args.windows(2).any(|w| w == ["--listen-port", "8082"]));
        assert!(
            args.windows(2)
                .any(|w| w == ["--model", "C:/models/sd15.safetensors"])
        );
    }

    #[test]
    fn rejects_qwen_image_without_companion_files() {
        let error = build_sdcpp_args(
            &sample_sdcpp_config(Some("C:/models/qwen-image-Q2_K.gguf")),
            8082,
        )
        .unwrap_err();

        match error {
            AppError::Validation(message) => {
                assert!(message.contains("Qwen Image model"));
                assert!(message.contains("--vae"));
                assert!(message.contains("--llm"));
            }
            other => panic!("expected validation error, got {other:?}"),
        }
    }

    #[test]
    fn auto_detects_qwen_image_companion_files_in_model_directory() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("axelate-sdcpp-qwen-{unique}"));
        fs::create_dir_all(&temp_dir).unwrap();

        let diffusion = temp_dir.join("qwen-image-Q2_K.gguf");
        let vae = temp_dir.join("qwen_image_vae.safetensors");
        let llm = temp_dir.join("Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf");

        fs::write(&diffusion, []).unwrap();
        fs::write(&vae, []).unwrap();
        fs::write(&llm, []).unwrap();

        let args = build_sdcpp_args(
            &sample_sdcpp_config(Some(diffusion.to_string_lossy().as_ref())),
            8082,
        )
        .unwrap();

        assert!(
            args.windows(2)
                .any(|w| w == ["--diffusion-model", diffusion.to_string_lossy().as_ref()])
        );
        assert!(
            args.windows(2)
                .any(|w| w == ["--vae", vae.to_string_lossy().as_ref()])
        );
        assert!(
            args.windows(2)
                .any(|w| w == ["--llm", llm.to_string_lossy().as_ref()])
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
