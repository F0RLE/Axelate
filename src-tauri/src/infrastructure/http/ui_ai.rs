use super::AppState;
use super::ai_http::{
    HttpAiImageRequest, HttpAiMessage, is_local_provider, map_http_history,
    resolve_image_provider_strict, resolve_model, resolve_module_model,
    resolve_text_provider_strict, resolve_web_search_options,
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

struct ResolvedUiChatRequest {
    request: ChatRequest,
    provider: String,
    model: String,
}

struct ResolvedUiImageRequest {
    request: ImageGenerationRequest,
}

pub(super) async fn chat_handler(
    State(state): State<AppState>,
    Json(payload): Json<UiChatRequest>,
) -> Result<Json<UiChatResponse>, crate::errors::AppError> {
    let ui_state = state.ui_state.get_ui_state().await.unwrap_or_default();
    let resolved = resolve_ui_chat_request(&state, &ui_state, payload).await?;

    let response = ai::ai_service::process_chat_request(
        resolved.request,
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
        provider: resolved.provider,
        model: resolved.model,
    }))
}

pub(super) async fn image_handler(
    State(state): State<AppState>,
    Json(payload): Json<HttpAiImageRequest>,
) -> Result<Json<ai::ImageGenerationResponse>, crate::errors::AppError> {
    let ui_state = state.ui_state.get_ui_state().await.unwrap_or_default();
    let resolved = resolve_ui_image_request(&ui_state, payload)?;

    let response = ai::ai_service::process_image_request(
        resolved.request,
        &state.sessions,
        &state.config,
        &state.engine_manager,
        &state.image_generation_state,
        &state.settings,
    )
    .await?;

    Ok(Json(response))
}

async fn resolve_ui_chat_request(
    state: &AppState,
    ui_state: &crate::models::UIState,
    payload: UiChatRequest,
) -> Result<ResolvedUiChatRequest, crate::errors::AppError> {
    let provider = resolve_text_provider_strict(ui_state, payload.provider.as_deref())?;
    let model = resolve_module_model(ui_state, &state.config, &provider, payload.model.as_deref());
    let request = ChatRequest {
        provider: provider.clone(),
        model: model.clone(),
        messages: build_ui_chat_messages(payload.history, &payload.text),
        api_key: resolve_provider_api_key(&provider).await?,
        thinking_level: payload.thinking_level,
        max_tokens: payload.max_tokens,
        request_id: None,
        session_id: resolve_ui_session_id(ui_state, payload.session_id),
        web_search: resolve_web_search_options(ui_state, &provider),
    };

    Ok(ResolvedUiChatRequest {
        request,
        provider,
        model,
    })
}

fn build_ui_chat_messages(history: Option<Vec<HttpAiMessage>>, text: &str) -> Vec<ChatMessage> {
    let mut messages = map_http_history(history);
    messages.push(ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        role: "user".to_string(),
        content: serde_json::Value::String(text.trim().to_string()),
        thought_signature: None,
    });
    messages
}

async fn resolve_provider_api_key(
    provider: &str,
) -> Result<Option<String>, crate::errors::AppError> {
    if is_local_provider(provider) {
        return Ok(None);
    }

    SecureStorage::get_key_async("openrouter_api_key".to_string()).await
}

fn resolve_ui_session_id(
    ui_state: &crate::models::UIState,
    session_id: Option<String>,
) -> Option<String> {
    session_id
        .filter(|value| !value.trim().is_empty())
        .or_else(|| ui_state.ai_session_id.clone())
}

fn resolve_ui_image_request(
    ui_state: &crate::models::UIState,
    payload: HttpAiImageRequest,
) -> Result<ResolvedUiImageRequest, crate::errors::AppError> {
    let provider = resolve_image_provider_strict(ui_state, payload.provider.as_deref())?;
    let model = resolve_model(ui_state, &provider, payload.model.as_deref(), "default");
    let request = ImageGenerationRequest {
        provider: provider.clone(),
        prompt: payload.prompt,
        original_prompt: payload.original_prompt,
        model,
        settings_key: resolve_image_settings_key(ui_state, &provider, payload.settings_key),
        session_id: resolve_ui_session_id(ui_state, payload.session_id),
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

    Ok(ResolvedUiImageRequest { request })
}

fn resolve_image_settings_key(
    ui_state: &crate::models::UIState,
    provider: &str,
    settings_key: Option<String>,
) -> Option<String> {
    settings_key
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            ui_state
                .selected_modules
                .get("ai_image")
                .map(|module| module.id.clone())
        })
        .or_else(|| Some(provider.to_string()))
}
