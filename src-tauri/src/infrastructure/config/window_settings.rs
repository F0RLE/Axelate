// Window settings persistence service
// Saves and restores window size, position, and zoom level

use crate::errors::AppError;
use crate::utils::paths::CONFIG_DIR;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Scaling constants
/// Baseline height for scaling calculations
pub const SCALING_BASELINE_HEIGHT: f64 = 600.0;
/// Minimum allowed zoom level
pub const SCALING_MIN_ZOOM: f64 = 0.5;
/// Maximum allowed zoom level
pub const SCALING_MAX_ZOOM: f64 = 3.0;

/// Breakpoints and Thresholds
/// Compact breakpoint width
pub const BP_COMPACT: u32 = 600;
/// Medium breakpoint width
pub const BP_MEDIUM: u32 = 900;
/// Large breakpoint width
pub const BP_LARGE: u32 = 1200;

/// Warning threshold width
pub const THRESHOLD_WARNING_WIDTH: u32 = 700;
/// Warning threshold height
pub const THRESHOLD_WARNING_HEIGHT: u32 = 500;

/// Small screen width threshold
pub const THRESHOLD_SMALL_SCREEN_WIDTH: u32 = 1400;
/// Small screen height threshold
pub const THRESHOLD_SMALL_SCREEN_HEIGHT: u32 = 900;
/// Portrait mode height threshold
pub const THRESHOLD_PORTRAIT_HEIGHT: u32 = 1000;
/// Portrait mode minimum width
pub const THRESHOLD_PORTRAIT_MIN_WIDTH: u32 = 700;

use specta::Type;

/// Window configuration for the frontend
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    /// Responsive breakpoints
    pub breakpoints: Breakpoints,
    /// Screen thresholds
    pub thresholds: Thresholds,
}

/// Responsive breakpoints for layout
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Breakpoints {
    /// Compact width
    pub compact: u32,
    /// Medium width
    pub medium: u32,
    /// Large width
    pub large: u32,
}

/// Screen thresholds for warnings
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Thresholds {
    /// Warning width
    pub warning_width: u32,
    /// Warning height
    pub warning_height: u32,
    /// Small screen width
    pub small_screen_width: u32,
    /// Small screen height
    pub small_screen_height: u32,
}

/// Window policy response
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowPolicy {
    /// Whether screen is small
    pub is_small_screen: bool,
    /// Whether to show size warning
    pub show_warning: bool,
}

/// Returns window configuration with breakpoints and thresholds
pub const fn get_window_config() -> WindowConfig {
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

/// Calculates window policy based on screen and window dimensions
pub const fn calculate_window_policy(
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
    let effective_height = height.min(900);
    let zoom = f64::from(effective_height) / SCALING_BASELINE_HEIGHT;
    zoom.clamp(SCALING_MIN_ZOOM, SCALING_MAX_ZOOM)
}

/// Window settings structure
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WindowSettings {
    /// Window width
    pub width: u32,
    /// Window height
    pub height: u32,
    /// Window X position
    pub x: Option<i32>,
    /// Window Y position
    pub y: Option<i32>,
    /// Whether window is maximized
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

/// Returns path to window settings file
fn settings_file() -> PathBuf {
    CONFIG_DIR.join("window-settings.json")
}

/// Loads window settings from file
pub fn load_window_settings() -> WindowSettings {
    let path = settings_file();

    if !path.exists() {
        return WindowSettings::default();
    }

    fs::read_to_string(&path).map_or_else(
        |_| WindowSettings::default(),
        |content| serde_json::from_str(&content).unwrap_or_default(),
    )
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

/// Updates the window position in settings
pub fn update_window_position(x: i32, y: i32) -> Result<(), AppError> {
    let mut settings = load_window_settings();
    settings.x = Some(x);
    settings.y = Some(y);
    save_window_settings(&settings)
}

/// Updates the window maximized state in settings
pub fn update_maximized_state(maximized: bool) -> Result<(), AppError> {
    let mut settings = load_window_settings();
    settings.maximized = maximized;
    save_window_settings(&settings)
}
