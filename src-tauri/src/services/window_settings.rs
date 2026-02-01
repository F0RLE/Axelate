// Window settings persistence service
// Saves and restores window size, position, and zoom level

use crate::errors::AppError;
use crate::utils::paths::CONFIG_DIR;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Scaling constants
pub const SCALING_BASELINE_HEIGHT: f64 = 600.0;
pub const SCALING_MIN_ZOOM: f64 = 0.5;
pub const SCALING_MAX_ZOOM: f64 = 3.0;

/// Breakpoints and Thresholds
pub const BP_COMPACT: u32 = 600;
pub const BP_MEDIUM: u32 = 900;
pub const BP_LARGE: u32 = 1200;

pub const THRESHOLD_WARNING_WIDTH: u32 = 700;
pub const THRESHOLD_WARNING_HEIGHT: u32 = 500;

pub const THRESHOLD_SMALL_SCREEN_WIDTH: u32 = 1400;
pub const THRESHOLD_SMALL_SCREEN_HEIGHT: u32 = 900;
pub const THRESHOLD_PORTRAIT_HEIGHT: u32 = 1000;
pub const THRESHOLD_PORTRAIT_MIN_WIDTH: u32 = 700;

/// Window configuration for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    pub breakpoints: Breakpoints,
    pub thresholds: Thresholds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakpoints {
    pub compact: u32,
    pub medium: u32,
    pub large: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thresholds {
    pub warning_width: u32,
    pub warning_height: u32,
    pub small_screen_width: u32,
    pub small_screen_height: u32,
}

/// Window policy response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPolicy {
    pub is_small_screen: bool,
    pub show_warning: bool,
}

pub fn get_window_config() -> WindowConfig {
    WindowConfig {
        breakpoints: Breakpoints {
            compact: BP_COMPACT,
            medium: BP_MEDIUM,
            large: BP_LARGE,
        },
        thresholds: Thresholds {
            warning_width: THRESHOLD_WARNING_WIDTH,
            warning_height: THRESHOLD_WARNING_HEIGHT,
            small_screen_width: THRESHOLD_SMALL_SCREEN_WIDTH,
            small_screen_height: THRESHOLD_SMALL_SCREEN_HEIGHT,
        },
    }
}

pub fn calculate_window_policy(
    screen_w: u32,
    screen_h: u32,
    window_w: u32,
    window_h: u32,
) -> WindowPolicy {
    let is_portrait = screen_h > screen_w;
    let is_small_screen = if is_portrait && screen_h >= THRESHOLD_PORTRAIT_HEIGHT {
        screen_w < THRESHOLD_PORTRAIT_MIN_WIDTH
    } else {
        screen_w < THRESHOLD_SMALL_SCREEN_WIDTH || screen_h < THRESHOLD_SMALL_SCREEN_HEIGHT
    };

    let show_warning = window_w < THRESHOLD_WARNING_WIDTH || window_h < THRESHOLD_WARNING_HEIGHT;

    WindowPolicy {
        is_small_screen,
        show_warning,
    }
}

/// Calculates the adaptive zoom level based on screen height.
/// 600px height is considered 100% (1.0).
pub fn calculate_adaptive_zoom(height: u32) -> f64 {
    // Cap height at 900 to prevent over-zooming on resolutions above 1440x900
    let effective_height = height.min(900);
    let zoom = (effective_height as f64) / SCALING_BASELINE_HEIGHT;
    zoom.clamp(SCALING_MIN_ZOOM, SCALING_MAX_ZOOM)
}

/// Window settings structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSettings {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            width: 1400,
            height: 900,
            x: None,
            y: None,
            maximized: false,
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
