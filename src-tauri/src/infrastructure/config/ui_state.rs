use crate::errors::AppError;
use crate::infrastructure::config::window_settings::{SCALING_MAX_ZOOM, SCALING_MIN_ZOOM};
use crate::infrastructure::persistence::json_store::JsonStore;
use crate::models::UIState;
use crate::utils::paths::FILE_UI_STATE;
use std::fs;

/// Service for managing UI state with DI support.
#[derive(Debug, Clone)]
pub struct UiStateService {
    json_store: JsonStore,
}

impl UiStateService {
    /// Creates a new `UiStateService`.
    pub const fn new(json_store: JsonStore) -> Self {
        Self { json_store }
    }

    /// Get UI state from file, or return defaults (Async version for runtime)
    pub async fn get_ui_state(&self) -> Result<UIState, AppError> {
        let state: UIState = self.json_store.load_async(&FILE_UI_STATE).await?;
        Ok(normalize_ui_state(state))
    }

    /// Save UI state to file
    pub async fn save_ui_state(&self, state: &UIState) -> Result<(), AppError> {
        let normalized = normalize_ui_state(state.clone());
        self.json_store
            .save_async(&FILE_UI_STATE, &normalized)
            .await
    }
}

/// Get UI state from file synchronously (For startup/bootstrap only)
pub fn get_ui_state_sync() -> UIState {
    load_ui_state_bootstrap(&FILE_UI_STATE)
}

fn load_ui_state_bootstrap(path: &std::path::Path) -> UIState {
    if !path.exists() {
        return UIState::default();
    }

    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => {
            tracing::error!(
                "Failed to read UI state at {}, resetting to defaults: {error}",
                path.display()
            );
            return UIState::default();
        }
    };

    let state = serde_json::from_str(&content).unwrap_or_else(|error| {
        tracing::error!(
            "Failed to parse UI state at {}, resetting to defaults: {error}",
            path.display()
        );
        UIState::default()
    });

    normalize_ui_state(state)
}

fn normalize_ui_state(mut state: UIState) -> UIState {
    state.zoom_level = clamp_zoom(state.zoom_level);
    state
        .resolution_zoom
        .values_mut()
        .for_each(|zoom| *zoom = clamp_zoom(*zoom));
    state
}

fn clamp_zoom(zoom: f64) -> f64 {
    if !zoom.is_finite() {
        return UIState::default().zoom_level;
    }

    zoom.clamp(SCALING_MIN_ZOOM, SCALING_MAX_ZOOM)
}
