use crate::errors::AppError;
use crate::infrastructure::config::ui_state;
use crate::models::UIState;

#[tauri::command]
#[specta::specta]
/// Retrieves persisted UI state (sidebar, zoom, selected modules)
pub async fn get_ui_state(
    ui_state_service: tauri::State<'_, ui_state::UiStateService>,
) -> Result<UIState, AppError> {
    ui_state_service.get_ui_state().await
}

#[tauri::command]
#[specta::specta]
/// Saves UI state to persistent storage
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn save_ui_state(
    ui_state_service: tauri::State<'_, ui_state::UiStateService>,
    state: UIState,
) -> Result<(), AppError> {
    ui_state_service.save_ui_state(&state).await
}
