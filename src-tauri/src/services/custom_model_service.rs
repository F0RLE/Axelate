use crate::models::custom_models::{CustomModel, CustomModelConfig};
use crate::utils::paths::CONFIG_DIR;
use tauri::command;

fn get_config_path() -> std::path::PathBuf {
    CONFIG_DIR.join("custom_models.json")
}

fn load_config() -> CustomModelConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<CustomModelConfig>(&content) {
                return config;
            }
        }
    }
    CustomModelConfig::default()
}

fn save_config(config: &CustomModelConfig) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(CONFIG_DIR.as_path()).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn get_custom_models() -> Vec<CustomModel> {
    load_config().models
}

#[command]
pub fn add_custom_model(
    provider_id: String,
    id: String,
    name: String,
    base_model_id: String,
) -> Result<(), String> {
    let mut config = load_config();

    // Check duplicates
    if config
        .models
        .iter()
        .any(|m| m.id == id && m.provider_id == provider_id)
    {
        return Ok(()); // Already exists, maybe update? For now just ignore or overwrite.
    }

    config.models.push(CustomModel {
        id: id.clone(),
        name,
        provider_id,
        base_model_id,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    });

    save_config(&config)
}

#[command]
pub fn remove_custom_model(id: String) -> Result<(), String> {
    let mut config = load_config();
    config.models.retain(|m| m.id != id);
    save_config(&config)
}
