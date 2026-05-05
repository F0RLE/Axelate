//! Engine management Tauri commands
//!
//! Thin adapter layer between frontend and EngineManager.

use std::sync::Arc;

use crate::domain::engine::config::{
    build_default_engine_config, merge_user_engine_config, normalize_engine_config,
};
use crate::domain::engine::manager::EngineManager;
use crate::domain::engine::manager::canonical_engine_id;
use crate::domain::engine::types::{
    Capability, EngineConfig, EngineDefinition, EngineState, EngineStatus,
};
use crate::errors::AppError;
use crate::infrastructure::config::engine_settings::{
    EngineConfigMap, load_engine_config_map, save_engine_config_map,
};
use tauri::State;

/// Aggregated payload for the local engine settings modal.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct EngineSettingsPayload {
    /// Fully merged engine config for the selected engine.
    pub config: EngineConfig,
}

fn engine_config_for_definition(def: &EngineDefinition, saved: &EngineConfigMap) -> EngineConfig {
    saved.get(&def.id).map_or_else(
        || build_default_engine_config(def),
        |config| merge_user_engine_config(def, config),
    )
}

fn engine_settings_payload_for_definition(
    def: &EngineDefinition,
    saved: &EngineConfigMap,
) -> EngineSettingsPayload {
    EngineSettingsPayload {
        config: engine_config_for_definition(def, saved),
    }
}

fn normalize_config_for_save(def: &EngineDefinition, mut config: EngineConfig) -> EngineConfig {
    config.engine_id = canonical_engine_id(&config.engine_id);
    merge_user_engine_config(def, &normalize_engine_config(config))
}

fn mark_engine_definitions_installed(
    defs: &mut [EngineDefinition],
    mut is_installed: impl FnMut(&EngineDefinition) -> bool,
) {
    for def in defs {
        def.installed = def.managed_externally || is_installed(def);
    }
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
/// Deletes an Axelate-managed engine from local storage.
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned params
pub async fn delete_engine(
    engine_id: String,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<(), AppError> {
    let engine_id = canonical_engine_id(&engine_id);
    if engine_manager.is_engine_running(&engine_id).await {
        return Err(AppError::Validation(format!(
            "Cannot delete engine '{engine_id}' while it is running"
        )));
    }

    crate::domain::engine::detector::delete_installed_engine(&engine_id).await
}

#[tauri::command]
#[specta::specta]
/// Returns all registered engine definitions with real-time installation status.
pub async fn get_engine_definitions(
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<Vec<EngineDefinition>, AppError> {
    let mut defs = engine_manager.list_definitions().await;
    // Populate `installed` at request time — no extra round-trip needed from frontend
    mark_engine_definitions_installed(&mut defs, |def| {
        crate::domain::engine::detector::is_engine_installed(&def.id, def.binary.as_deref())
    });
    Ok(defs)
}

#[tauri::command]
#[specta::specta]
/// Returns the persisted user config for an engine, or defaults if none saved yet.
pub async fn get_engine_config(
    engine_id: String,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<crate::domain::engine::types::EngineConfig, AppError> {
    let engine_id = canonical_engine_id(&engine_id);
    let def = engine_manager
        .get_definition(&engine_id)
        .await
        .ok_or_else(|| AppError::Config(format!("Unknown engine: {engine_id}")))?;

    let saved = load_engine_config_map().await?;
    Ok(engine_config_for_definition(&def, &saved))
}

#[tauri::command]
#[specta::specta]
/// Returns the local engine modal payload in a single backend round-trip.
pub async fn get_engine_settings_payload(
    engine_id: String,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<EngineSettingsPayload, AppError> {
    let engine_id = canonical_engine_id(&engine_id);
    let def = engine_manager
        .get_definition(&engine_id)
        .await
        .ok_or_else(|| AppError::Config(format!("Unknown engine: {engine_id}")))?;

    let saved = load_engine_config_map().await?;
    Ok(engine_settings_payload_for_definition(&def, &saved))
}

#[tauri::command]
#[specta::specta]
/// Persists user engine config (compute mode, context_size, model_path, extra_args).
pub async fn set_engine_config(
    config: crate::domain::engine::types::EngineConfig,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<(), AppError> {
    let mut config = config;
    config.engine_id = canonical_engine_id(&config.engine_id);
    let def = engine_manager
        .get_definition(&config.engine_id)
        .await
        .ok_or_else(|| AppError::Config(format!("Unknown engine: {}", config.engine_id)))?;

    let mut map = load_engine_config_map().await?;
    let normalized = normalize_config_for_save(&def, config);
    map.insert(normalized.engine_id.clone(), normalized);
    save_engine_config_map(&map).await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::domain::engine::types::EngineComputeMode;

    fn sample_definition(id: &str) -> EngineDefinition {
        EngineDefinition {
            id: id.to_string(),
            name: format!("{id} engine"),
            desc: String::new(),
            icon: String::new(),
            capabilities: vec![Capability::Text],
            binary: Some(format!("{id}-server")),
            repo_url: None,
            version: "1.0.0".to_string(),
            default_port: 8081,
            default_context_size: 8192,
            config_schema: None,
            installed: false,
            managed_externally: false,
        }
    }

    fn saved_config(engine_id: &str) -> EngineConfig {
        EngineConfig {
            engine_id: engine_id.to_string(),
            compute_mode: EngineComputeMode::Cpu,
            context_size: 2048,
            model_path: Some("C:/models/model.gguf".to_string()),
            extra_args: vec!["--threads".to_string(), "8".to_string()],
        }
    }

    #[test]
    fn engine_config_for_definition_uses_defaults_when_no_saved_config_exists() {
        let def = sample_definition("sdcpp");
        let config = engine_config_for_definition(&def, &EngineConfigMap::default());

        assert_eq!(config.engine_id, "sdcpp");
        assert_eq!(config.compute_mode, EngineComputeMode::Gpu);
        assert_eq!(config.context_size, 8192);
        assert_eq!(config.model_path, None);
        assert!(config.extra_args.is_empty());
    }

    #[test]
    fn engine_config_for_definition_merges_saved_config_and_normalizes_llamacpp() {
        let def = sample_definition("llamacpp");
        let mut saved = EngineConfigMap::default();
        saved.insert(def.id.clone(), saved_config("llamacpp"));

        let config = engine_config_for_definition(&def, &saved);

        assert_eq!(config.compute_mode, EngineComputeMode::Cpu);
        assert_eq!(config.context_size, 4096);
        assert_eq!(config.model_path.as_deref(), Some("C:/models/model.gguf"));
        assert_eq!(config.extra_args, vec!["--threads", "8"]);
    }

    #[test]
    fn engine_settings_payload_wraps_the_resolved_config() {
        let def = sample_definition("sdcpp");
        let mut saved = EngineConfigMap::default();
        saved.insert(def.id.clone(), saved_config("sdcpp"));

        let payload = engine_settings_payload_for_definition(&def, &saved);

        assert_eq!(payload.config.engine_id, "sdcpp");
        assert_eq!(payload.config.compute_mode, EngineComputeMode::Cpu);
    }

    #[test]
    fn normalize_config_for_save_canonicalizes_aliases_before_persisting() {
        let def = sample_definition("sdcpp");
        let normalized = normalize_config_for_save(&def, saved_config("stable-diffusion"));

        assert_eq!(normalized.engine_id, "sdcpp");
        assert_eq!(normalized.compute_mode, EngineComputeMode::Cpu);
        assert_eq!(normalized.context_size, 2048);
    }

    #[test]
    fn mark_engine_definitions_installed_keeps_external_engines_available() {
        let external = EngineDefinition {
            managed_externally: true,
            binary: None,
            ..sample_definition("external")
        };
        let mut defs = vec![sample_definition("missing"), external];

        mark_engine_definitions_installed(&mut defs, |def| def.id == "missing");

        assert!(defs.iter().all(|def| def.installed));
    }

    #[test]
    fn mark_engine_definitions_installed_marks_missing_local_engines_uninstalled() {
        let mut defs = vec![sample_definition("missing")];

        mark_engine_definitions_installed(&mut defs, |_| false);

        assert!(defs.iter().all(|def| !def.installed));
    }

    #[test]
    fn engine_settings_payload_serializes_as_expected() {
        let payload = EngineSettingsPayload {
            config: EngineConfig {
                engine_id: "cloud".to_string(),
                compute_mode: EngineComputeMode::Gpu,
                context_size: 4096,
                model_path: None,
                extra_args: vec![],
            },
        };
        let json = serde_json::to_value(&payload).unwrap();

        assert_eq!(
            json.get("config")
                .and_then(|config| config.get("engine_id"))
                .and_then(serde_json::Value::as_str),
            Some("cloud")
        );
    }
}
