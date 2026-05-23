//! Tauri commands for trusted local Agent Control.

use crate::domain::agent_control::{
    AgentControlService, AgentControlState, AgentProfileTokenResponse, AgentScope,
};
use crate::errors::AppError;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

fn api_base_url() -> String {
    crate::domain::integration_api::api_base_url().to_string()
}

/// Returns redacted Agent Control state.
#[tauri::command]
#[specta::specta]
pub async fn get_agent_control_state(
    service: tauri::State<'_, AgentControlService>,
) -> Result<AgentControlState, AppError> {
    service.state(api_base_url()).await
}

/// Enables or disables trusted local Agent Control profiles.
#[tauri::command]
#[specta::specta]
pub async fn set_agent_control_enabled(
    service: tauri::State<'_, AgentControlService>,
    enabled: bool,
) -> Result<AgentControlState, AppError> {
    service.set_enabled(enabled, api_base_url()).await
}

/// Creates a trusted local agent profile and returns its one-time token.
#[tauri::command]
#[specta::specta]
pub async fn create_agent_profile(
    service: tauri::State<'_, AgentControlService>,
    name: Option<String>,
    scopes: Option<Vec<AgentScope>>,
) -> Result<AgentProfileTokenResponse, AppError> {
    service.create_profile(name, scopes).await
}

/// Rotates a trusted local agent token and returns the replacement token once.
#[tauri::command]
#[specta::specta]
pub async fn rotate_agent_profile(
    service: tauri::State<'_, AgentControlService>,
    id: String,
) -> Result<AgentProfileTokenResponse, AppError> {
    service.rotate_profile(&id).await
}

/// Copies a one-time agent token to the OS clipboard without exposing it to the frontend.
#[tauri::command]
#[specta::specta]
pub async fn copy_agent_profile_token(
    app: AppHandle,
    service: tauri::State<'_, AgentControlService>,
    id: String,
) -> Result<(), AppError> {
    let token = service.take_pending_token(&id).await?;
    app.clipboard()
        .write_text(token)
        .map_err(|error| AppError::External {
            message: format!("Failed to copy Agent Control token: {error}"),
            request_id: None,
        })?;
    Ok(())
}

/// Deletes a trusted local agent profile.
#[tauri::command]
#[specta::specta]
pub async fn delete_agent_profile(
    service: tauri::State<'_, AgentControlService>,
    id: String,
) -> Result<AgentControlState, AppError> {
    service.delete_profile(&id, api_base_url()).await
}

/// Applies a user decision to a pending agent approval request.
#[tauri::command]
#[specta::specta]
pub async fn decide_agent_approval(
    service: tauri::State<'_, AgentControlService>,
    id: String,
    approved: bool,
) -> Result<AgentControlState, AppError> {
    service.decide_approval(&id, approved, api_base_url()).await
}
