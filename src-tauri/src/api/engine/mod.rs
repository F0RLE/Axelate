//! Engine management Tauri commands
//!
//! Thin adapter layer between frontend and EngineManager.

use std::sync::Arc;

use crate::domain::engine::manager::EngineManager;
use crate::domain::engine::types::{
    Capability, EngineConfig, EngineDefinition, EngineState, EngineStatus,
};
use crate::errors::AppError;
use tauri::State;

const MIN_LLAMACPP_CONTEXT_SIZE: u32 = 4096;

fn normalize_engine_config(
    mut config: crate::domain::engine::types::EngineConfig,
) -> crate::domain::engine::types::EngineConfig {
    if config.engine_id == "llamacpp" && config.context_size < MIN_LLAMACPP_CONTEXT_SIZE {
        config.context_size = MIN_LLAMACPP_CONTEXT_SIZE;
    }

    config
}

#[tauri::command]
#[specta::specta]
/// Starts a local engine. Hot-swaps if another engine is active.
pub async fn start_engine(
    config: EngineConfig,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<EngineStatus, AppError> {
    engine_manager.start(normalize_engine_config(config)).await
}

#[tauri::command]
#[specta::specta]
/// Stops all running engines.
pub async fn stop_engine(engine_manager: State<'_, Arc<EngineManager>>) -> Result<(), AppError> {
    engine_manager.stop().await
}

#[tauri::command]
#[specta::specta]
/// Stops the engine in a specific capability slot (text, image, vision).
pub async fn stop_engine_slot(
    capability: Capability,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<(), AppError> {
    engine_manager.stop_slot(capability).await
}

#[tauri::command]
#[specta::specta]
/// Gets the current engine state (idle, starting, ready, error).
pub async fn get_engine_state(
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<EngineState, AppError> {
    Ok(engine_manager.state().await)
}

#[tauri::command]
#[specta::specta]
/// Checks if an engine binary is present (in MODULES_DIR or system PATH).
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned params
pub fn check_engine_installed(engine_id: String, binary_name: Option<String>) -> bool {
    crate::domain::engine::detector::is_engine_installed(&engine_id, binary_name.as_deref())
}

#[tauri::command]
#[specta::specta]
/// Returns all registered engine definitions with real-time installation status.
pub async fn get_engine_definitions(
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<Vec<EngineDefinition>, AppError> {
    let mut defs = engine_manager.list_definitions().await;
    // Populate `installed` at request time — no extra round-trip needed from frontend
    for def in &mut defs {
        def.installed =
            crate::domain::engine::detector::is_engine_installed(&def.id, def.binary.as_deref());
    }
    Ok(defs)
}

#[tauri::command]
#[specta::specta]
/// Returns the persisted user config for an engine, or defaults if none saved yet.
pub async fn get_engine_config(
    engine_id: String,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<crate::domain::engine::types::EngineConfig, AppError> {
    let saved = load_engine_config_map()?;
    if let Some(config) = saved.get(&engine_id) {
        return Ok(config.clone());
    }

    // Fall back to EngineDefinition defaults
    let def = engine_manager
        .get_definition(&engine_id)
        .await
        .ok_or_else(|| AppError::Config(format!("Unknown engine: {engine_id}")))?;

    Ok(normalize_engine_config(crate::domain::engine::types::EngineConfig {
        engine_id: def.id,
        port: def.default_port,
        gpu_layers: def.default_gpu_layers,
        context_size: def.default_context_size,
        model_path: None,
        extra_args: vec![],
    }))
}

#[tauri::command]
#[specta::specta]
/// Persists user engine config (port, gpu_layers, context_size, model_path, extra_args).
pub fn set_engine_config(
    config: crate::domain::engine::types::EngineConfig,
) -> Result<(), AppError> {
    let mut map = load_engine_config_map().unwrap_or_default();
    let normalized = normalize_engine_config(config);
    map.insert(normalized.engine_id.clone(), normalized);
    save_engine_config_map(&map)
}

// ──────────────────────────────────────────────────────
// Internal helpers — read/write engine_config.json atomically
// ──────────────────────────────────────────────────────

type EngineConfigMap =
    std::collections::HashMap<String, crate::domain::engine::types::EngineConfig>;

pub(crate) fn load_engine_config_map() -> Result<EngineConfigMap, AppError> {
    let path = &*crate::utils::paths::FILE_ENGINE_CONFIG;
    if !path.exists() {
        return Ok(EngineConfigMap::default());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| AppError::Io(e.to_string()))?;
    let mut map: EngineConfigMap =
        serde_json::from_str(&raw).map_err(|e| AppError::Serialization(e.to_string()))?;

    for config in map.values_mut() {
        if config.engine_id == "llamacpp" && config.context_size < MIN_LLAMACPP_CONTEXT_SIZE {
            config.context_size = MIN_LLAMACPP_CONTEXT_SIZE;
        }
    }

    Ok(map)
}

fn save_engine_config_map(map: &EngineConfigMap) -> Result<(), AppError> {
    let path = &*crate::utils::paths::FILE_ENGINE_CONFIG;
    let tmp = path.with_extension("tmp");

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }

    let json =
        serde_json::to_string_pretty(map).map_err(|e| AppError::Serialization(e.to_string()))?;
    std::fs::write(&tmp, &json).map_err(|e| AppError::Io(e.to_string()))?;

    // Atomic rename (Windows fallback: remove + rename)
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(path);
        std::fs::rename(&tmp, path).map_err(|_| AppError::Io(e.to_string()))?;
    }

    Ok(())
}
