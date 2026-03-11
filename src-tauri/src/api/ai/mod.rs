use crate::domain::ai::{
    self, ChatSessionManager, ai_service,
    ai_service::{ChatRequest, ChatResponse},
};
use crate::app::window::{create_main_window, show_and_focus_window};
use crate::domain::engine::manager::EngineManager;
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use crate::infrastructure::config::ui_state::UiStateService;
use std::sync::Arc;
use tauri::{Manager, State, Window};

#[tauri::command]
#[specta::specta]
/// Sends a chat message to the AI provider and streams the response
pub async fn send_chat_message(
    window: Window,
    request: ChatRequest,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<ChatResponse, AppError> {
    ai_service::process_chat_request(window, request, &sessions, &config_service, &engine_manager)
        .await
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
pub async fn count_tokens(text: String, model: Option<String>) -> Result<u32, String> {
    tokio::task::spawn_blocking(move || {
        ai_service::count_tokens(&text, model.as_deref())
            .and_then(|c| u32::try_from(c).map_err(|_| "token count overflow".to_string()))
    })
    .await
    .map_err(|e| format!("Task joined with error: {e}"))?
}

#[tauri::command]
#[specta::specta]
/// Sends an image generation request to the connected AI provider
pub async fn generate_image(
    request: ai::ImageGenerationRequest,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<ai::ImageGenerationResponse, AppError> {
    ai_service::process_image_request(request, &sessions, &config_service, &engine_manager)
        .await
}

#[tauri::command]
#[specta::specta]
/// Starts image generation as a detached backend task and restores the window on completion.
pub async fn generate_image_background(
    app: tauri::AppHandle,
    _window: Window,
    request: ai::ImageGenerationRequest,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
    ui_state_service: State<'_, UiStateService>,
) -> Result<(), AppError> {
    let sessions = Arc::clone(&*sessions);
    let config_service = Arc::clone(&*config_service);
    let engine_manager = Arc::clone(&*engine_manager);
    let ui_state_service = ui_state_service.inner().clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        crate::app::tray::set_background_generation_active(&app_handle, "Generating image...");
        let result =
            ai_service::process_image_request(request, &sessions, &config_service, &engine_manager)
                .await;

        if let Err(error) = &result {
            tracing::error!("Background image generation failed: {error}");
        }

        let mut ui_state = ui_state_service.get_ui_state().await.unwrap_or_default();
        ui_state.last_page = Some("chat".to_string());
        ui_state.pending_chat_reveal = true;
        let _ = ui_state_service.save_ui_state(&ui_state).await;

        crate::app::tray::clear_background_generation(&app_handle);

        if let Some(window) = app_handle.get_webview_window("main") {
            show_and_focus_window(&window);
        } else if let Some(window) = create_main_window(&app_handle) {
            show_and_focus_window(&window);
        }
    });

    Ok(())
}
