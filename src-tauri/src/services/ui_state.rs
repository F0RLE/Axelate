use crate::errors::AppError;
use crate::models::UIState;
use crate::utils::paths::FILE_UI_STATE;
use std::fs;

/// Get UI state from file, or return defaults
pub fn get_ui_state() -> Result<UIState, AppError> {
    if !FILE_UI_STATE.exists() {
        return Ok(UIState::default());
    }

    let content = fs::read_to_string(&*FILE_UI_STATE).map_err(AppError::Io)?;
    serde_json::from_str(&content).map_err(AppError::Serialization)
}

/// Save UI state to file
pub fn save_ui_state(state: UIState) -> Result<(), AppError> {
    if let Some(parent) = FILE_UI_STATE.parent() {
        fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let content = serde_json::to_string_pretty(&state).map_err(AppError::Serialization)?;
    fs::write(&*FILE_UI_STATE, content).map_err(AppError::Io)
}
