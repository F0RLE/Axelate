use crate::errors::AppError;
use crate::infrastructure::persistence::json_store::JsonStore;
use crate::models::UIState;
use crate::utils::paths::FILE_UI_STATE;

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
        self.json_store.load_async(&FILE_UI_STATE).await
    }

    /// Save UI state to file
    pub async fn save_ui_state(&self, state: &UIState) -> Result<(), AppError> {
        self.json_store.save_async(&FILE_UI_STATE, state).await
    }
}

/// Get UI state from file synchronously (For startup/bootstrap only)
pub fn get_ui_state_sync() -> UIState {
    JsonStore::load_sync(&FILE_UI_STATE).unwrap_or_default()
}
