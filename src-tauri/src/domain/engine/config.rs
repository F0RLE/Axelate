//! Engine configuration helpers.
//!
//! Centralizes default engine config construction and normalization rules so
//! API and domain services do not duplicate launcher policy.

use crate::domain::engine::types::{EngineComputeMode, EngineConfig, EngineDefinition};

const MIN_LLAMACPP_CONTEXT_SIZE: u32 = 4096;

/// Builds a runtime engine config from engine definition defaults.
#[must_use]
pub fn build_default_engine_config(def: &EngineDefinition) -> EngineConfig {
    normalize_engine_config(EngineConfig {
        engine_id: def.id.clone(),
        compute_mode: EngineComputeMode::Gpu,
        context_size: def.default_context_size,
        model_path: None,
        extra_args: vec![],
    })
}

/// Merges persisted user-controlled settings onto launcher defaults.
///
/// User-configurable engine settings no longer include `port`; runtime port
/// selection is internal to the backend and always starts from the engine
/// definition default.
#[must_use]
pub fn merge_user_engine_config(def: &EngineDefinition, saved: &EngineConfig) -> EngineConfig {
    let _ = def;
    normalize_engine_config(EngineConfig {
        engine_id: saved.engine_id.clone(),
        compute_mode: saved.compute_mode,
        context_size: saved.context_size,
        model_path: saved.model_path.clone(),
        extra_args: saved.extra_args.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_definition() -> EngineDefinition {
        EngineDefinition {
            id: "llamacpp".to_string(),
            name: "llama.cpp".to_string(),
            desc: String::new(),
            icon: String::new(),
            capabilities: vec![],
            binary: Some("llama-server".to_string()),
            repo_url: None,
            version: "1.0.0".to_string(),
            default_port: 8081,
            default_context_size: 4096,
            config_schema: None,
            installed: false,
            managed_externally: false,
        }
    }

    #[test]
    fn merge_user_engine_config_keeps_sdcpp_runtime_settings() {
        let def = sample_definition();
        let saved = EngineConfig {
            engine_id: "sdcpp".to_string(),
            compute_mode: EngineComputeMode::Cpu,
            context_size: 8192,
            model_path: Some("C:/models/test.gguf".to_string()),
            extra_args: vec!["--flash-attn".to_string()],
        };

        let merged = merge_user_engine_config(&def, &saved);

        assert_eq!(merged.compute_mode, EngineComputeMode::Cpu);
        assert_eq!(merged.context_size, 8192);
        assert_eq!(merged.model_path.as_deref(), Some("C:/models/test.gguf"));
        assert_eq!(merged.extra_args, vec!["--flash-attn"]);
    }
}
