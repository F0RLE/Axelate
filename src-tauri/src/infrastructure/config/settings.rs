use crate::errors::AppError;
use crate::infrastructure::config::ui_state;
use crate::infrastructure::persistence::json_store::JsonStore;
use crate::models::{AppSettings, UIState};
use crate::utils::paths::{FILE_ENV, FILE_GEN_CONFIG, FILE_UI_STATE};
use serde_json::Value;
use std::fs;
use std::sync::Arc;
use tokio::sync::Mutex;

fn is_deprecated_env_key(key: &str) -> bool {
    matches!(
        key.to_uppercase().as_str(),
        "LANGUAGE" | "THEME" | "USE_GPU" | "DEBUG_MODE" | "BOT_LANGUAGE"
    )
}

/// Service for managing application settings with DI support
#[derive(Debug, Clone)]
pub struct SettingsService {
    json_store: JsonStore,
    file_lock: Arc<Mutex<()>>,
}

impl SettingsService {
    /// Creates a new SettingsService
    pub fn new(json_store: JsonStore) -> Self {
        Self {
            json_store,
            file_lock: Arc::new(Mutex::new(())),
        }
    }

    /// Retrieves application settings from .env file
    pub async fn get_settings(&self) -> Result<AppSettings, AppError> {
        let mut settings = AppSettings {
            language: get_language_sync(),
            ..AppSettings::default()
        };
        if !FILE_ENV.exists() {
            return Ok(settings);
        }

        let content = tokio::fs::read_to_string(&*FILE_ENV)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;

        for line in content.lines() {
            let parts: Vec<&str> = line.splitn(2, '=').collect();
            if let [key, value] = parts.as_slice() {
                let key = key.trim();
                let value = value.trim();

                if is_deprecated_env_key(key) {
                    continue;
                }

                settings
                    .extra_settings
                    .insert(key.to_lowercase(), value.to_string());
            }
        }

        Ok(settings)
    }

    /// Saves application settings to .env file
    /// Asynchronously saves all application settings including dynamic keys.
    pub async fn save_settings(&self, settings: &AppSettings) -> Result<(), AppError> {
        let mut content = String::new();

        // Append all extra settings
        use std::fmt::Write;
        for (key, value) in &settings.extra_settings {
            if is_deprecated_env_key(key) {
                continue;
            }
            let _ = writeln!(content, "{}={}", key.to_uppercase(), value);
        }

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
        let _lock = self.file_lock.lock().await;
        let mut settings = self.get_settings().await?;

        let normalized_key = key.to_uppercase();
        match normalized_key.as_str() {
            "LANGUAGE" => {
                self.save_preferred_language(value).await?;
                settings.language = get_language_sync();
            }
            "THEME" => {
                settings.theme = AppSettings::default().theme;
            }
            "USE_GPU" => {
                settings.use_gpu = AppSettings::default().use_gpu;
            }
            "DEBUG_MODE" => {
                settings.debug_mode = AppSettings::default().debug_mode;
            }
            "BOT_LANGUAGE" => {}
            _ => {
                settings
                    .extra_settings
                    .insert(key.to_lowercase(), value.to_string());
            }
        }

        settings
            .extra_settings
            .retain(|existing_key, _| !is_deprecated_env_key(existing_key));

        self.save_settings(&settings).await
    }

    async fn save_preferred_language(&self, language: &str) -> Result<(), AppError> {
        let mut ui_state = self
            .json_store
            .load_async::<UIState>(&FILE_UI_STATE)
            .await
            .unwrap_or_default();

        let normalized = language.trim().to_lowercase();
        ui_state.preferred_language = if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        };

        self.json_store.save_async(&FILE_UI_STATE, &ui_state).await
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
    let ui_state = ui_state::get_ui_state_sync();
    if let Some(language) = ui_state.preferred_language
        && !language.trim().is_empty()
    {
        return language;
    }

    let legacy_language = if FILE_ENV.exists() {
        fs::read_to_string(&*FILE_ENV)
            .map(|content| {
                for line in content.lines() {
                    let parts: Vec<&str> = line.split('=').collect();
                    match parts.as_slice() {
                        [key, value] if key.trim() == "LANGUAGE" => {
                            return value.trim().to_lowercase();
                        }
                        _ => {}
                    }
                }
                String::new()
            })
            .unwrap_or_default()
    } else {
        String::new()
    };

    if legacy_language.is_empty() {
        crate::utils::windows::detect_system_language()
    } else {
        legacy_language
    }
}
