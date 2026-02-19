use crate::errors::AppError;
use crate::infrastructure::persistence::json_store::JsonStore;
use crate::models::AppSettings;
use crate::utils::paths::{FILE_ENV, FILE_GEN_CONFIG};
use serde_json::Value;
use std::fs;

/// Service for managing application settings with DI support
#[derive(Debug, Clone)]
pub struct SettingsService {
    json_store: JsonStore,
}

impl SettingsService {
    /// Creates a new SettingsService
    pub const fn new(json_store: JsonStore) -> Self {
        Self { json_store }
    }

    /// Retrieves application settings from .env file
    pub async fn get_settings(&self) -> Result<AppSettings, AppError> {
        if !FILE_ENV.exists() {
            return Ok(AppSettings::default());
        }

        let content = tokio::fs::read_to_string(&*FILE_ENV)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        let mut settings = AppSettings::default();

        for line in content.lines() {
            let parts: Vec<&str> = line.split('=').collect();
            if let [key, value] = parts.as_slice() {
                let key = key.trim();
                let value = value.trim();

                match key {
                    "LANGUAGE" => settings.language = value.to_string(),
                    "THEME" => settings.theme = value.to_string(),
                    "USE_GPU" => settings.use_gpu = value.parse().unwrap_or(true),
                    "DEBUG_MODE" => settings.debug_mode = value.parse().unwrap_or(false),
                    _ => {}
                }
            }
        }

        Ok(settings)
    }

    /// Saves application settings to .env file
    /// Asynchronously saves all application settings.
    pub async fn save_settings(&self, settings: &AppSettings) -> Result<(), AppError> {
        let content = format!(
            "LANGUAGE={}\nTHEME={}\nUSE_GPU={}\nDEBUG_MODE={}\n",
            settings.language, settings.theme, settings.use_gpu, settings.debug_mode
        );

        if let Some(parent) = FILE_ENV.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(e.to_string()))?;
        }

        tokio::fs::write(&*FILE_ENV, content)
            .await
            .map_err(|e| AppError::Io(e.to_string()))
    }

    /// Saves a single setting by key-value pair
    pub async fn save_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let mut settings = self.get_settings().await?;

        match key {
            "LANGUAGE" => settings.language = value.to_string(),
            "THEME" => settings.theme = value.to_string(),
            "USE_GPU" => settings.use_gpu = value.parse().unwrap_or(settings.use_gpu),
            "DEBUG_MODE" => settings.debug_mode = value.parse().unwrap_or(settings.debug_mode),
            _ => {}
        }

        self.save_settings(&settings).await
    }

    /// Retrieves generation configuration for AI models
    pub async fn get_gen_config(&self) -> Result<Value, AppError> {
        self.json_store.load_async(&FILE_GEN_CONFIG).await
    }

    /// Saves generation configuration to disk
    pub async fn save_gen_config(&self, config: &serde_json::Value) -> Result<(), AppError> {
        self.json_store.save_async(&FILE_GEN_CONFIG, config).await
    }
}

/// Get current language from settings synchronously (For startup/bootstrap only)
/// Keep as free function as it doesn't depend on JsonStore state and needs to be fast for bootstrap
pub fn get_language_sync() -> String {
    let settings = if FILE_ENV.exists() {
        fs::read_to_string(&*FILE_ENV)
            .map(|content| {
                let mut s = AppSettings::default();
                for line in content.lines() {
                    let parts: Vec<&str> = line.split('=').collect();
                    match parts.as_slice() {
                        [key, value] if key.trim() == "LANGUAGE" => {
                            s.language = value.trim().to_string();
                        }
                        _ => {}
                    }
                }
                s
            })
            .unwrap_or_default()
    } else {
        AppSettings::default()
    };

    if settings.language.is_empty() {
        crate::utils::windows::detect_system_language()
    } else {
        settings.language
    }
}
