use crate::domain::{
    modules::controller as module_controller, monitoring::system_monitor::SystemMonitorService,
};
use crate::models::SystemStats;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderName, HeaderValue, Method},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::net::SocketAddr;
use tauri::{AppHandle, Manager};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
struct AppState {
    tauri_app: AppHandle,
    config_service: std::sync::Arc<crate::domain::system::config_service::ConfigService>,
    settings_service: crate::infrastructure::config::settings::SettingsService,
    monitor_service: std::sync::Arc<SystemMonitorService>,
}

/// Starts the HTTP API server on port 3000 for local access
pub fn start_server(
    app: AppHandle,
    settings_service: crate::infrastructure::config::settings::SettingsService,
) {
    let config_service = std::sync::Arc::clone(
        app.state::<std::sync::Arc<crate::domain::system::config_service::ConfigService>>()
            .inner(),
    );

    let state = AppState {
        monitor_service: std::sync::Arc::clone(
            app.state::<std::sync::Arc<SystemMonitorService>>().inner(),
        ),
        tauri_app: app,
        config_service,
        settings_service,
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
            .route("/api/modules/{id}/control", post(control_module_handler))
            .route("/api/translations", get(translations_handler))
            .route("/api/gpu/info", get(gpu_info_handler))
            .route("/api/settings", get(get_settings_handler))
            .route("/api/settings/save", post(save_setting_handler))
            .route("/api/config", get(get_config_handler))
            .route("/api/system/language", get(system_language_handler))
            .layer(cors)
            .with_state(state);

        match bind_local_listener().await {
            Ok(listener) => {
                let addr = listener
                    .local_addr()
                    .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], 0)));
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
    let snapshot = state.monitor_service.get_stats().await;
    Json(snapshot)
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
    tracing::info!(
        "[Server] Module control request: id={} action={}",
        id,
        payload.action
    );

    let action_enum = payload.action.parse::<module_controller::ModuleAction>()?;

    #[allow(clippy::redundant_clone)]
    let res = module_controller::control(state.tauri_app.clone(), &id, action_enum).await?;

    tracing::info!("[Server] Module control success: {res:?}");
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

#[allow(
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss
)]
async fn gpu_info_handler(State(state): State<AppState>) -> Json<Value> {
    let snapshot = state.monitor_service.get_stats().await;

    if let Some(gpu) = snapshot.gpu {
        let gpu_name = gpu.name;
        let has_cuda = gpu_name.to_ascii_lowercase().contains("nvidia");
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
            "name": gpu_name,
            "cuda": has_cuda,
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

async fn get_settings_handler(State(state): State<AppState>) -> Json<Value> {
    match state.settings_service.get_settings().await {
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

async fn save_setting_handler(
    State(state): State<AppState>,
    Json(payload): Json<SaveSettingRequest>,
) -> Json<Value> {
    tracing::info!("[Server] Save setting: {} = {}", payload.key, payload.value);

    match state
        .settings_service
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
    Json(serde_json::to_value(modules).unwrap_or(json!([])))
}

async fn system_language_handler() -> Json<Value> {
    let lang = infra_settings::get_language_sync();
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
