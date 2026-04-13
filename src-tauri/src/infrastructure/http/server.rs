use crate::domain::{
    modules::controller as module_controller,
    monitoring::system_monitor::SystemMonitorService,
    system::hardware_probe::{merge_probe_with_runtime_stats, probe_gpu_info},
};
use crate::infrastructure::logging;
use crate::models::{
    SystemStats,
    modules::{ConfigField, Module},
};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderName, HeaderValue, Method},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use tauri::{AppHandle, Manager};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
struct AppState {
    config: std::sync::Arc<crate::domain::system::config_service::ConfigService>,
    settings: crate::infrastructure::config::settings::SettingsService,
    monitor: std::sync::Arc<SystemMonitorService>,
}

/// Starts the HTTP API server on port 3000 for local access
pub fn start_server(
    app: &AppHandle,
    settings_service: crate::infrastructure::config::settings::SettingsService,
) {
    let config_service = std::sync::Arc::clone(
        app.state::<std::sync::Arc<crate::domain::system::config_service::ConfigService>>()
            .inner(),
    );

    let state = AppState {
        monitor: std::sync::Arc::clone(app.state::<std::sync::Arc<SystemMonitorService>>().inner()),
        config: config_service,
        settings: settings_service,
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
            .route("/api/stats", get(stats_handler))
            .route("/api/monitoring/stats", get(stats_handler))
            .route("/api/logs", get(get_logs_handler))
            .route("/api/logs/clear", post(clear_logs_handler))
            .route("/api/modules", get(get_modules_handler))
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
    use super::{LogsQuery, clear_logs_handler, get_logs_handler, sanitize_public_module};
    use crate::models::modules::{ConfigField, Module};
    use axum::extract::Query;
    use serde_json::json;
    use std::collections::HashMap;

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
                default: Some(json!("seed-value")),
                required: true,
                options: None,
            },
        );
        schema.insert(
            "endpoint".to_string(),
            ConfigField {
                field_type: "text".to_string(),
                label: "Endpoint".to_string(),
                default: Some(json!("http://localhost")),
                required: true,
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
}
