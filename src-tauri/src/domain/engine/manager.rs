//! Engine lifecycle manager
//!
//! Owns active local engine processes. Handles start, stop,
//! health checks, and hot-swap (unload one engine before loading another).
//!
//! Supports **multiple capability slots** — e.g. a text engine and an
//! image engine can run simultaneously, each occupying its own slot.
//! Within a slot, only one engine is loaded at a time (hot-swap).

use std::collections::HashMap;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use std::fs::File;
use tokio::io::AsyncRead;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::errors::AppError;

use super::events::EngineEventEmitter;
use super::types::{
    Capability, EngineConfig, EngineDefinition, EngineState, EngineStatus, SlotStatus,
};

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

fn is_progress_log_line(line: &str) -> bool {
    line.contains("it/s") || line.contains("s/it") || line.contains('%')
}

fn is_qwen_model(model_path: Option<&str>) -> bool {
    model_path.is_some_and(|path| path.to_ascii_lowercase().contains("qwen"))
}

fn is_qwen_image_model(model_path: Option<&str>) -> bool {
    model_path.is_some_and(|path| {
        let normalized = path.replace('\\', "/").to_ascii_lowercase();
        normalized.contains("qwen-image") || normalized.contains("qwen_image")
    })
}

fn has_arg(args: &[String], candidates: &[&str]) -> bool {
    args.iter().any(|arg| {
        candidates.iter().any(|candidate| {
            arg == candidate
                || arg
                    .strip_prefix(candidate)
                    .is_some_and(|suffix| suffix.starts_with('='))
        })
    })
}

fn push_arg_if_missing(
    args: &mut Vec<String>,
    existing_args: &[String],
    candidates: &[&str],
    value: Option<&str>,
) {
    if has_arg(args, candidates) || has_arg(existing_args, candidates) {
        return;
    }

    let Some(candidate) = candidates.first() else {
        return;
    };

    args.push((*candidate).to_string());
    if let Some(value) = value {
        args.push(value.to_string());
    }
}

fn extract_arg_value(args: &[String], candidates: &[&str]) -> Option<String> {
    for (index, arg) in args.iter().enumerate() {
        for candidate in candidates {
            if arg == candidate {
                if let Some(value) = args.get(index + 1) {
                    return Some(value.clone());
                }
            }

            let prefix = format!("{candidate}=");
            if let Some(value) = arg.strip_prefix(&prefix) {
                return Some(value.to_string());
            }
        }
    }

    None
}

/// Resolves the explicit sdcpp preview file path from user extra arguments.
pub fn resolve_sdcpp_preview_path(extra_args: &[String]) -> Option<PathBuf> {
    extract_arg_value(extra_args, &["--preview-path"]).map(PathBuf::from)
}

fn sdcpp_preview_enabled(extra_args: &[String]) -> bool {
    extract_arg_value(extra_args, &["--preview"])
        .is_none_or(|value| !value.trim().eq_ignore_ascii_case("none"))
}

fn find_companion_model_file(
    model_path: &Path,
    stems: &[&str],
    extensions: &[&str],
) -> Option<String> {
    let model_dir = model_path.parent()?;
    let mut entries = std::fs::read_dir(model_dir)
        .ok()?
        .flatten()
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();

        if extensions.iter().all(|candidate| extension != *candidate) {
            continue;
        }

        if stems.iter().any(|stem| file_name.contains(stem)) {
            return Some(path.to_string_lossy().to_string());
        }
    }

    None
}

fn resolve_qwen_image_support_file(
    model_path: &Path,
    extra_args: &[String],
    arg_names: &[&str],
    stems: &[&str],
    extensions: &[&str],
) -> Option<String> {
    extract_arg_value(extra_args, arg_names)
        .or_else(|| find_companion_model_file(model_path, stems, extensions))
}

fn qwen_image_requirements_error(model_path: &str) -> AppError {
    AppError::Validation(format!(
        "Qwen Image model '{model_path}' needs companion files for stable-diffusion.cpp. Add '--vae <qwen_image_vae.safetensors>' and '--llm <Qwen2.5-VL-7B-Instruct*.gguf>' in Extra Arguments, or place those files next to the model."
    ))
}

fn build_sdcpp_args(config: &EngineConfig, port: u16) -> Result<Vec<String>, AppError> {
    let mut args = vec!["--listen-port".to_string(), port.to_string()];

    if let Some(model_path) = config.model_path.as_deref() {
        if is_qwen_image_model(Some(model_path)) {
            let model_path_buf = Path::new(model_path);
            let vae_path = resolve_qwen_image_support_file(
                model_path_buf,
                &config.extra_args,
                &["--vae"],
                &["qwen_image_vae", "qwen-image-vae"],
                &["safetensors"],
            );
            let llm_path = resolve_qwen_image_support_file(
                model_path_buf,
                &config.extra_args,
                &["--llm"],
                &["qwen2.5-vl", "qwen2_5_vl", "qwen25-vl", "qwen25_vl"],
                &["gguf"],
            );

            if vae_path.is_none() || llm_path.is_none() {
                return Err(qwen_image_requirements_error(model_path));
            }

            args.push("--diffusion-model".to_string());
            args.push(model_path.to_string());
            push_arg_if_missing(
                &mut args,
                &config.extra_args,
                &["--vae"],
                vae_path.as_deref(),
            );
            push_arg_if_missing(
                &mut args,
                &config.extra_args,
                &["--llm"],
                llm_path.as_deref(),
            );
        } else {
            args.push("--model".to_string());
            args.push(model_path.to_string());
        }
    }

    args.extend(config.extra_args.clone());
    Ok(args)
}

fn build_llamacpp_args(config: &EngineConfig, port: u16) -> Vec<String> {
    let effective_context_size = config.context_size.max(4096);
    let mut args = vec![
        "--port".to_string(),
        port.to_string(),
        "--ctx-size".to_string(),
        effective_context_size.to_string(),
        "-ngl".to_string(),
        config.gpu_layers.to_string(),
    ];

    // Desktop launcher is single-user. Force a single slot unless user explicitly overrides it.
    push_arg_if_missing(
        &mut args,
        &config.extra_args,
        &["--parallel", "-np"],
        Some("1"),
    );
    push_arg_if_missing(
        &mut args,
        &config.extra_args,
        &["--reasoning", "-rea"],
        Some("off"),
    );

    if is_qwen_model(config.model_path.as_deref()) {
        push_arg_if_missing(&mut args, &config.extra_args, &["--jinja"], None);
        push_arg_if_missing(
            &mut args,
            &config.extra_args,
            &["--reasoning-format"],
            Some("deepseek"),
        );
        push_arg_if_missing(&mut args, &config.extra_args, &["--no-context-shift"], None);
        push_arg_if_missing(&mut args, &config.extra_args, &["--flash-attn"], Some("on"));
    }

    args
}

fn find_available_local_port(preferred_port: u16) -> Result<u16, AppError> {
    const MAX_PORT_PROBES: u16 = 32;

    for offset in 0..MAX_PORT_PROBES {
        let candidate = preferred_port.saturating_add(offset);
        if TcpListener::bind(("127.0.0.1", candidate)).is_ok() {
            return Ok(candidate);
        }
    }

    Err(AppError::Config(format!(
        "No free localhost port found starting from {preferred_port}"
    )))
}

fn classify_engine_start_failure(log: &str) -> Option<String> {
    let normalized = log.to_ascii_lowercase();

    if normalized.contains("out of memory")
        || normalized.contains("cudamalloc failed")
        || normalized.contains("failed to allocate compute")
    {
        return Some(
            "Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model."
                .to_string(),
        );
    }

    if normalized.contains("paging file is too small")
        || normalized.contains("cannot allocate memory")
        || normalized.contains("bad_alloc")
    {
        return Some(
            "Not enough system memory to start the local model. Close other apps or use a smaller model."
                .to_string(),
        );
    }

    None
}

fn write_engine_log_line(file: &mut File, line: &str) {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S");
    let _ = writeln!(file, "{timestamp} [INFO] {}", line.trim());
}

async fn diagnose_engine_start_failure(stderr_path: &std::path::Path) -> Option<String> {
    let raw = tokio::fs::read_to_string(stderr_path).await.ok()?;
    classify_engine_start_failure(&raw)
}

fn spawn_log_reader<R>(
    mut stream: R,
    mut file: Option<File>,
    emitter: Arc<dyn EngineEventEmitter>,
    engine_id: String,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;

        let mut buf = [0u8; 1024];
        let mut current_line = String::new();

        while let Ok(n) = stream.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let Some(bytes) = buf.get(..n) else {
                break;
            };
            let chunk = String::from_utf8_lossy(bytes);
            for c in chunk.chars() {
                if c == '\n' || c == '\r' {
                    if !current_line.is_empty() {
                        if let Some(ref mut f) = file {
                            write_engine_log_line(f, &current_line);
                        }
                        let trimmed = current_line.trim();
                        if is_progress_log_line(trimmed) {
                            emitter.emit_log(&engine_id, trimmed);
                        }
                        current_line.clear();
                    }
                } else {
                    current_line.push(c);
                }
            }
        }

        if !current_line.is_empty() {
            let trimmed = current_line.trim();
            if is_progress_log_line(trimmed) {
                emitter.emit_log(&engine_id, trimmed);
            }
        }
    });
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

        let selected_port = find_available_local_port(definition.default_port)?;
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
            let sdcpp_args = build_sdcpp_args(&config, selected_port).map_err(|error| {
                self.emitter
                    .emit_error(&config.engine_id, &error.to_string());
                error
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
        match Self::wait_for_health(&endpoint).await {
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

    /// Wait for engine to become healthy (poll /health or /v1/models endpoints)
    async fn wait_for_health(endpoint: &str) -> Result<(), AppError> {
        let client = reqwest::Client::new();
        // Try multiple standard endpoints—some engines use /health, others /v1/models, or just /
        let health_endpoints = [
            format!("{endpoint}/health"),
            format!("{endpoint}/v1/models"),
            format!("{endpoint}/"),
        ];

        let max_attempts = 120; // 60 seconds (120 * 500ms) - loading 13GB models takes time
        let interval = Duration::from_millis(500);

        for attempt in 1..=max_attempts {
            for health_url in &health_endpoints {
                match client.get(health_url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        info!(attempt, url = %health_url, "Engine health check passed");
                        return Ok(());
                    }
                    Ok(resp) => {
                        // Some servers might return 401/403 if they don't have these endpoints,
                        // which is fine, we just keep trying others.
                        if attempt % 20 == 0 {
                            warn!(attempt, url = %health_url, status = %resp.status(), "Health check polling...");
                        }
                    }
                    Err(_) => {
                        // Port not open yet or connection refused
                    }
                }
            }
            tokio::time::sleep(interval).await;
        }

        Err(AppError::External {
            request_id: None,
            message: format!(
                "Engine health check timed out after {max_attempts} attempts (60s). Check engine logs for details."
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_config(model_path: Option<&str>) -> EngineConfig {
        EngineConfig {
            engine_id: "llamacpp".to_string(),
            gpu_layers: -1,
            context_size: 4096,
            model_path: model_path.map(str::to_string),
            extra_args: vec![],
        }
    }

    fn sample_sdcpp_config(model_path: Option<&str>) -> EngineConfig {
        EngineConfig {
            engine_id: "sdcpp".to_string(),
            gpu_layers: -1,
            context_size: 4096,
            model_path: model_path.map(str::to_string),
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
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let selected = find_available_local_port(port).unwrap();

        assert_eq!(selected, port);
    }

    #[test]
    fn skips_busy_port_and_uses_next_free_one() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let busy_port = listener.local_addr().unwrap().port();

        let selected = find_available_local_port(busy_port).unwrap();

        assert_ne!(selected, busy_port);
        assert!(selected > busy_port);
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
