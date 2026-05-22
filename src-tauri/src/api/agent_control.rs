//! Tauri commands for trusted local Agent Control.

use crate::domain::agent_control::{
    AgentApprovalRequest, AgentControlService, AgentControlState, AgentProfileTokenResponse,
    AgentScope,
};
use crate::errors::AppError;

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

/// Revokes a trusted local agent profile.
#[tauri::command]
#[specta::specta]
pub async fn revoke_agent_profile(
    service: tauri::State<'_, AgentControlService>,
    id: String,
) -> Result<AgentControlState, AppError> {
    service.revoke_profile(&id, api_base_url()).await
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

/// Creates a pending approval request from the UI for tests and manual flows.
#[tauri::command]
#[specta::specta]
pub async fn create_agent_approval_request(
    service: tauri::State<'_, AgentControlService>,
    agent_id: String,
    agent_name: String,
    action: String,
    target: String,
    diff: String,
    risk: String,
) -> Result<AgentApprovalRequest, AppError> {
    let agent = crate::domain::agent_control::AuthorizedAgent {
        id: agent_id,
        name: agent_name,
        scopes: crate::domain::agent_control::trusted_local_scopes(),
    };
    service
        .create_approval_request(&agent, action, target, diff, risk)
        .await
}
