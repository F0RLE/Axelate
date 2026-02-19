use crate::errors::AppError;
use crate::infrastructure::persistence::json_store::JsonStore;
use crate::utils::paths::CONFIG_DIR;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

/// Scaling constants
/// Baseline height for scaling calculations.
pub const SCALING_BASELINE_HEIGHT: f64 = 600.0;
/// Minimum allowed zoom level.
pub const SCALING_MIN_ZOOM: f64 = 0.5;
/// Maximum allowed zoom level.
pub const SCALING_MAX_ZOOM: f64 = 3.0;

/// Breakpoints and Thresholds
/// Compact breakpoint width.
pub const BP_COMPACT: u32 = 600;
/// Medium breakpoint width.
pub const BP_MEDIUM: u32 = 900;
/// Large breakpoint width.
pub const BP_LARGE: u32 = 1200;

/// Threshold for showing layout warnings (width).
pub const THRESHOLD_WARNING_WIDTH: u32 = 800;
/// Threshold for showing layout warnings (height).
pub const THRESHOLD_WARNING_HEIGHT: u32 = 600;

/// Threshold for considering a screen "small" (width).
pub const THRESHOLD_SMALL_SCREEN_WIDTH: u32 = 1400;
/// Threshold for considering a screen "small" (height).
pub const THRESHOLD_SMALL_SCREEN_HEIGHT: u32 = 900;
/// Threshold for portrait orientation (height).
pub const THRESHOLD_PORTRAIT_HEIGHT: u32 = 1000;
/// Minimum width for portrait orientation consideration.
pub const THRESHOLD_PORTRAIT_MIN_WIDTH: u32 = 700;

/// Overall window configuration combining breakpoints and thresholds.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    /// Breakpoint settings.
    pub breakpoints: Breakpoints,
    /// Threshold settings.
    pub thresholds: Thresholds,
}

/// Breakpoints configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Breakpoints {
    /// Width for compact layout.
    pub compact: u32,
    /// Width for medium layout.
    pub medium: u32,
    /// Width for large layout.
    pub large: u32,
}

/// Thresholds configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Thresholds {
    /// Warning threshold width.
    pub warning_width: u32,
    /// Warning threshold height.
    pub warning_height: u32,
    /// Small screen threshold width.
    pub small_screen_width: u32,
    /// Small screen threshold height.
    pub small_screen_height: u32,
}

/// Layout policy based on screen size and current window dimensions.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowPolicy {
    /// True if the screen is considered "small" (mobile/tablet/small laptop).
    pub is_small_screen: bool,
    /// True if a layout warning should be shown.
    pub show_warning: bool,
}

/// Persistent window state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WindowSettings {
    /// Window width.
    pub width: u32,
    /// Window height.
    pub height: u32,
    /// Horizontal screen position.
    pub x: Option<i32>,
    /// Vertical screen position.
    pub y: Option<i32>,
    /// True if the window is maximized.
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

/// Service for managing window settings with DI support.
#[derive(Debug, Clone)]
pub struct WindowSettingsService {
    json_store: JsonStore,
}

impl WindowSettingsService {
    /// Creates a new `WindowSettingsService`.
    pub const fn new(json_store: JsonStore) -> Self {
        Self { json_store }
    }

    /// Loads window settings from file
    pub async fn get_window_settings(&self) -> Result<WindowSettings, AppError> {
        self.json_store.load_async(&settings_file()).await
    }

    /// Save window settings to file
    pub async fn save_window_settings(&self, settings: &WindowSettings) -> Result<(), AppError> {
        self.json_store.save_async(&settings_file(), settings).await
    }

    /// Update specific window properties
    pub async fn update_window_size(&self, width: u32, height: u32) -> Result<(), AppError> {
        let mut settings = self.get_window_settings().await?;
        settings.width = width;
        settings.height = height;
        self.save_window_settings(&settings).await
    }

    /// Updates the window position in settings.
    pub async fn update_window_position(&self, x: i32, y: i32) -> Result<(), AppError> {
        let mut settings = self.get_window_settings().await?;
        settings.x = Some(x);
        settings.y = Some(y);
        self.save_window_settings(&settings).await
    }

    /// Updates the window maximized state in settings.
    pub async fn update_maximized_state(&self, maximized: bool) -> Result<(), AppError> {
        let mut settings = self.get_window_settings().await?;
        settings.maximized = maximized;
        self.save_window_settings(&settings).await
    }
}

/// Helper functions
fn settings_file() -> PathBuf {
    CONFIG_DIR.join("window-settings.json")
}

/// Retrieves the current global window configuration.
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

/// Calculates the window layout policy based on screen and window dimensions.
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

/// Calculates an adaptive zoom level based on the screen height.
pub fn calculate_adaptive_zoom(height: u32) -> f64 {
    let effective_height = height.min(900);
    let zoom = f64::from(effective_height) / SCALING_BASELINE_HEIGHT;
    zoom.clamp(SCALING_MIN_ZOOM, SCALING_MAX_ZOOM)
}

/// Synchronously loads window settings from disk.
pub fn load_window_settings() -> WindowSettings {
    JsonStore::load_sync(&settings_file()).unwrap_or_default()
}
