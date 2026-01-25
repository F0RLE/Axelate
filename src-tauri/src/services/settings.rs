use crate::errors::AppError;
use crate::models::AppSettings;
use crate::utils::paths::{FILE_ENV, FILE_GEN_CONFIG};
use serde_json::Value;
use std::fs;

pub fn get_settings() -> Result<AppSettings, AppError> {
    if !FILE_ENV.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&*FILE_ENV).map_err(AppError::Io)?;
    let mut settings = AppSettings::default();

    for line in content.lines() {
        let parts: Vec<&str> = line.split('=').collect();
        if parts.len() == 2 {
            let key = parts[0].trim();
            let value = parts[1].trim();

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

pub fn save_settings(settings: AppSettings) -> Result<(), AppError> {
    let content = format!(
        "LANGUAGE={}\nTHEME={}\nUSE_GPU={}\nDEBUG_MODE={}\n",
        settings.language, settings.theme, settings.use_gpu, settings.debug_mode
    );

    fs::write(&*FILE_ENV, content).map_err(AppError::Io)
}

pub fn save_setting(key: &str, value: &str) -> Result<(), AppError> {
    let mut settings = get_settings()?;

    match key {
        "LANGUAGE" => settings.language = value.to_string(),
        "THEME" => settings.theme = value.to_string(),
        "USE_GPU" => settings.use_gpu = value.parse().unwrap_or(settings.use_gpu),
        "DEBUG_MODE" => settings.debug_mode = value.parse().unwrap_or(settings.debug_mode),
        // If unknown key, we just ignore it (or could return error).
        // For compatibility with legacy keys like BOT_LANGUAGE we just ignore.
        _ => {}
    }

    save_settings(settings)
}

pub fn get_gen_config() -> Result<Value, AppError> {
    if !FILE_GEN_CONFIG.exists() {
        return Ok(serde_json::json!({
            "llm_temp": 0.7,
            "llm_ctx": 4096,
            "sd_steps": 30,
            "sd_cfg": 6.0,
            "sd_width": 896,
            "sd_height": 1152,
            "sd_sampler": "DPM++ 2M",
            "sd_scheduler": "Karras"
        }));
    }

    let content = fs::read_to_string(&*FILE_GEN_CONFIG).map_err(AppError::Io)?;
    serde_json::from_str(&content).map_err(AppError::Serialization)
}

pub fn save_gen_config(config: Value) -> Result<(), AppError> {
    let content = serde_json::to_string_pretty(&config).map_err(AppError::Serialization)?;
    fs::write(&*FILE_GEN_CONFIG, content).map_err(AppError::Io)
}

/// Get current language from settings, or detect from Windows if not set
pub fn get_language() -> String {
    get_settings()
        .map(|s| {
            if s.language.is_empty() {
                // No language saved, detect from system
                crate::utils::windows::detect_system_language()
            } else {
                s.language
            }
        })
        .unwrap_or_else(|_| crate::utils::windows::detect_system_language())
}
