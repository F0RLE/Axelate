// Window settings persistence service
// Saves and restores window size, position, and zoom level

use crate::errors::AppError;
use crate::utils::paths::CONFIG_DIR;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Window settings structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSettings {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
    pub zoom_level: f64,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            width: 1400,
            height: 900,
            x: None,
            y: None,
            maximized: false,
            zoom_level: 1.0,
        }
    }
}

fn settings_file() -> PathBuf {
    CONFIG_DIR.join("window-settings.json")
}

/// Load window settings from file
pub fn load_window_settings() -> WindowSettings {
    let path = settings_file();

    if !path.exists() {
        return WindowSettings::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => WindowSettings::default(),
    }
}

/// Save window settings to file
pub fn save_window_settings(settings: &WindowSettings) -> Result<(), AppError> {
    let path = settings_file();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppError::Io)?;
    }

    let content = serde_json::to_string_pretty(settings).map_err(AppError::Serialization)?;

    fs::write(&path, content).map_err(AppError::Io)
}

/// Update specific window properties
pub fn update_window_size(width: u32, height: u32) -> Result<(), AppError> {
    let mut settings = load_window_settings();
    settings.width = width;
    settings.height = height;
    save_window_settings(&settings)
}

pub fn update_window_position(x: i32, y: i32) -> Result<(), AppError> {
    let mut settings = load_window_settings();
    settings.x = Some(x);
    settings.y = Some(y);
    save_window_settings(&settings)
}

pub fn update_maximized_state(maximized: bool) -> Result<(), AppError> {
    let mut settings = load_window_settings();
    settings.maximized = maximized;
    save_window_settings(&settings)
}

pub fn update_zoom_level(zoom: f64) -> Result<(), AppError> {
    let mut settings = load_window_settings();
    settings.zoom_level = zoom;
    save_window_settings(&settings)
}
