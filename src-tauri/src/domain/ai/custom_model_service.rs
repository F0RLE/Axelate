use crate::errors::AppError;
use crate::models::custom_models::{CustomModel, CustomModelConfig};
use crate::utils::paths::CONFIG_DIR;
use std::path::PathBuf;
use tauri::command;

// ==================================================================================
// Repository (Data Access)
// ==================================================================================

struct CustomModelConfigRepository;

impl CustomModelConfigRepository {
    fn get_path() -> PathBuf {
        CONFIG_DIR.join("custom_models.json")
    }

    fn load() -> Result<CustomModelConfig, AppError> {
        let path = Self::get_path();
        if !path.exists() {
            return Ok(CustomModelConfig::default());
        }

        let content = std::fs::read_to_string(path).map_err(|e| AppError::Io(e.to_string()))?;
        let config: CustomModelConfig =
            serde_json::from_str(&content).map_err(|e| AppError::Serialization(e.to_string()))?;
        Ok(config)
    }

    /// Saves custom models to disk
    fn save(config: &CustomModelConfig) -> Result<(), AppError> {
        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Serialization(e.to_string()))?;
        let path = Self::get_path();

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::Io(e.to_string()))?;
        }

        std::fs::write(path, content).map_err(|e| AppError::Io(e.to_string()))?;
        Ok(())
    }
}

// ==================================================================================
// Service (Business Logic)
// ==================================================================================

/// Service responsible for managing custom AI model configurations.
#[derive(Debug)]
pub struct CustomModelManager;

impl CustomModelManager {
    /// Retrieves all configured custom models.
    pub fn get_all() -> Result<Vec<CustomModel>, AppError> {
        let config = CustomModelConfigRepository::load()?;
        Ok(config.models)
    }

    /// Adds a new custom model configuration.
    pub fn add(
        provider_id: String,
        id: String,
        name: String,
        base_model_id: String,
    ) -> Result<(), AppError> {
        let mut config = CustomModelConfigRepository::load()?;

        // Idempotency check
        if config
            .models
            .iter()
            .any(|m| m.id == id && m.provider_id == provider_id)
        {
            return Ok(());
        }

        let new_model = CustomModel {
            id,
            name,
            provider_id,
            base_model_id,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64(),
        };

        config.models.push(new_model);
        CustomModelConfigRepository::save(&config)
    }

    /// Removes a custom model by its ID.
    pub fn remove(id: &str) -> Result<(), AppError> {
        let mut config = CustomModelConfigRepository::load()?;
        config.models.retain(|m| m.id != id);
        CustomModelConfigRepository::save(&config)
    }
}

// ==================================================================================
// Commands (Interface Adapter)
// ==================================================================================

#[command]
#[specta::specta]
/// Retrieves all custom AI models configured by the user
pub fn get_custom_models() -> Result<Vec<CustomModel>, AppError> {
    CustomModelManager::get_all()
}

#[command]
#[specta::specta]
/// Adds a new custom AI model configuration
pub fn add_custom_model(
    provider_id: String,
    id: String,
    name: String,
    base_model_id: String,
) -> Result<(), AppError> {
    CustomModelManager::add(provider_id, id, name, base_model_id)
}

#[command]
#[specta::specta]
/// Removes a custom AI model by ID
#[allow(clippy::needless_pass_by_value)]
pub fn remove_custom_model(id: String) -> Result<(), AppError> {
    CustomModelManager::remove(&id)
}
