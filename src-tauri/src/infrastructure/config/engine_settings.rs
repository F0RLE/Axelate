//! Persisted engine settings storage.
//!
//! Handles reading and writing `engine_config.json` outside of the API layer.

use std::collections::HashMap;
use std::io::ErrorKind;

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
    let tmp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));

    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    let json =
        serde_json::to_string_pretty(map).map_err(|e| AppError::Serialization(e.to_string()))?;
    {
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, json.as_bytes())
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        file.sync_all()
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    if let Err(rename_error) = tokio::fs::rename(&tmp, path).await {
        cleanup_engine_config_tmp(&tmp).await;
        return Err(AppError::Io(format!(
            "Failed to atomically publish engine config '{}': {rename_error}",
            path.display()
        )));
    }

    Ok(())
}

async fn cleanup_engine_config_tmp(tmp: &std::path::Path) {
    if let Err(error) = tokio::fs::remove_file(tmp).await {
        if error.kind() != ErrorKind::NotFound {
            tracing::warn!(
                "Failed to remove temporary engine config {}: {error}",
                tmp.display()
            );
        }
    }
}
