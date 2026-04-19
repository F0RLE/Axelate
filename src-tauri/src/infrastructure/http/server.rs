#[path = "ai_http.rs"]
mod ai_http;
#[path = "module_ai.rs"]
mod module_ai;
#[path = "ui_ai.rs"]
mod ui_ai;

use crate::domain::{
    modules::controller as module_controller,
    monitoring::system_monitor::SystemMonitorService,
    system::hardware_probe::{merge_probe_with_runtime_stats, probe_gpu_info},
};
use crate::errors::AppError;
use crate::infrastructure::config::ui_state::UiStateService;
use crate::infrastructure::logging;
use crate::models::{
    SystemStats,
    modules::{ConfigField, Module},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tower_http::cors::CorsLayer;

static LOCAL_SERVER_ADDR: std::sync::OnceLock<SocketAddr> = std::sync::OnceLock::new();
const ALLOWED_LOCAL_ORIGINS: [&str; 3] = [
    "tauri://localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
];

#[derive(Clone)]
pub(super) struct AppState {
    config: Arc<crate::domain::system::config_service::ConfigService>,
    settings: crate::infrastructure::config::settings::SettingsService,
    monitor: Arc<SystemMonitorService>,
    sessions: Arc<crate::domain::ai::session::ChatSessionManager>,
    engine_manager: Arc<crate::domain::engine::manager::EngineManager>,
    image_generation_state: Arc<crate::domain::ai::ImageGenerationState>,
    ui_state: UiStateService,
}

struct SettingsUiLocation {
    root: PathBuf,
    entry: PathBuf,
}

struct SettingsUiAssetPath {
    target: PathBuf,
}

/// Returns the current local HTTP server base URL when available.
pub fn get_local_server_base_url() -> Option<String> {
    LOCAL_SERVER_ADDR
        .get()
        .map(|address| format!("http://{address}"))
}

/// Starts the HTTP API server on port 3000 for local access
pub fn start_server(
    app: &AppHandle,
    settings_service: crate::infrastructure::config::settings::SettingsService,
) {
    let state = build_app_state(app, settings_service);

    tauri::async_runtime::spawn(async move {
        let app = build_http_router(state);

        match bind_local_listener().await {
            Ok(listener) => {
                let addr = listener
                    .local_addr()
                    .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], 0)));
                let _ = LOCAL_SERVER_ADDR.set(addr);
                tracing::debug!("[Server] HTTP Server listening on http://{addr}");
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::error!("[Server] Fatal error serving HTTP: {e}");
                }
            }
            Err(e) => {
                tracing::error!("[Server] Failed to bind local HTTP server: {e}");
            }
        }
    });
}

fn build_app_state(
    app: &AppHandle,
    settings_service: crate::infrastructure::config::settings::SettingsService,
) -> AppState {
    AppState {
        monitor: Arc::clone(app.state::<Arc<SystemMonitorService>>().inner()),
        config: Arc::clone(
            app.state::<Arc<crate::domain::system::config_service::ConfigService>>()
                .inner(),
        ),
        settings: settings_service,
        sessions: Arc::clone(
            app.state::<Arc<crate::domain::ai::session::ChatSessionManager>>()
                .inner(),
        ),
        engine_manager: Arc::clone(
            app.state::<Arc<crate::domain::engine::manager::EngineManager>>()
                .inner(),
        ),
        image_generation_state: Arc::clone(
            app.state::<Arc<crate::domain::ai::ImageGenerationState>>()
                .inner(),
        ),
        ui_state: app.state::<UiStateService>().inner().clone(),
    }
}

fn build_http_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/stats", get(stats_handler))
        .route("/api/monitoring/stats", get(stats_handler))
        .route("/api/logs", get(get_logs_handler))
        .route("/api/logs/clear", post(clear_logs_handler))
        .route("/api/modules", get(get_modules_handler))
        .route(
            "/api/modules/{module_id}/settings-ui",
            get(module_settings_ui_index_handler),
        )
        .route(
            "/api/modules/{module_id}/settings-ui/{*asset_path}",
            get(module_settings_ui_asset_handler),
        )
        .route("/api/translations", get(translations_handler))
        .route("/api/gpu/info", get(gpu_info_handler))
        .route("/api/settings", get(get_settings_handler))
        .route("/api/settings/save", post(save_setting_handler))
        .route("/api/config", get(get_config_handler))
        .route("/api/system/language", get(system_language_handler))
        .route("/api/ai/chat", post(ui_ai::chat_handler))
        .route("/api/ai/image", post(ui_ai::image_handler))
        .route("/api/modules/ai/text", post(module_ai::text_handler))
        .route("/api/modules/ai/image", post(module_ai::image_handler))
        .layer(build_cors_layer())
        .with_state(state)
}

fn build_cors_layer() -> CorsLayer {
    let mut cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([HeaderName::from_static("content-type")]);

    for origin in ALLOWED_LOCAL_ORIGINS {
        if let Ok(parsed) = origin.parse::<HeaderValue>() {
            cors = cors.allow_origin(parsed);
        }
    }

    cors
}

async fn bind_local_listener() -> std::io::Result<tokio::net::TcpListener> {
    let preferred = SocketAddr::from(([127, 0, 0, 1], 3000));
    match tokio::net::TcpListener::bind(preferred).await {
        Ok(listener) => Ok(listener),
        Err(error) => {
            tracing::warn!(
                "[Server] Failed to bind preferred port 3000: {error}. Falling back to an ephemeral localhost port."
            );
            tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await
        }
    }
}

// Handlers

async fn health_handler() -> Json<Value> {
    tracing::debug!("[Server] Health check requested");
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

async fn stats_handler(State(state): State<AppState>) -> Json<SystemStats> {
    // No logging here to prevent spamming logs every second
    let snapshot = state.monitor.get_stats().await;
    Json(snapshot)
}

// --- Web Support Handlers ---

use axum::extract::Query;

#[derive(serde::Deserialize)]
struct LangQuery {
    lang: Option<String>,
}

#[derive(serde::Deserialize)]
struct LogsQuery {
    since: Option<f64>,
}

async fn translations_handler(
    Query(params): Query<LangQuery>,
) -> Result<Json<Value>, crate::errors::AppError> {
    let lang = params.lang.unwrap_or_else(|| "en".to_string());

    if !lang
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(crate::errors::AppError::Validation(
            "Invalid characters in lang".to_string(),
        ));
    }

    tracing::debug!("[Server] Translations requested for {lang}");

    let mut locale_path = crate::utils::paths::RESOURCES_DIR.join("locales");
    locale_path.push(format!("{lang}.json"));

    if !locale_path.exists() {
        return Err(crate::errors::AppError::NotFound(format!(
            "Locale {lang} not found"
        )));
    }

    let content = tokio::fs::read_to_string(&locale_path).await?;
    let json = serde_json::from_str::<Value>(&content)?;
    Ok(Json(json))
}

async fn get_logs_handler(Query(query): Query<LogsQuery>) -> Json<Value> {
    Json(json!(logging::logger::get_frontend_logs_since(
        query.since.unwrap_or(0.0)
    )))
}

async fn clear_logs_handler() -> Json<Value> {
    logging::logger::clear_logs();
    Json(json!({ "success": true }))
}

#[allow(
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss
)]
async fn gpu_info_handler(State(state): State<AppState>) -> Json<Value> {
    let snapshot = state.monitor.get_stats().await;
    let probe = merge_probe_with_runtime_stats(probe_gpu_info().await, snapshot.gpu.as_ref());

    Json(json!({
        "detected": probe.detected,
        "name": probe.name,
        "cuda": probe.cuda,
        "backend": probe.backend,
        "memory": probe.memory
    }))
}

// Reuse infrastructure settings instead of duplicate persistence
use crate::infrastructure::config::settings as infra_settings;

async fn get_settings_handler(State(state): State<AppState>) -> Json<Value> {
    match state.settings.get_settings().await {
        Ok(settings) => Json(serde_json::to_value(settings).unwrap_or_else(|_| json!({}))),
        Err(e) => {
            tracing::error!("[Server] Failed to load settings: {e}");
            Json(json!({}))
        }
    }
}

#[derive(serde::Deserialize)]
struct SaveSettingRequest {
    key: String,
    value: String,
}

fn is_allowed_public_setting_key(key: &str) -> bool {
    matches!(key.trim().to_ascii_uppercase().as_str(), "LANGUAGE")
}

fn is_password_config_field(field: &ConfigField) -> bool {
    field.field_type.trim().eq_ignore_ascii_case("password")
}

fn sanitize_public_module(module: Module) -> Value {
    let password_keys: HashSet<String> = module
        .config_schema
        .as_ref()
        .map(|schema| {
            schema
                .iter()
                .filter_map(|(key, field)| is_password_config_field(field).then_some(key.clone()))
                .collect()
        })
        .unwrap_or_default();

    let sanitized_config: HashMap<String, Value> = module
        .config
        .into_iter()
        .filter(|(key, _)| !password_keys.contains(key))
        .collect();

    let sanitized_schema = module.config_schema.map(|schema| {
        schema
            .into_iter()
            .map(|(key, mut field)| {
                if is_password_config_field(&field) {
                    field.default = None;
                }
                (key, field)
            })
            .collect::<HashMap<_, _>>()
    });

    json!({
        "id": module.id,
        "name": module.name,
        "description": module.description,
        "version": module.version,
        "author": module.author,
        "category": module.category,
        "icon": module.icon,
        "installed": module.installed,
        "local": module.local,
        "enabled": module.enabled,
        "status": module.status,
        "isDeletable": module.is_deletable,
        "config": sanitized_config,
        "configSchema": sanitized_schema,
        "settingsUi": module.settings_ui,
    })
}

async fn save_setting_handler(
    State(state): State<AppState>,
    Json(payload): Json<SaveSettingRequest>,
) -> Json<Value> {
    tracing::info!("[Server] Save setting requested: {}", payload.key);

    if !is_allowed_public_setting_key(&payload.key) {
        return Json(json!({
            "success": false,
            "message": "Setting is not allowed through the public HTTP API"
        }));
    }

    match state
        .settings
        .save_setting(&payload.key, &payload.value)
        .await
    {
        Ok(()) => Json(json!({ "success": true })),
        Err(e) => {
            tracing::error!("[Server] Failed to save setting: {e}");
            Json(json!({ "success": false, "message": e.to_string() }))
        }
    }
}

async fn get_modules_handler() -> Json<Value> {
    let modules = module_controller::get_all_modules().await;
    let public_modules: Vec<Value> = modules.into_iter().map(sanitize_public_module).collect();
    Json(Value::Array(public_modules))
}

async fn module_settings_ui_index_handler(
    AxumPath(module_id): AxumPath<String>,
) -> Result<Response, AppError> {
    crate::domain::modules::downloader::validate_module_id(&module_id)?;
    Ok(
        Redirect::temporary(&format!("/api/modules/{module_id}/settings-ui/index.html"))
            .into_response(),
    )
}

async fn module_settings_ui_asset_handler(
    AxumPath((module_id, asset_path)): AxumPath<(String, String)>,
) -> Result<Response, AppError> {
    serve_module_settings_ui_asset(&module_id, Some(asset_path)).await
}

async fn serve_module_settings_ui_asset(
    module_id: &str,
    asset_path: Option<String>,
) -> Result<Response, AppError> {
    crate::domain::modules::downloader::validate_module_id(module_id)?;

    let module_root = crate::domain::modules::downloader::get_module_path(module_id);
    let manifest = crate::domain::modules::lifecycle::ManifestLoader::load(&module_root)?;
    let settings_ui = manifest.settings_ui.ok_or_else(|| {
        AppError::NotFound(format!(
            "Module {module_id} does not expose a custom settings UI"
        ))
    })?;

    let settings_location = resolve_settings_ui_location(&module_root, &settings_ui).await?;
    let asset = resolve_settings_ui_asset_path(&settings_location, asset_path.as_deref()).await?;

    let body = tokio::fs::read(&asset.target)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;

    let mime = guess_content_type(&asset.target);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .map_err(|error| AppError::Internal {
            request_id: None,
            message: error.to_string(),
        })
}

#[cfg_attr(not(test), allow(dead_code))]
async fn resolve_settings_ui_root(
    module_root: &Path,
    settings_ui: &str,
) -> Result<(PathBuf, PathBuf), AppError> {
    let location = resolve_settings_ui_location(module_root, settings_ui).await?;
    Ok((location.root, location.entry))
}

async fn resolve_settings_ui_location(
    module_root: &Path,
    settings_ui: &str,
) -> Result<SettingsUiLocation, AppError> {
    let canonical_module_root = tokio::fs::canonicalize(module_root)
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;
    let requested_path = validate_relative_module_asset(settings_ui)?;
    let configured_path = tokio::fs::canonicalize(module_root.join(&requested_path))
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    if !configured_path.starts_with(&canonical_module_root) {
        return Err(AppError::PermissionDenied(
            "settings_ui must stay inside the module directory".to_string(),
        ));
    }

    let metadata = tokio::fs::metadata(&configured_path)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;

    let (root, entry) = if metadata.is_dir() {
        let entry = configured_path.join("index.html");
        (configured_path, entry)
    } else {
        let root = configured_path.parent().ok_or_else(|| {
            AppError::Validation("settings_ui file must have a parent directory".to_string())
        })?;
        (root.to_path_buf(), configured_path)
    };

    let entry = tokio::fs::canonicalize(&entry)
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    if !entry.starts_with(&root) {
        return Err(AppError::PermissionDenied(
            "settings_ui entry must stay inside its root directory".to_string(),
        ));
    }

    let canonical_root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    Ok(SettingsUiLocation {
        root: canonical_root,
        entry,
    })
}

async fn resolve_settings_ui_asset_path(
    settings_location: &SettingsUiLocation,
    asset_path: Option<&str>,
) -> Result<SettingsUiAssetPath, AppError> {
    match asset_path {
        Some(path) if !path.trim().is_empty() => {
            resolve_settings_ui_asset_inside_root(&settings_location.root, path).await
        }
        _ => Ok(SettingsUiAssetPath {
            target: settings_location.entry.clone(),
        }),
    }
}

async fn resolve_settings_ui_asset_inside_root(
    settings_root: &Path,
    asset_path: &str,
) -> Result<SettingsUiAssetPath, AppError> {
    let relative_path = validate_relative_module_asset(asset_path)?;
    let resolved = tokio::fs::canonicalize(settings_root.join(relative_path))
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    if !resolved.starts_with(settings_root) {
        return Err(AppError::PermissionDenied(
            "Requested settings asset is outside the module settings root".to_string(),
        ));
    }

    Ok(SettingsUiAssetPath { target: resolved })
}

fn validate_relative_module_asset(raw_path: &str) -> Result<PathBuf, AppError> {
    let trimmed = raw_path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "settings_ui path cannot be empty".to_string(),
        ));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Err(AppError::Validation(
            "settings_ui path must be relative".to_string(),
        ));
    }

    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(AppError::Validation(
            "settings_ui path contains forbidden segments".to_string(),
        ));
    }

    Ok(path)
}

fn guess_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

async fn system_language_handler() -> Json<Value> {
    let lang = infra_settings::get_language_sync();
    Json(json!({ "language": lang }))
}

async fn get_config_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, crate::errors::AppError> {
    use crate::domain::modules::downloader;

    let mut config = state.config.load_full_config()?;

    // Populate installed status
    for module in &mut config.catalog.ai {
        module.installed = downloader::is_module_installed(&module.id);
    }
    for module in &mut config.catalog.services {
        module.installed = downloader::is_module_installed(&module.id);
    }

    Ok(Json(serde_json::to_value(config)?))
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::indexing_slicing)]
mod tests {
    use super::{
        LogsQuery, clear_logs_handler, get_logs_handler, resolve_settings_ui_root,
        sanitize_public_module,
    };
    use crate::models::modules::{ConfigField, Module};
    use axum::extract::Query;
    use serde_json::json;
    use std::collections::HashMap;
    use std::fs;

    #[test]
    fn sanitize_public_module_redacts_password_values_and_defaults() {
        let mut config = HashMap::new();
        config.insert("api_key".to_string(), json!("super-secret"));
        config.insert("endpoint".to_string(), json!("http://localhost"));

        let mut schema = HashMap::new();
        schema.insert(
            "api_key".to_string(),
            ConfigField {
                field_type: "password".to_string(),
                label: "API key".to_string(),
                description: None,
                placeholder: None,
                default: Some(json!("seed-value")),
                required: true,
                min: None,
                max: None,
                step: None,
                rows: None,
                section: None,
                order: None,
                options: None,
            },
        );
        schema.insert(
            "endpoint".to_string(),
            ConfigField {
                field_type: "text".to_string(),
                label: "Endpoint".to_string(),
                description: None,
                placeholder: None,
                default: Some(json!("http://localhost")),
                required: true,
                min: None,
                max: None,
                step: None,
                rows: None,
                section: None,
                order: None,
                options: None,
            },
        );

        let module = Module {
            id: "demo".to_string(),
            name: "Demo".to_string(),
            description: String::new(),
            version: "1.0.0".to_string(),
            author: String::new(),
            category: "service".to_string(),
            icon: String::new(),
            path: "C:/demo".to_string(),
            installed: true,
            local: true,
            enabled: true,
            status: Some("running".to_string()),
            is_deletable: true,
            config,
            config_schema: Some(schema),
            settings_ui: None,
        };

        let value = sanitize_public_module(module);
        let config = value["config"].as_object().expect("config object");
        let schema = value["configSchema"]
            .as_object()
            .expect("config schema object");

        assert!(!config.contains_key("api_key"));
        assert_eq!(config.get("endpoint"), Some(&json!("http://localhost")));
        assert!(schema["api_key"]["default"].is_null());
        assert_eq!(schema["endpoint"]["default"], json!("http://localhost"));
    }

    #[tokio::test]
    async fn browser_log_routes_match_frontend_contract() {
        crate::infrastructure::logging::logger::clear_logs();
        crate::infrastructure::logging::logger::add_log("hello", "Test", "info");

        let logs = get_logs_handler(Query(LogsQuery { since: Some(0.0) })).await;
        let payload = logs.0.as_array().expect("logs payload should be array");
        assert_eq!(payload.len(), 1);
        assert_eq!(payload[0]["message"], json!("hello"));

        let cleared = clear_logs_handler().await;
        assert_eq!(cleared.0["success"], json!(true));
        assert!(crate::infrastructure::logging::logger::get_logs_since(0.0).is_empty());
    }

    #[tokio::test]
    async fn resolve_settings_ui_root_allows_valid_file_inside_module() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let settings_dir = temp_dir.path().join("settings-ui");
        fs::create_dir_all(&settings_dir).expect("create settings dir");
        let entry_path = settings_dir.join("index.html");
        fs::write(&entry_path, "<html></html>").expect("write entry file");

        let (root, entry) = resolve_settings_ui_root(temp_dir.path(), "settings-ui/index.html")
            .await
            .expect("resolve settings ui");

        assert_eq!(
            root,
            fs::canonicalize(&settings_dir).expect("canonical settings root")
        );
        assert_eq!(
            entry,
            fs::canonicalize(&entry_path).expect("canonical entry path")
        );
    }
}
