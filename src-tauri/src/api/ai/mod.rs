use crate::domain::ai::{
    self, ChatSessionManager, ai_service,
    ai_service::{ChatRequest, ChatResponse},
};
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use std::sync::Arc;
use tauri::{State, Window};

#[tauri::command]
#[specta::specta]
/// Sends a chat message to the AI provider and streams the response
pub async fn send_chat_message(
    window: Window,
    request: ChatRequest,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
) -> Result<ChatResponse, AppError> {
    ai_service::process_chat_request(window, request, &sessions, &config_service).await
}

#[tauri::command]
#[specta::specta]
/// Validates an API key for the specified provider
pub async fn validate_api_key(provider: String, key: String) -> Result<bool, AppError> {
    ai_service::validate_api_key(provider, key).await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Clears chat history for a specific session
pub fn clear_chat_history(
    session_id: &str,
    sessions: State<'_, Arc<ChatSessionManager>>,
) -> Result<(), AppError> {
    sessions.clear_chat_history(session_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Retrieves chat history for a specific session
pub fn get_chat_history(
    session_id: &str,
    sessions: State<'_, Arc<ChatSessionManager>>,
) -> Result<Vec<ai::ChatMessage>, AppError> {
    Ok(sessions.get_chat_history(session_id))
}

#[tauri::command]
#[specta::specta]
/// Counts tokens in text for the specified model
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn count_tokens(text: String, model: Option<String>) -> Result<u32, AppError> {
    tokio::task::spawn_blocking(move || {
        ai_service::count_tokens(&text, model.as_deref())
            .map_err(|e| AppError::Internal {
                request_id: None,
                message: e,
            })
            .and_then(|c| {
                u32::try_from(c).map_err(|_| AppError::Internal {
                    request_id: None,
                    message: "Token count overflow".to_string(),
                })
            })
    })
    .await
    .map_err(|e| AppError::Internal {
        request_id: None,
        message: format!("Token count task failed: {e}"),
    })?
}
