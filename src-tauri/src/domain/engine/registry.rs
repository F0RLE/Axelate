//! Engine registry — loads engine definitions from config
//!
//! Converts `ModuleItem` entries (from `local_modules.json`) with `type == "local"`
//! into `EngineDefinition` instances that `EngineManager` can use.

use crate::models::config::ModuleItem;

use super::types::{Capability, EngineDefinition};

/// Extracts engine definitions from the full module list.
///
/// Filters for `type == "local"` modules and converts each to an `EngineDefinition`.
pub fn load_engine_definitions(modules: &[ModuleItem]) -> Vec<EngineDefinition> {
    let defs: Vec<EngineDefinition> = modules
        .iter()
        .filter(|m| m.type_name == "local")
        .map(convert_module_to_definition)
        .collect();

    tracing::debug!(
        count = defs.len(),
        "Loaded engine definitions from local_modules"
    );

    for def in &defs {
        tracing::debug!(
            id = %def.id,
            name = %def.name,
            capabilities = ?def.capabilities,
            binary = ?def.binary,
            repo = ?def.repo_url,
            "Registered engine"
        );
    }

    defs
}

/// Converts a single `ModuleItem` to an `EngineDefinition`.
fn convert_module_to_definition(item: &ModuleItem) -> EngineDefinition {
    let capabilities: Vec<Capability> = item
        .capabilities
        .iter()
        .filter_map(|c| match c.as_str() {
            "text" => Some(Capability::Text),
            "image" => Some(Capability::Image),
            "vision" => Some(Capability::Vision),
            _ => None,
        })
        .collect();

    // Extract numeric defaults from configSchema if present
    let schema = item.raw_config_schema.as_ref();
    let default_port = extract_u16(schema, "port").unwrap_or(8081);
    let default_context_size = extract_u32(schema, "contextSize").unwrap_or(4096);

    EngineDefinition {
        id: item.id.clone(),
        name: item.name.clone(),
        desc: item.desc.clone(),
        icon: item.icon.clone(),
        capabilities,
        binary: item.binary.clone(),
        repo_url: item.repo_url.clone(),
        version: item.version.clone(),
        default_port,
        default_context_size,
        config_schema: item.raw_config_schema.clone(),
        installed: false, // populated at request time by get_engine_definitions
        installed_compute_modes: Vec::new(),
        managed_externally: item.managed_externally,
    }
}

/// Extracts a u16 default from a JSON configSchema field: `{ "fieldName": { "default": 8081 } }`
fn extract_u16(schema: Option<&serde_json::Value>, field: &str) -> Option<u16> {
    schema?
        .get(field)?
        .get("default")?
        .as_u64()
        .and_then(|v| u16::try_from(v).ok())
}

/// Extracts a u32 default from a JSON configSchema field.
fn extract_u32(schema: Option<&serde_json::Value>, field: &str) -> Option<u32> {
    schema?
        .get(field)?
        .get("default")?
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
}
