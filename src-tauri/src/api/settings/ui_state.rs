use crate::errors::AppError;
use crate::infrastructure::config::ui_state;
use crate::models::UIState;

#[tauri::command]
#[specta::specta]
/// Retrieves persisted UI state (sidebar, zoom, selected modules)
pub async fn get_ui_state() -> Result<UIState, AppError> {
    ui_state::get_ui_state()
}

#[tauri::command]
#[specta::specta]
/// Saves UI state to persistent storage
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn save_ui_state(state: UIState) -> Result<(), AppError> {
    ui_state::save_ui_state(&state)
}
