use crate::errors::AppError;
use crate::models::UIState;
use crate::services::ui_state;

#[tauri::command]
pub async fn get_ui_state() -> Result<UIState, AppError> {
    ui_state::get_ui_state()
}

#[tauri::command]
pub async fn save_ui_state(state: UIState) -> Result<(), AppError> {
    ui_state::save_ui_state(state)
}
