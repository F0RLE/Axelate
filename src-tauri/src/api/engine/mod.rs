//! Engine management Tauri commands
//!
//! Thin adapter layer between frontend and EngineManager.

use std::sync::Arc;

use crate::domain::engine::config::{
    build_default_engine_config, merge_user_engine_config, normalize_engine_config,
};
use crate::domain::engine::manager::EngineManager;
use crate::domain::engine::types::{
    Capability, EngineConfig, EngineDefinition, EngineState, EngineStatus,
};
use crate::errors::AppError;
use crate::infrastructure::config::engine_settings::{
    load_engine_config_map, save_engine_config_map,
};
use tauri::State;

/// Aggregated payload for the local engine settings modal.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct EngineSettingsPayload {
    /// Fully merged engine config for the selected engine.
    pub config: EngineConfig,
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
/// Checks if an engine binary is present (in ENGINES_DIR or system PATH).
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
        def.installed = if def.managed_externally {
            true
        } else {
            crate::domain::engine::detector::is_engine_installed(&def.id, def.binary.as_deref())
        };
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
    let def = engine_manager
        .get_definition(&engine_id)
        .await
        .ok_or_else(|| AppError::Config(format!("Unknown engine: {engine_id}")))?;

    let saved = load_engine_config_map().await?;
    if let Some(config) = saved.get(&engine_id) {
        return Ok(merge_user_engine_config(&def, config));
    }

    Ok(build_default_engine_config(&def))
}

#[tauri::command]
#[specta::specta]
/// Returns the local engine modal payload in a single backend round-trip.
pub async fn get_engine_settings_payload(
    engine_id: String,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<EngineSettingsPayload, AppError> {
    let def = engine_manager
        .get_definition(&engine_id)
        .await
        .ok_or_else(|| AppError::Config(format!("Unknown engine: {engine_id}")))?;

    let saved = load_engine_config_map().await?;
    let config = if let Some(config) = saved.get(&engine_id) {
        merge_user_engine_config(&def, config)
    } else {
        build_default_engine_config(&def)
    };

    Ok(EngineSettingsPayload { config })
}

#[tauri::command]
#[specta::specta]
/// Persists user engine config (compute mode, context_size, model_path, extra_args).
pub async fn set_engine_config(
    config: crate::domain::engine::types::EngineConfig,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<(), AppError> {
    let def = engine_manager
        .get_definition(&config.engine_id)
        .await
        .ok_or_else(|| AppError::Config(format!("Unknown engine: {}", config.engine_id)))?;

    let mut map = load_engine_config_map().await.unwrap_or_default();
    let normalized = merge_user_engine_config(&def, &normalize_engine_config(config));
    map.insert(normalized.engine_id.clone(), normalized);
    save_engine_config_map(&map).await
}
