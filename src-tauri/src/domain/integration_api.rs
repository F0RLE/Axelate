//! Local HTTP API exposed to trusted launcher integrations.
//!
//! The server is bound to loopback only and requires a per-process bearer token. Module
//! runtimes receive the base URL and token through environment variables.

use crate::domain::ai::ai_service;
use crate::domain::ai::types::{
    ChatMessage, ChatRequest, ChatResponse, ImageGenerationRequest, ImageGenerationResponse,
    WebSearchOptions,
};
use crate::domain::ai::{ChatSessionManager, ImageGenerationState};
use crate::domain::engine::manager::EngineManager;
use crate::domain::modules::controller::{self as module_controller, ModuleAction};
use crate::domain::system::config_service::ConfigService;
use crate::domain::system::ports::{LAUNCHER_LOCAL_PORT_RANGE, LocalPortPurpose};
use crate::errors::AppError;
use crate::infrastructure::config::settings::SettingsService;
use crate::infrastructure::config::ui_state::UiStateService;
use crate::models::{AiModel, ApiProvider, ModelTier, ModuleItem, ProviderType, SelectedModule};
use once_cell::sync::{Lazy, OnceCell};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:3000";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const CUSTOM_TEXT_PROVIDER_ID: &str = "openrouter-custom-text";
const CUSTOM_IMAGE_PROVIDER_ID: &str = "openrouter-custom-image";
const CUSTOM_TEXT_BACKEND_PROVIDER_ID: &str = "gpt";
const CUSTOM_IMAGE_BACKEND_PROVIDER_ID: &str = "gpt-image";

static API_BASE_URL: OnceCell<String> = OnceCell::new();
static API_TOKEN: Lazy<String> = Lazy::new(|| {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
});

/// Handle for the running launcher HTTP API server.
#[derive(Debug, Clone)]
pub struct LauncherHttpApiHandle {
    base_url: String,
}

impl LauncherHttpApiHandle {
    /// Returns the loopback base URL used by integration modules.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

/// Returns the local API base URL currently advertised to child modules.
pub fn api_base_url() -> &'static str {
    API_BASE_URL
        .get()
        .map_or(DEFAULT_API_BASE_URL, std::string::String::as_str)
}

/// Returns the bearer token required by the local integration API.
pub fn api_token() -> &'static str {
    &API_TOKEN
}

/// Adds local launcher API environment variables to a module process.
pub fn apply_process_env(command: &mut tokio::process::Command) {
    command
        .env("AXELATE_HTTP_API_BASE", api_base_url())
        .env("AXELATE_HTTP_API_TOKEN", api_token());
}

/// Starts the local launcher HTTP API server.
pub fn start_launcher_http_api(
    context: LauncherHttpApiContext,
) -> Result<LauncherHttpApiHandle, AppError> {
    let listener = bind_launcher_listener()?;
    let local_addr = listener
        .local_addr()
        .map_err(|error| AppError::Io(format!("Failed to read launcher API address: {error}")))?;
    let base_url = format!("http://{local_addr}");
    let _ = API_BASE_URL.set(base_url.clone());

    std::thread::Builder::new()
        .name("axelate-local-http-api".to_string())
        .spawn(move || serve_launcher_http_api(&listener, &context))
        .map_err(|error| AppError::Internal {
            request_id: None,
            message: format!("Failed to start launcher HTTP API thread: {error}"),
        })?;

    tracing::debug!("Launcher integration API listening at {base_url}");
    Ok(LauncherHttpApiHandle { base_url })
}

fn bind_launcher_listener() -> Result<TcpListener, AppError> {
    for port in LAUNCHER_LOCAL_PORT_RANGE {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok(listener);
        }
    }

    Err(AppError::Config(format!(
        "No free localhost port available for {:?} in range 3000-3099",
        LocalPortPurpose::LauncherHttp
    )))
}

/// Context shared by local integration API request handlers.
#[derive(Clone)]
pub struct LauncherHttpApiContext {
    app: AppHandle,
    sessions: Arc<ChatSessionManager>,
    config_service: Arc<ConfigService>,
    engine_manager: Arc<EngineManager>,
    image_generation_state: Arc<ImageGenerationState>,
    settings_service: SettingsService,
    ui_state_service: UiStateService,
}

impl std::fmt::Debug for LauncherHttpApiContext {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LauncherHttpApiContext")
            .field("app", &"<tauri app handle>")
            .field("sessions", &Arc::strong_count(&self.sessions))
            .field("config_service", &Arc::strong_count(&self.config_service))
            .field("engine_manager", &Arc::strong_count(&self.engine_manager))
            .field(
                "image_generation_state",
                &Arc::strong_count(&self.image_generation_state),
            )
            .field("settings_service", &"<settings service>")
            .field("ui_state_service", &"<ui state service>")
            .finish()
    }
}

impl LauncherHttpApiContext {
    /// Creates a new local API context.
    #[allow(clippy::too_many_arguments)]
    pub const fn new(
        app: AppHandle,
        sessions: Arc<ChatSessionManager>,
        config_service: Arc<ConfigService>,
        engine_manager: Arc<EngineManager>,
        image_generation_state: Arc<ImageGenerationState>,
        settings_service: SettingsService,
        ui_state_service: UiStateService,
    ) -> Self {
        Self {
            app,
            sessions,
            config_service,
            engine_manager,
            image_generation_state,
            settings_service,
            ui_state_service,
        }
    }
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug)]
struct HttpResponse {
    status: u16,
    body: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationTextRequest {
    prompt: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    session_id: Option<String>,
    messages: Option<Vec<ChatMessage>>,
    thinking_level: Option<String>,
    max_tokens: Option<u32>,
    request_id: Option<String>,
    web_search: Option<WebSearchOptions>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationImageRequest {
    prompt: String,
    provider: Option<String>,
    model: Option<String>,
    settings_key: Option<String>,
    session_id: Option<String>,
    steps: Option<u32>,
    cfg_scale: Option<f32>,
    denoising_strength: Option<f32>,
    width: Option<u32>,
    height: Option<u32>,
    sampler: Option<String>,
    seed: Option<i32>,
    clip_skip: Option<i32>,
    negative_prompt: Option<String>,
    batch_size: Option<u32>,
    scheduler: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationModuleStageRequest {
    stage: String,
    label: String,
    details: Option<serde_json::Value>,
    progress: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextApiResponse {
    ok: bool,
    provider: String,
    model: Option<String>,
    response: ChatResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageApiResponse {
    ok: bool,
    provider: String,
    model: String,
    response: ImageGenerationResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedModuleChangedEvent {
    category: String,
    module: SelectedModule,
    source: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModuleStageChangedEvent {
    module_id: String,
    stage: String,
    label: String,
    details: Option<serde_json::Value>,
    progress: Option<f32>,
    source: &'static str,
}

fn serve_launcher_http_api(listener: &TcpListener, context: &LauncherHttpApiContext) {
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let request_context = context.clone();
                if let Err(error) = std::thread::Builder::new()
                    .name("axelate-local-http-request".to_string())
                    .spawn(move || handle_stream(stream, request_context))
                {
                    tracing::warn!("Failed to spawn launcher HTTP API request handler: {error}");
                }
            }
            Err(error) => {
                tracing::warn!("Launcher HTTP API accept failed: {error}");
            }
        }
    }
}

fn handle_stream(mut stream: TcpStream, context: LauncherHttpApiContext) {
    let peer_addr = stream.peer_addr().ok();
    let response = match read_http_request(&mut stream) {
        Ok(request) => {
            tauri::async_runtime::block_on(dispatch_http_request(request, context, peer_addr))
        }
        Err(error) => HttpResponse {
            status: 400,
            body: json!({ "ok": false, "error": error }),
        },
    };

    if let Err(error) = write_http_response(&mut stream, &response) {
        tracing::warn!("Failed to write launcher HTTP API response: {error}");
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Failed to configure read timeout: {error}"))?;

    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("Failed to read request: {error}"))?;
        if read == 0 {
            return Err("HTTP request ended before headers completed".to_string());
        }
        let read_chunk = chunk
            .get(..read)
            .ok_or_else(|| "Internal HTTP read buffer range is invalid".to_string())?;
        buffer.extend_from_slice(read_chunk);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("HTTP request is too large".to_string());
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let header_bytes = buffer
        .get(..header_end)
        .ok_or_else(|| "Internal HTTP header range is invalid".to_string())?;
    let header_text = std::str::from_utf8(header_bytes)
        .map_err(|error| format!("Invalid HTTP header encoding: {error}"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "HTTP request line is missing".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "HTTP method is missing".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "HTTP path is missing".to_string())?
        .to_string();
    let version = request_parts
        .next()
        .ok_or_else(|| "HTTP version is missing".to_string())?;
    if request_parts.next().is_some() {
        return Err("HTTP request line has too many parts".to_string());
    }
    if !version.starts_with("HTTP/") {
        return Err(format!("Unsupported HTTP version: {version}"));
    }

    let headers = parse_header_lines(lines)?;
    let content_length = headers.get("content-length").map_or(Ok(0_usize), |value| {
        value
            .parse::<usize>()
            .map_err(|error| format!("Invalid content-length: {error}"))
    })?;
    if content_length > MAX_REQUEST_BYTES {
        return Err("HTTP request body is too large".to_string());
    }

    let body_start = header_end
        .checked_add(4)
        .ok_or_else(|| "Internal HTTP body offset overflowed".to_string())?;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    while body.len() < content_length {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("Failed to read request body: {error}"))?;
        if read == 0 {
            return Err(format!(
                "HTTP request body ended before content-length was reached: expected {content_length} bytes, got {}",
                body.len()
            ));
        }
        let read_chunk = chunk
            .get(..read)
            .ok_or_else(|| "Internal HTTP body buffer range is invalid".to_string())?;
        body.extend_from_slice(read_chunk);
        if body.len() > MAX_REQUEST_BYTES {
            return Err("HTTP request body is too large".to_string());
        }
    }
    body.truncate(content_length);

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_header_line(line: &str) -> Option<(String, String)> {
    let (name, value) = line.split_once(':')?;
    Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
}

fn parse_header_lines<'a>(
    lines: impl Iterator<Item = &'a str>,
) -> Result<HashMap<String, String>, String> {
    let mut headers = HashMap::new();

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        let Some((name, value)) = parse_header_line(line) else {
            return Err(format!("Malformed HTTP header line: {line}"));
        };

        if name.is_empty() {
            return Err("HTTP header name is empty".to_string());
        }

        if name == "content-length" && headers.contains_key("content-length") {
            return Err("Duplicate content-length header".to_string());
        }

        headers.insert(name, value);
    }

    Ok(headers)
}

async fn dispatch_http_request(
    request: HttpRequest,
    context: LauncherHttpApiContext,
    peer_addr: Option<SocketAddr>,
) -> HttpResponse {
    if !is_loopback_peer(peer_addr) {
        return json_error(403, "Launcher API only accepts loopback clients");
    }

    let path = request.path.split('?').next().unwrap_or(&request.path);
    if request.method == "GET" && path == "/v1/health" {
        return json_response(200, json!({ "ok": true, "service": "axelate-launcher" }));
    }

    if !is_authorized(&request.headers) {
        return json_error(401, "Missing or invalid launcher API token");
    }

    match route_authorized_request(path, &request, context).await {
        Ok(response) => response,
        Err(error) => json_error(status_for_app_error(&error), &error.to_string()),
    }
}

const fn status_for_app_error(error: &AppError) -> u16 {
    match error {
        AppError::Validation(_) | AppError::Config(_) => 400,
        AppError::NotFound(_) => 404,
        AppError::PermissionDenied(_) => 403,
        AppError::Io(_)
        | AppError::Serialization(_)
        | AppError::External { .. }
        | AppError::Internal { .. } => 500,
    }
}

async fn route_authorized_request(
    path: &str,
    request: &HttpRequest,
    context: LauncherHttpApiContext,
) -> Result<HttpResponse, AppError> {
    let segments = path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    match (request.method.as_str(), segments.as_slice()) {
        ("GET", ["v1", "modules"]) => {
            let modules = module_controller::get_all_modules().await;
            Ok(json_response(
                200,
                json!({ "ok": true, "modules": modules }),
            ))
        }
        ("GET", ["v1", "modules", module_id, "status"]) => {
            crate::domain::modules::downloader::validate_module_id(module_id)?;
            let status = module_controller::get_module_status(module_id).await;
            Ok(json_response(
                200,
                json!({ "ok": true, "moduleId": module_id, "status": status }),
            ))
        }
        ("POST", ["v1", "modules", module_id, "stage"]) => {
            handle_module_stage_request(request, &context, module_id)
        }
        ("POST", ["v1", "modules", module_id, action]) => {
            crate::domain::modules::downloader::validate_module_id(module_id)?;
            let action = parse_module_action(action)?;
            let response = module_controller::control(context.app, module_id, action).await?;
            Ok(json_response(
                200,
                json!({ "ok": response.success, "response": response }),
            ))
        }
        ("POST", ["v1", "ai", "text"]) => handle_text_request(request, context).await,
        ("POST", ["v1", "ai", "image"]) => handle_image_request(request, context).await,
        _ => Ok(json_error(404, "Unknown launcher API route")),
    }
}

fn handle_module_stage_request(
    request: &HttpRequest,
    context: &LauncherHttpApiContext,
    module_id: &str,
) -> Result<HttpResponse, AppError> {
    crate::domain::modules::downloader::validate_module_id(module_id)?;
    let payload: IntegrationModuleStageRequest = parse_json_body(request)?;
    let stage = payload.stage.trim();
    let label = payload.label.trim();
    if stage.is_empty() || label.is_empty() {
        return Ok(json_error(400, "Module stage and label are required"));
    }

    let progress = payload.progress.map(|value| value.clamp(0.0, 1.0));
    let event = ModuleStageChangedEvent {
        module_id: module_id.to_string(),
        stage: stage.to_string(),
        label: label.to_string(),
        details: payload.details,
        progress,
        source: "integration-api",
    };

    tracing::info!(
        module_id = %event.module_id,
        stage = %event.stage,
        label = %event.label,
        "Module integration stage changed"
    );

    if let Err(error) = context.app.emit("module-stage-changed", event.clone()) {
        tracing::warn!("Failed to emit module stage change: {error}");
    }

    Ok(json_response(
        200,
        json!({ "ok": true, "moduleId": module_id, "stage": event.stage }),
    ))
}

fn parse_module_action(action: &str) -> Result<ModuleAction, AppError> {
    match action {
        "start" => Ok(ModuleAction::Start),
        "stop" => Ok(ModuleAction::Stop),
        "restart" => Ok(ModuleAction::Restart),
        _ => Err(AppError::Validation(format!(
            "Unsupported module action: {action}"
        ))),
    }
}

async fn handle_text_request(
    request: &HttpRequest,
    context: LauncherHttpApiContext,
) -> Result<HttpResponse, AppError> {
    let payload: IntegrationTextRequest = parse_json_body(request)?;
    let prompt = payload.prompt.as_deref().unwrap_or("");
    let requested_provider = payload.provider.filter(|value| !value.trim().is_empty());
    let ui_provider = match requested_provider.as_ref() {
        Some(provider) => provider.clone(),
        None => selected_module_id(&context.ui_state_service, "ai_text")
            .await?
            .ok_or_else(|| AppError::Validation("No selected text AI provider".to_string()))?,
    };
    if requested_provider.is_some() {
        select_provider_for_category(&context, "ai_text", &ui_provider).await?;
    }
    let provider = backend_provider_id(&ui_provider).to_string();
    let model = resolve_model_id(
        &context.config_service,
        &context.ui_state_service,
        &provider,
        Some(&ui_provider),
        payload.model.as_deref(),
        "text",
    )
    .await?;
    let session_id =
        resolve_session_id(&context.ui_state_service, payload.session_id.as_deref()).await;
    let mut messages = payload.messages.unwrap_or_default();
    if messages.is_empty() && prompt.trim().is_empty() {
        return Err(AppError::Validation(
            "Text request requires a prompt or messages".to_string(),
        ));
    }
    if messages.is_empty() && !prompt.trim().is_empty() {
        messages.push(ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String(prompt.to_string()),
            thought_signature: None,
        });
    }

    let thinking_level = match payload.thinking_level {
        Some(value) => Some(value),
        None => selected_thinking_level(&context.ui_state_service, &ui_provider, &provider).await?,
    };
    let web_search = match payload.web_search {
        Some(value) => Some(value),
        None => selected_web_search(&context.ui_state_service, &ui_provider, &provider).await?,
    };

    let mut chat_request = ChatRequest {
        provider: provider.clone(),
        model,
        messages,
        api_key: None,
        thinking_level,
        max_tokens: payload.max_tokens,
        request_id: payload.request_id,
        session_id,
        web_search,
    };
    crate::api::ai::fill_chat_request_api_key(&mut chat_request, &context.config_service).await?;

    let response = ai_service::process_chat_request_non_stream(
        chat_request,
        &context.sessions,
        &context.config_service,
        &context.engine_manager,
        &context.settings_service,
    )
    .await?;

    Ok(json_response(
        200,
        json!(TextApiResponse {
            ok: response.ok,
            provider,
            model: response.model.clone(),
            response,
        }),
    ))
}

async fn handle_image_request(
    request: &HttpRequest,
    context: LauncherHttpApiContext,
) -> Result<HttpResponse, AppError> {
    let payload: IntegrationImageRequest = parse_json_body(request)?;
    if payload.prompt.trim().is_empty() {
        return Err(AppError::Validation(
            "Image request requires a prompt".to_string(),
        ));
    }
    let requested_provider = payload.provider.filter(|value| !value.trim().is_empty());
    let ui_provider = match requested_provider.as_ref() {
        Some(provider) => provider.clone(),
        None => selected_module_id(&context.ui_state_service, "ai_image")
            .await?
            .ok_or_else(|| AppError::Validation("No selected image AI provider".to_string()))?,
    };
    if requested_provider.is_some() {
        select_provider_for_category(&context, "ai_image", &ui_provider).await?;
    }
    let provider = backend_provider_id(&ui_provider).to_string();
    let model = resolve_model_id(
        &context.config_service,
        &context.ui_state_service,
        &provider,
        Some(&ui_provider),
        payload.model.as_deref(),
        "image",
    )
    .await?;
    let session_id =
        resolve_session_id(&context.ui_state_service, payload.session_id.as_deref()).await;
    let image_request = ImageGenerationRequest {
        provider: provider.clone(),
        prompt: payload.prompt.clone(),
        original_prompt: Some(payload.prompt),
        model: model.clone(),
        settings_key: payload.settings_key.or_else(|| Some(ui_provider.clone())),
        session_id,
        steps: payload.steps,
        cfg_scale: payload.cfg_scale,
        denoising_strength: payload.denoising_strength,
        width: payload.width,
        height: payload.height,
        sampler: payload.sampler,
        seed: payload.seed,
        clip_skip: payload.clip_skip,
        negative_prompt: payload.negative_prompt,
        batch_size: payload.batch_size,
        scheduler: payload.scheduler,
    };

    let response = ai_service::process_image_request(
        image_request,
        &context.sessions,
        &context.config_service,
        &context.engine_manager,
        &context.image_generation_state,
        &context.settings_service,
    )
    .await?;

    Ok(json_response(
        200,
        json!(ImageApiResponse {
            ok: response.ok,
            provider,
            model,
            response,
        }),
    ))
}

fn parse_json_body<T: for<'de> Deserialize<'de>>(request: &HttpRequest) -> Result<T, AppError> {
    serde_json::from_slice(&request.body)
        .map_err(|error| AppError::Validation(format!("Invalid JSON request body: {error}")))
}

async fn select_provider_for_category(
    context: &LauncherHttpApiContext,
    category: &str,
    provider_id: &str,
) -> Result<(), AppError> {
    let selected_module = resolve_selected_provider_module(&context.config_service, provider_id)?;
    let mut state = context.ui_state_service.get_ui_state().await?;
    let previous_id = state
        .selected_modules
        .get(category)
        .map(|module| module.id.as_str());

    if previous_id == Some(selected_module.id.as_str()) {
        return Ok(());
    }

    state
        .selected_modules
        .insert(category.to_string(), selected_module.clone());
    context.ui_state_service.save_ui_state(&state).await?;

    let payload = SelectedModuleChangedEvent {
        category: category.to_string(),
        module: selected_module,
        source: "integration-api",
    };
    if let Err(error) = context
        .app
        .emit("ui-state:selected-module-changed", payload)
    {
        tracing::warn!("Failed to emit selected module change: {error}");
    }

    Ok(())
}

fn resolve_selected_provider_module(
    config_service: &ConfigService,
    provider_id: &str,
) -> Result<SelectedModule, AppError> {
    let config = config_service.load_full_config()?;
    if let Some(module) = config
        .catalog
        .ai
        .iter()
        .chain(config.catalog.services.iter())
        .find(|module| module.id == provider_id)
    {
        return Ok(selected_module_from_catalog_item(module));
    }

    config
        .api_providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .map(selected_module_from_api_provider)
        .ok_or_else(|| AppError::Validation(format!("Unknown AI provider: {provider_id}")))
}

fn selected_module_from_catalog_item(module: &ModuleItem) -> SelectedModule {
    SelectedModule {
        id: module.id.clone(),
        name: module.name.clone(),
        name_key: Some(module.name_key.clone()).filter(|value| !value.trim().is_empty()),
        icon: module.icon.clone(),
        type_: module.type_name.clone(),
        desc_key: Some(module.desc_key.clone()).filter(|value| !value.trim().is_empty()),
        desc: module.desc.clone(),
    }
}

fn selected_module_from_api_provider(provider: &ApiProvider) -> SelectedModule {
    let type_ = match provider.provider_type {
        Some(ProviderType::Local) => "local",
        _ => "api",
    };

    SelectedModule {
        id: provider.id.clone(),
        name: provider.name.clone(),
        name_key: None,
        icon: provider.icon.clone().unwrap_or_else(|| "AI".to_string()),
        type_: type_.to_string(),
        desc_key: provider.desc_key.clone(),
        desc: provider.description.clone().unwrap_or_default(),
    }
}

fn backend_provider_id(provider_id: &str) -> &str {
    match provider_id {
        CUSTOM_TEXT_PROVIDER_ID => CUSTOM_TEXT_BACKEND_PROVIDER_ID,
        CUSTOM_IMAGE_PROVIDER_ID => CUSTOM_IMAGE_BACKEND_PROVIDER_ID,
        _ => provider_id,
    }
}

fn is_custom_provider_id(provider_id: &str) -> bool {
    matches!(
        provider_id,
        CUSTOM_TEXT_PROVIDER_ID | CUSTOM_IMAGE_PROVIDER_ID
    )
}

async fn selected_module_id(
    ui_state_service: &UiStateService,
    category: &str,
) -> Result<Option<String>, AppError> {
    let state = ui_state_service.get_ui_state().await?;
    Ok(state
        .selected_modules
        .get(category)
        .map(|module| module.id.trim().to_string())
        .filter(|value| !value.is_empty()))
}

async fn resolve_session_id(
    ui_state_service: &UiStateService,
    requested: Option<&str>,
) -> Option<String> {
    if let Some(session_id) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return Some(session_id.to_string());
    }

    ui_state_service
        .get_ui_state()
        .await
        .ok()
        .and_then(|state| state.ai_session_id)
        .filter(|value| !value.trim().is_empty())
}

async fn selected_thinking_level(
    ui_state_service: &UiStateService,
    primary_provider: &str,
    fallback_provider: &str,
) -> Result<Option<String>, AppError> {
    let state = ui_state_service.get_ui_state().await?;
    Ok(state
        .ai_thinking_level
        .get(primary_provider)
        .or_else(|| state.ai_thinking_level.get(fallback_provider))
        .cloned()
        .filter(|value| !value.trim().is_empty()))
}

async fn selected_web_search(
    ui_state_service: &UiStateService,
    primary_provider: &str,
    fallback_provider: &str,
) -> Result<Option<WebSearchOptions>, AppError> {
    let state = ui_state_service.get_ui_state().await?;
    let enabled = state
        .ai_web_search_enabled
        .get(primary_provider)
        .or_else(|| state.ai_web_search_enabled.get(fallback_provider))
        .copied()
        .unwrap_or(false);

    Ok(enabled.then_some(WebSearchOptions {
        enabled,
        ..WebSearchOptions::default()
    }))
}

async fn resolve_model_id(
    config_service: &ConfigService,
    ui_state_service: &UiStateService,
    provider_id: &str,
    ui_provider_id: Option<&str>,
    requested_model: Option<&str>,
    capability: &str,
) -> Result<String, AppError> {
    if let Some(model) = requested_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(model.to_string());
    }

    let state = ui_state_service.get_ui_state().await?;
    let selected_model = {
        ui_provider_id
            .and_then(|id| state.selected_ai_models.get(id))
            .or_else(|| state.selected_ai_models.get(provider_id))
            .cloned()
    };
    let config = config_service.load_full_config()?;
    let provider = config
        .api_providers
        .iter()
        .find(|candidate| candidate.id == provider_id);

    if let Some(model) = selected_model
        .as_deref()
        .and_then(|model_id| resolve_provider_model(provider, model_id, capability))
    {
        return Ok(model);
    }

    if ui_provider_id.is_some_and(is_custom_provider_id)
        && let Some(model) = selected_model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    {
        return Ok(model.to_string());
    }

    if let Some(model) =
        provider.and_then(|provider| strongest_provider_model(provider, capability))
    {
        return Ok(model);
    }

    Ok("default".to_string())
}

fn resolve_provider_model(
    provider: Option<&ApiProvider>,
    model_id: &str,
    capability: &str,
) -> Option<String> {
    let models = provider?.models.as_ref()?;
    let model = models.iter().find(|candidate| candidate.id == model_id)?;
    model_api_id(model, capability).or_else(|| Some(model.id.clone()))
}

fn strongest_provider_model(provider: &ApiProvider, capability: &str) -> Option<String> {
    let models = provider.models.as_ref()?;
    models
        .iter()
        .filter(|model| model.deprecated != Some(true))
        .max_by_key(|model| {
            (
                tier_rank(&model.tier),
                u16::from(model.stats.logic) + u16::from(model.stats.creative),
                model.stats.speed,
            )
        })
        .and_then(|model| model_api_id(model, capability).or_else(|| Some(model.id.clone())))
}

fn model_api_id(model: &AiModel, capability: &str) -> Option<String> {
    let api_models = model.api_models.as_ref()?;
    match capability {
        "image" => api_models.image.clone().or_else(|| api_models.text.clone()),
        _ => api_models.text.clone(),
    }
    .filter(|value| !value.trim().is_empty())
}

const fn tier_rank(tier: &ModelTier) -> u8 {
    match tier {
        ModelTier::Weak => 0,
        ModelTier::Medium => 1,
        ModelTier::Strong => 2,
    }
}

fn is_loopback_peer(peer_addr: Option<SocketAddr>) -> bool {
    peer_addr.is_some_and(|addr| addr.ip().is_loopback())
}

fn is_authorized(headers: &HashMap<String, String>) -> bool {
    headers
        .get("authorization")
        .is_some_and(|value| is_authorized_bearer(value))
        || headers
            .get("x-axelate-token")
            .is_some_and(|value| value.trim() == api_token())
}

fn is_authorized_bearer(value: &str) -> bool {
    let mut parts = value.split_whitespace();
    let Some(scheme) = parts.next() else {
        return false;
    };
    let Some(token) = parts.next() else {
        return false;
    };

    parts.next().is_none() && scheme.eq_ignore_ascii_case("bearer") && token == api_token()
}

const fn json_response(status: u16, body: serde_json::Value) -> HttpResponse {
    HttpResponse { status, body }
}

fn json_error(status: u16, error: &str) -> HttpResponse {
    HttpResponse {
        status,
        body: json!({ "ok": false, "error": error }),
    }
}

fn write_http_response(
    stream: &mut TcpStream,
    response: &HttpResponse,
) -> Result<(), std::io::Error> {
    let body = serde_json::to_vec(&response.body)?;
    let status_text = status_text(response.status);
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        status_text,
        body.len()
    )?;
    stream.write_all(&body)?;
    stream.flush()
}

const fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{
        IntegrationTextRequest, backend_provider_id, find_header_end, is_authorized,
        is_loopback_peer, json_error, json_response, model_api_id, parse_header_line,
        parse_header_lines, parse_json_body, parse_module_action, read_http_request,
        selected_module_from_api_provider, selected_module_from_catalog_item, status_for_app_error,
        status_text, tier_rank,
    };
    use crate::domain::modules::controller::ModuleAction;
    use crate::errors::AppError;
    use crate::models::{
        AiModel, ApiModelConfig, ModelStats, ModelTier, ModuleItem, ProviderType, SelectedModule,
    };
    use std::collections::HashMap;
    use std::io::Write;
    use std::net::{Shutdown, TcpListener, TcpStream};

    fn model_with_api_ids() -> AiModel {
        AiModel {
            id: "ui-model".to_string(),
            desc_key: String::new(),
            name: "Model".to_string(),
            desc: String::new(),
            tier: ModelTier::Strong,
            model_size: None,
            release_date: None,
            context_window: None,
            max_output_tokens: None,
            deprecated: None,
            pricing: None,
            stats: ModelStats {
                speed: 1,
                logic: 2,
                creative: 3,
            },
            capabilities: None,
            api_models: Some(ApiModelConfig {
                text: Some("api-text".to_string()),
                image: Some("api-image".to_string()),
            }),
        }
    }

    #[test]
    fn parses_http_header_lines_case_insensitively() {
        let (key, value) = parse_header_line("Authorization: Bearer abc").expect("header");
        assert_eq!(key, "authorization");
        assert_eq!(value, "Bearer abc");
    }

    #[test]
    fn rejects_malformed_http_header_lines() {
        let error = parse_header_lines(["Host: localhost", "broken header"].into_iter())
            .expect_err("malformed header must fail");

        assert!(error.contains("Malformed HTTP header line"));
    }

    #[test]
    fn rejects_duplicate_content_length_headers() {
        let error = parse_header_lines(["Content-Length: 1", "content-length: 2"].into_iter())
            .expect_err("duplicate content-length must fail");

        assert_eq!(error, "Duplicate content-length header");
    }

    #[test]
    fn finds_standard_http_header_separator() {
        assert_eq!(find_header_end(b"GET / HTTP/1.1\r\n\r\n"), Some(14));
    }

    #[test]
    fn authorization_accepts_bearer_or_header_token() {
        let mut headers = HashMap::new();
        headers.insert(
            "authorization".to_string(),
            format!("Bearer {}", super::api_token()),
        );
        assert!(is_authorized(&headers));

        headers.insert(
            "authorization".to_string(),
            format!("bearer {}", super::api_token()),
        );
        assert!(is_authorized(&headers));

        headers.clear();
        headers.insert(
            "x-axelate-token".to_string(),
            super::api_token().to_string(),
        );
        assert!(is_authorized(&headers));
    }

    #[test]
    fn authorization_rejects_malformed_bearer_values() {
        let mut headers = HashMap::new();
        headers.insert(
            "authorization".to_string(),
            format!("Bearer {} extra", super::api_token()),
        );
        assert!(!is_authorized(&headers));

        headers.insert(
            "authorization".to_string(),
            format!("Token {}", super::api_token()),
        );
        assert!(!is_authorized(&headers));
    }

    #[test]
    fn maps_ui_model_id_to_capability_api_model() {
        let model = model_with_api_ids();
        assert_eq!(model_api_id(&model, "text").as_deref(), Some("api-text"));
        assert_eq!(model_api_id(&model, "image").as_deref(), Some("api-image"));
    }

    #[test]
    fn maps_custom_ui_provider_ids_to_backend_providers() {
        assert_eq!(backend_provider_id("openrouter-custom-text"), "gpt");
        assert_eq!(backend_provider_id("openrouter-custom-image"), "gpt-image");
        assert_eq!(backend_provider_id("llamacpp"), "llamacpp");
    }

    #[test]
    fn parses_text_request_without_prompt_when_messages_are_present() {
        let request = super::HttpRequest {
            method: "POST".to_string(),
            path: "/v1/ai/text".to_string(),
            headers: HashMap::new(),
            body: br#"{"messages":[{"id":"m1","role":"user","content":"hello"}]}"#.to_vec(),
        };

        let payload: IntegrationTextRequest = parse_json_body(&request).expect("payload");

        assert!(payload.prompt.is_none());
        assert_eq!(payload.messages.expect("messages").len(), 1);
    }

    #[test]
    fn ranks_model_tiers_for_default_selection() {
        assert!(tier_rank(&ModelTier::Strong) > tier_rank(&ModelTier::Medium));
        assert_eq!(status_text(404), "Not Found");
    }

    #[test]
    fn module_action_parser_accepts_integration_routes_only() {
        assert_eq!(
            parse_module_action("start").expect("start"),
            ModuleAction::Start
        );
        assert_eq!(
            parse_module_action("stop").expect("stop"),
            ModuleAction::Stop
        );
        assert_eq!(
            parse_module_action("restart").expect("restart"),
            ModuleAction::Restart
        );
        assert!(matches!(
            parse_module_action("install"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn loopback_guard_rejects_missing_or_remote_peers() {
        assert!(is_loopback_peer(Some(
            "127.0.0.1:3000".parse().expect("loopback socket")
        )));
        assert!(is_loopback_peer(Some(
            "[::1]:3000".parse().expect("ipv6 loopback socket")
        )));
        assert!(!is_loopback_peer(None));
        assert!(!is_loopback_peer(Some(
            "192.168.1.10:3000".parse().expect("remote socket")
        )));
    }

    #[test]
    fn json_response_helpers_preserve_status_and_error_shape() {
        let ok = json_response(200, serde_json::json!({ "ok": true }));
        let error = json_error(401, "denied");

        assert_eq!(ok.status, 200);
        assert_eq!(
            ok.body.get("ok").and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(error.status, 401);
        assert_eq!(
            error.body.get("error").and_then(serde_json::Value::as_str),
            Some("denied")
        );
    }

    #[test]
    fn selected_module_from_catalog_preserves_localized_metadata() {
        let module = ModuleItem {
            id: "llamacpp".to_string(),
            name_key: "ui.module.llamacpp".to_string(),
            desc_key: "ui.module.llamacpp.desc".to_string(),
            name: "llama.cpp".to_string(),
            desc: "Local text engine".to_string(),
            icon: "cpu".to_string(),
            preview: None,
            type_name: "local".to_string(),
            dl_type: None,
            capabilities: vec!["text".to_string()],
            binary: Some("llama-server".to_string()),
            repo_url: None,
            expected_hash: None,
            coming_soon: false,
            managed_externally: false,
            version: "1.0.0".to_string(),
            installed: true,
            raw_config_schema: None,
            config_schema: None,
        };

        let selected = selected_module_from_catalog_item(&module);

        assert_eq!(selected.id, "llamacpp");
        assert_eq!(selected.name_key.as_deref(), Some("ui.module.llamacpp"));
        assert_eq!(
            selected.desc_key.as_deref(),
            Some("ui.module.llamacpp.desc")
        );
        assert_eq!(selected.type_, "local");
    }

    #[test]
    fn selected_module_from_api_provider_maps_provider_type() {
        let provider = crate::models::ApiProvider {
            id: "cloud".to_string(),
            name: "Cloud".to_string(),
            desc_key: Some("ui.module.cloud.desc".to_string()),
            description: Some("Cloud provider".to_string()),
            icon: Some("cloud".to_string()),
            provider_type: Some(ProviderType::Openai),
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key_env: None,
            models: None,
            capabilities: None,
            model_aliases: None,
        };
        let local = crate::models::ApiProvider {
            provider_type: Some(ProviderType::Local),
            ..provider.clone()
        };

        let selected_cloud: SelectedModule = selected_module_from_api_provider(&provider);
        let selected_local = selected_module_from_api_provider(&local);

        assert_eq!(selected_cloud.type_, "api");
        assert_eq!(selected_cloud.desc, "Cloud provider");
        assert_eq!(selected_local.type_, "local");
    }

    #[test]
    fn maps_app_errors_to_http_status_codes() {
        assert_eq!(
            status_for_app_error(&AppError::Validation("bad input".to_string())),
            400
        );
        assert_eq!(
            status_for_app_error(&AppError::NotFound("missing".to_string())),
            404
        );
        assert_eq!(
            status_for_app_error(&AppError::PermissionDenied("denied".to_string())),
            403
        );
        assert_eq!(status_for_app_error(&AppError::Io("disk".to_string())), 500);
    }

    #[test]
    fn rejects_http_body_larger_than_limit_before_waiting_for_body() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let addr = listener.local_addr().expect("local addr");
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).expect("connect test listener");
            write!(
                stream,
                "POST /v1/ai/text HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
                super::MAX_REQUEST_BYTES + 1
            )
            .expect("write request");
        });

        let (mut stream, _) = listener.accept().expect("accept test client");
        let error = read_http_request(&mut stream).expect_err("oversized body must fail");
        client.join().expect("client thread");

        assert_eq!(error, "HTTP request body is too large");
    }

    #[test]
    fn rejects_http_body_shorter_than_content_length() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let addr = listener.local_addr().expect("local addr");
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).expect("connect test listener");
            stream
                .write_all(b"POST /v1/ai/text HTTP/1.1\r\nContent-Length: 8\r\n\r\nabc")
                .expect("write request");
            stream.shutdown(Shutdown::Write).expect("shutdown write");
        });

        let (mut stream, _) = listener.accept().expect("accept test client");
        let error = read_http_request(&mut stream).expect_err("truncated body must fail");
        client.join().expect("client thread");

        assert!(error.contains("expected 8 bytes, got 3"));
    }

    #[test]
    fn rejects_malformed_http_request_line() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let addr = listener.local_addr().expect("local addr");
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).expect("connect test listener");
            stream
                .write_all(b"GET /v1/health HTTP/1.1 extra\r\n\r\n")
                .expect("write request");
            stream.shutdown(Shutdown::Write).expect("shutdown write");
        });

        let (mut stream, _) = listener.accept().expect("accept test client");
        let error = read_http_request(&mut stream).expect_err("bad request line must fail");
        client.join().expect("client thread");

        assert_eq!(error, "HTTP request line has too many parts");
    }
}
