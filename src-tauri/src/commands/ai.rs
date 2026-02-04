use crate::errors::AppError;
use crate::services::ai_service::{self, ChatRequest, ChatResponse};
use tauri::Window;

#[tauri::command]
pub async fn send_chat_message(
    window: Window,
    request: ChatRequest,
) -> Result<ChatResponse, AppError> {
    ai_service::process_chat_request(window, request).await
}

#[tauri::command]
pub async fn validate_api_key(provider: String, key: String) -> Result<bool, AppError> {
    ai_service::validate_api_key(provider, key).await
}

#[tauri::command]
pub fn clear_chat_history(session_id: String) -> Result<(), AppError> {
    if let Ok(mut sessions) = ai_service::SESSIONS.lock() {
        sessions.remove(&session_id);
    }
    Ok(())
}

#[tauri::command]
pub fn get_chat_history(session_id: String) -> Result<Vec<ai_service::ChatMessage>, AppError> {
    if let Ok(sessions) = ai_service::SESSIONS.lock()
        && let Some(session) = sessions.get(&session_id)
    {
        return Ok(session.history.clone());
    }
    Ok(Vec::new())
}

#[tauri::command]
pub fn count_tokens(text: String, model: Option<String>) -> Result<usize, String> {
    ai_service::count_tokens(text, model)
}
