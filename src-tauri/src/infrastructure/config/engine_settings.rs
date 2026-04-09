//! Persisted engine settings storage.
//!
//! Handles reading and writing `engine_config.json` outside of the API layer.

use std::collections::HashMap;

use crate::domain::engine::config::normalize_engine_config;
use crate::domain::engine::types::EngineConfig;
use crate::errors::AppError;
use crate::utils::paths::FILE_ENGINE_CONFIG;

/// Persisted engine config map indexed by engine id.
pub type EngineConfigMap = HashMap<String, EngineConfig>;

/// Loads persisted engine configuration map.
pub async fn load_engine_config_map() -> Result<EngineConfigMap, AppError> {
    let path = &*FILE_ENGINE_CONFIG;
    if !path.exists() {
        return Ok(EngineConfigMap::default());
    }

    let raw = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    let mut map: EngineConfigMap =
        serde_json::from_str(&raw).map_err(|e| AppError::Serialization(e.to_string()))?;

    for config in map.values_mut() {
        let normalized = normalize_engine_config(config.clone());
        *config = normalized;
    }

    Ok(map)
}

/// Saves persisted engine configuration map atomically.
pub async fn save_engine_config_map(map: &EngineConfigMap) -> Result<(), AppError> {
    let path = &*FILE_ENGINE_CONFIG;
    let tmp = path.with_extension("tmp");

    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    let json =
        serde_json::to_string_pretty(map).map_err(|e| AppError::Serialization(e.to_string()))?;
    tokio::fs::write(&tmp, &json)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;

    if let Err(e) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(path).await;
        tokio::fs::rename(&tmp, path)
            .await
            .map_err(|_| AppError::Io(e.to_string()))?;
    }

    Ok(())
}
