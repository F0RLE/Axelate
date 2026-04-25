use crate::errors::AppError;
use crate::infrastructure::config::ui_state;
use crate::infrastructure::persistence::json_store::JsonStore;
use crate::models::{AppSettings, UIState};
use crate::utils::paths::{
    FILE_APP_SETTINGS, FILE_GEN_CONFIG, FILE_MODULE_SETTINGS, FILE_UI_STATE,
};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use tokio::sync::Mutex;

type ModuleSettingsStore = HashMap<String, HashMap<String, Value>>;
const RESERVED_SETTINGS_KEYS: [&str; 4] = ["language", "theme", "use_gpu", "debug_mode"];

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
        let mut settings: AppSettings = self.json_store.load_async(&FILE_APP_SETTINGS).await?;
        settings = normalize_settings(settings);
        settings.language = get_language_sync();

        Ok(settings)
    }

    /// Saves application settings to the canonical JSON store.
    pub async fn save_settings(&self, settings: &AppSettings) -> Result<(), AppError> {
        let settings = normalize_settings(settings.clone());
        self.save_preferred_language(&settings.language).await?;
        self.json_store
            .save_async(&FILE_APP_SETTINGS, &settings)
            .await
    }

    /// Saves a single setting by key-value pair
    pub async fn save_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let _lock = self.file_lock.lock().await;
        let mut settings = self.get_settings().await?;

        match normalize_setting_key(key).as_str() {
            "language" => {
                self.save_preferred_language(value).await?;
                settings.language = get_language_sync();
            }
            "theme" => {
                settings.theme = value.trim().to_string();
            }
            "use_gpu" => {
                settings.use_gpu = parse_bool_setting("use_gpu", value)?;
            }
            "debug_mode" => {
                settings.debug_mode = parse_bool_setting("debug_mode", value)?;
            }
            _ => {
                settings
                    .extra_settings
                    .insert(normalize_setting_key(key), value.to_string());
            }
        }

        self.save_settings(&settings).await
    }

    /// Retrieves JSON-backed settings for a specific module.
    pub async fn get_module_settings(
        &self,
        module_id: &str,
    ) -> Result<HashMap<String, Value>, AppError> {
        let mut store: ModuleSettingsStore =
            self.json_store.load_async(&FILE_MODULE_SETTINGS).await?;
        if let Some(settings) = store.remove(module_id) {
            return Ok(settings);
        }

        let normalized_id = module_id.trim().to_lowercase();
        let matching_key = store
            .keys()
            .find(|key| key.trim().to_lowercase() == normalized_id)
            .cloned();

        Ok(matching_key
            .and_then(|key| store.remove(&key))
            .unwrap_or_default())
    }

    /// Saves JSON-backed settings for a specific module.
    pub async fn save_module_settings(
        &self,
        module_id: &str,
        settings: &HashMap<String, Value>,
    ) -> Result<(), AppError> {
        let _lock = self.file_lock.lock().await;
        let mut store: ModuleSettingsStore =
            self.json_store.load_async(&FILE_MODULE_SETTINGS).await?;
        let normalized_id = module_id.trim().to_lowercase();
        store.retain(|key, _| key.trim().to_lowercase() != normalized_id);
        store.insert(module_id.to_string(), settings.clone());
        self.json_store
            .save_async(&FILE_MODULE_SETTINGS, &store)
            .await
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

fn normalize_setting_key(key: &str) -> String {
    key.trim().to_lowercase()
}

fn is_reserved_settings_key(key: &str) -> bool {
    RESERVED_SETTINGS_KEYS.contains(&key)
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings
        .extra_settings
        .retain(|key, _| !is_reserved_settings_key(key));
    settings
}

fn parse_bool_setting(key: &str, value: &str) -> Result<bool, AppError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(AppError::Validation(format!(
            "Setting {key} expects a boolean value"
        ))),
    }
}

fn load_app_settings_sync() -> Option<AppSettings> {
    if !FILE_APP_SETTINGS.exists() {
        return None;
    }

    fs::read_to_string(&*FILE_APP_SETTINGS)
        .ok()
        .and_then(|content| serde_json::from_str::<AppSettings>(&content).ok())
        .map(normalize_settings)
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

    if let Some(language) = load_app_settings_sync()
        .map(|settings| settings.language.trim().to_lowercase())
        .filter(|language| !language.is_empty())
    {
        return language;
    }

    crate::utils::locale::detect_system_language()
}

#[cfg(test)]
mod tests {
    use super::{normalize_settings, parse_bool_setting};
    use crate::errors::AppError;
    use crate::models::AppSettings;

    #[test]
    fn normalize_settings_removes_reserved_keys_from_extra_settings() {
        let mut settings = AppSettings::default();
        settings
            .extra_settings
            .insert("language".to_string(), "ru".to_string());
        settings
            .extra_settings
            .insert("custom_flag".to_string(), "1".to_string());

        let normalized = normalize_settings(settings);

        assert!(!normalized.extra_settings.contains_key("language"));
        assert_eq!(
            normalized.extra_settings.get("custom_flag"),
            Some(&"1".to_string())
        );
    }

    #[test]
    fn parse_bool_setting_accepts_common_variants() {
        assert!(matches!(parse_bool_setting("debug_mode", "true"), Ok(true)));
        assert!(matches!(parse_bool_setting("debug_mode", "0"), Ok(false)));
    }

    #[test]
    fn parse_bool_setting_rejects_invalid_values() {
        assert!(matches!(
            parse_bool_setting("use_gpu", "maybe"),
            Err(AppError::Validation(_))
        ));
    }
}
