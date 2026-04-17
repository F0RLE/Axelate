use super::AppState;
use super::ai_http::{
    HttpAiImageRequest, HttpAiMessage, is_local_provider, map_http_history, resolve_image_provider,
    resolve_model, resolve_module_model, resolve_text_provider, resolve_web_search_options,
};
use crate::domain::ai::{self, ChatMessage, ChatRequest, ImageGenerationRequest, NoopSink};
use crate::infrastructure::crypto::secure_storage::SecureStorage;
use axum::{Json, extract::State};
use std::sync::Arc;

#[derive(serde::Deserialize)]
pub(super) struct UiChatRequest {
    text: String,
    history: Option<Vec<HttpAiMessage>>,
    provider: Option<String>,
    model: Option<String>,
    session_id: Option<String>,
    thinking_level: Option<String>,
    max_tokens: Option<u32>,
}

#[derive(serde::Serialize)]
pub(super) struct UiChatResponse {
    ok: bool,
    text: Option<String>,
    error: Option<String>,
    provider: String,
    model: String,
}

pub(super) async fn chat_handler(
    State(state): State<AppState>,
    Json(payload): Json<UiChatRequest>,
) -> Result<Json<UiChatResponse>, crate::errors::AppError> {
    let ui_state = state.ui_state.get_ui_state().await.unwrap_or_default();
    let provider = resolve_text_provider(&ui_state, payload.provider.as_deref());
    let model = resolve_module_model(
        &ui_state,
        &state.config,
        &provider,
        payload.model.as_deref(),
    );

    let mut messages = map_http_history(payload.history);
    messages.push(ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        role: "user".to_string(),
        content: serde_json::Value::String(payload.text.trim().to_string()),
        thought_signature: None,
    });

    let api_key = if is_local_provider(&provider) {
        None
    } else {
        SecureStorage::get_key_async("openrouter_api_key".to_string()).await?
    };

    let request = ChatRequest {
        provider: provider.clone(),
        model: model.clone(),
        messages,
        api_key,
        thinking_level: payload.thinking_level,
        max_tokens: payload.max_tokens,
        request_id: None,
        session_id: payload
            .session_id
            .filter(|value| !value.trim().is_empty())
            .or_else(|| ui_state.ai_session_id.clone()),
        web_search: resolve_web_search_options(&ui_state, &provider),
    };

    let response = ai::ai_service::process_chat_request(
        request,
        &state.sessions,
        &state.config,
        &state.engine_manager,
        Arc::new(NoopSink),
    )
    .await?;

    Ok(Json(UiChatResponse {
        ok: response.ok,
        text: response.reply.map(|reply| reply.text),
        error: response.error,
        provider,
        model,
    }))
}

pub(super) async fn image_handler(
    State(state): State<AppState>,
    Json(payload): Json<HttpAiImageRequest>,
) -> Result<Json<ai::ImageGenerationResponse>, crate::errors::AppError> {
    let ui_state = state.ui_state.get_ui_state().await.unwrap_or_default();
    let provider = resolve_image_provider(&ui_state, payload.provider.as_deref());
    let model = resolve_model(&ui_state, &provider, payload.model.as_deref(), "default");

    let request = ImageGenerationRequest {
        provider: provider.clone(),
        prompt: payload.prompt,
        original_prompt: payload.original_prompt,
        model,
        settings_key: payload
            .settings_key
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                ui_state
                    .selected_modules
                    .get("ai_image")
                    .map(|module| module.id.clone())
            })
            .or_else(|| Some(provider.clone())),
        session_id: payload
            .session_id
            .filter(|value| !value.trim().is_empty())
            .or_else(|| ui_state.ai_session_id.clone()),
        steps: payload.steps,
        cfg_scale: payload.cfg_scale,
        width: payload.width,
        height: payload.height,
        sampler: payload.sampler,
        seed: payload.seed,
        clip_skip: payload.clip_skip,
        negative_prompt: payload.negative_prompt,
        batch_size: payload.batch_size,
        scheduler: payload.scheduler,
    };

    let response = ai::ai_service::process_image_request(
        request,
        &state.sessions,
        &state.config,
        &state.engine_manager,
        &state.image_generation_state,
        &state.settings,
    )
    .await?;

    Ok(Json(response))
}
