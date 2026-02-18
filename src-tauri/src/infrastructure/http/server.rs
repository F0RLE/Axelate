use crate::domain::{modules::controller as module_controller, monitoring::system_monitor};
use crate::models::SystemStats;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderName, HeaderValue, Method},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::net::SocketAddr;
use tauri::AppHandle;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
struct AppState {
    tauri_app: AppHandle,
    config_service: std::sync::Arc<crate::domain::system::config_service::ConfigService>,
}

/// Starts the HTTP API server on port 1420 for local access
pub fn start_server(app: AppHandle) {
    let repo =
        crate::infrastructure::config::config_repository::FileConfigRepository::new(app.clone());
    let service = std::sync::Arc::new(crate::domain::system::config_service::ConfigService::new(
        Box::new(repo),
    ));
    let state = AppState {
        tauri_app: app,
        config_service: service,
    };

    tauri::async_runtime::spawn(async move {
        // ... (CORS logic remains the same)
        let allowed_origins = [
            "tauri://localhost",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
        ];

        let mut cors = CorsLayer::new()
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers([HeaderName::from_static("content-type")]);

        for origin in allowed_origins {
            if let Ok(parsed) = origin.parse::<HeaderValue>() {
                cors = cors.allow_origin(parsed);
            }
        }
        // Removed the redundant 'cors;' statement here. The 'cors' variable is correctly used below.

        // Build Router
        let app = Router::new()
            .route("/api/health", get(health_handler))
            .route("/api/monitoring/stats", get(stats_handler))
            .route("/api/modules", get(get_modules_handler))
            .route("/api/modules/:id/control", post(control_module_handler))
            .route("/api/translations", get(translations_handler))
            .route("/api/gpu/info", get(gpu_info_handler))
            .route("/api/settings", get(get_settings_handler))
            .route("/api/settings/save", post(save_setting_handler))
            .route("/api/config", get(get_config_handler))
            .route("/api/system/language", get(system_language_handler))
            .route("/api/control", post(general_control_handler))
            .layer(cors)
            .with_state(state);

        // Bind to 127.0.0.1 for local access only initially (safer & less firewall issues)
        let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
        log::debug!("[Server] HTTP Server listening on http://{addr}");

        // SAFETY: Binding to a port might fail if occupied, but inside tokio::spawn
        // we can't easily propagate errors up. We log and exit the thread.
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, app).await {
                    log::error!("[Server] Fatal error serving HTTP: {e}");
                }
            }
            Err(e) => {
                log::error!("[Server] Failed to bind to port 3000: {e}");
            }
        }
    });
}

// Handlers

async fn health_handler() -> Json<Value> {
    log::debug!("[Server] Health check requested");
    Json(json!({ "status": "ok", "version": "0.1.3" }))
}

async fn stats_handler() -> Json<SystemStats> {
    // No logging here to prevent spamming logs every second
    let stats = system_monitor::get_stats().await;
    Json(stats)
}

#[derive(serde::Deserialize)]
struct ControlRequest {
    action: String,
}

async fn control_module_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ControlRequest>,
) -> Result<Json<Value>, crate::errors::AppError> {
    log::info!(
        "[Server] Module control request: id={} action={}",
        id,
        payload.action
    );

    let action_enum = payload.action.parse::<module_controller::ModuleAction>()?;

    #[allow(clippy::redundant_clone)]
    let res = module_controller::control(state.tauri_app.clone(), &id, action_enum).await?;

    log::info!("[Server] Module control success: {res:?}");
    Ok(Json(json!(res)))
}

// --- Web Support Handlers ---

use axum::extract::Query;

#[derive(serde::Deserialize)]
struct LangQuery {
    lang: Option<String>,
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

    log::debug!("[Server] Translations requested for {lang}");

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

#[allow(
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss
)]
async fn gpu_info_handler() -> Json<Value> {
    let stats = system_monitor::get_stats().await;

    if let Some(gpu) = stats.gpu {
        // Convert Bytes to MB
        let memory_mb = if gpu.memory_total.is_finite() && gpu.memory_total > 0.0 {
            let mb = gpu.memory_total / 1024.0 / 1024.0;
            if mb >= u64::MAX as f64 {
                u64::MAX
            } else {
                mb.floor() as u64
            }
        } else {
            0
        };

        Json(json!({
            "detected": true,
            "name": gpu.name,
            "cuda": true, // Presence of NVML usually implies CUDA support
            "memory": memory_mb
        }))
    } else {
        Json(json!({
            "detected": false,
            "name": "Integrated / No GPU",
            "cuda": false,
            "memory": 0
        }))
    }
}

// Reuse infrastructure settings instead of duplicate persistence
use crate::infrastructure::config::settings as infra_settings;

async fn get_settings_handler() -> Json<Value> {
    match infra_settings::get_settings() {
        Ok(settings) => Json(serde_json::to_value(settings).unwrap_or_else(|_| json!({}))),
        Err(e) => {
            log::error!("[Server] Failed to load settings: {e}");
            Json(json!({}))
        }
    }
}

#[derive(serde::Deserialize)]
struct SaveSettingRequest {
    key: String,
    value: String,
}

async fn save_setting_handler(Json(payload): Json<SaveSettingRequest>) -> Json<Value> {
    log::info!("[Server] Save setting: {} = {}", payload.key, payload.value);

    match infra_settings::save_setting(&payload.key, &payload.value) {
        Ok(()) => Json(json!({ "success": true })),
        Err(e) => {
            log::error!("[Server] Failed to save setting: {e}");
            Json(json!({ "success": false, "message": e.to_string() }))
        }
    }
}

async fn get_modules_handler() -> Json<Value> {
    let modules = module_controller::get_all_modules().await;
    Json(serde_json::to_value(modules).unwrap_or(json!([])))
}

async fn system_language_handler() -> Json<Value> {
    let lang = infra_settings::get_language();
    Json(json!({ "language": lang }))
}

async fn get_config_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, crate::errors::AppError> {
    use crate::domain::modules::downloader;

    let mut config = state.config_service.load_full_config()?;

    // Populate installed status
    for module in &mut config.catalog.ai {
        module.installed = downloader::is_module_installed(&module.id);
    }
    for module in &mut config.catalog.services {
        module.installed = downloader::is_module_installed(&module.id);
    }

    Ok(Json(serde_json::to_value(config)?))
}

#[derive(serde::Deserialize)]
struct GeneralControlRequest {
    action: String,
    service: String,
}

async fn general_control_handler(Json(payload): Json<GeneralControlRequest>) -> Json<Value> {
    log::info!(
        "[Server] General control: {} {}",
        payload.action,
        payload.service
    );
    Json(json!({ "success": true }))
}
