//! Engine configuration helpers.
//!
//! Centralizes default engine config construction and normalization rules so
//! API and domain services do not duplicate launcher policy.

use crate::domain::engine::types::{EngineConfig, EngineDefinition};

const MIN_LLAMACPP_CONTEXT_SIZE: u32 = 4096;

/// Builds a runtime engine config from engine definition defaults.
#[must_use]
pub fn build_default_engine_config(def: &EngineDefinition) -> EngineConfig {
    normalize_engine_config(EngineConfig {
        engine_id: def.id.clone(),
        port: def.default_port,
        gpu_layers: def.default_gpu_layers,
        context_size: def.default_context_size,
        model_path: None,
        extra_args: vec![],
    })
}

/// Normalizes launcher-managed engine settings.
#[must_use]
pub fn normalize_engine_config(mut config: EngineConfig) -> EngineConfig {
    if config.engine_id == "llamacpp" && config.context_size < MIN_LLAMACPP_CONTEXT_SIZE {
        config.context_size = MIN_LLAMACPP_CONTEXT_SIZE;
    }

    config
}
