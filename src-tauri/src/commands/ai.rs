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
