use crate::errors::AppError;
use crate::services::ai_service::{self, ChatRequest, ChatResponse};
use tauri::Window;

#[tauri::command]
#[specta::specta]
/// Sends a chat message to the AI provider and streams the response
pub async fn send_chat_message(
    window: Window,
    request: ChatRequest,
) -> Result<ChatResponse, AppError> {
    ai_service::process_chat_request(window, request).await
}

#[tauri::command]
#[specta::specta]
/// Validates an API key for the specified provider
pub async fn validate_api_key(provider: String, key: String) -> Result<bool, AppError> {
    ai_service::validate_api_key(provider, key).await
}

#[tauri::command]
#[specta::specta]
/// Clears chat history for a specific session
pub fn clear_chat_history(session_id: &str) -> Result<(), AppError> {
    if let Ok(mut sessions) = ai_service::SESSIONS.lock() {
        sessions.remove(session_id);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Retrieves chat history for a specific session
pub fn get_chat_history(session_id: &str) -> Result<Vec<ai_service::ChatMessage>, AppError> {
    if let Ok(sessions) = ai_service::SESSIONS.lock()
        && let Some(session) = sessions.get(session_id)
    {
        return Ok(session.history.clone());
    }
    Ok(Vec::new())
}

#[tauri::command]
#[specta::specta]
/// Counts tokens in text for the specified model
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub fn count_tokens(text: String, model: Option<String>) -> Result<usize, String> {
    ai_service::count_tokens(&text, model.as_deref())
}
