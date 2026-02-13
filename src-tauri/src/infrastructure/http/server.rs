use crate::domain::{modules::controller as module_controller, monitoring::system_monitor};
use crate::models::SystemStats;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::Method,
    routing::{get, post},
};
use serde_json::{Value, json};
use std::net::SocketAddr;
use tauri::AppHandle;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    tauri_app: AppHandle,
}

/// Starts the HTTP API server on port 3000 for local access
pub fn start_server(app: AppHandle) {
    let state = AppState { tauri_app: app };

    tauri::async_runtime::spawn(async move {
        // Define CORS
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any);

        // Build Router
        let app = Router::new()
            .route("/health", get(health_handler))
            .route("/api/stats", get(stats_handler))
            .route("/api/module/{id}/control", post(control_module_handler))
            // Web Interface Support
            .route("/api/translations", get(translations_handler))
            .route("/api/gpu_info", get(gpu_info_handler))
            .route(
                "/api/settings",
                get(get_settings_handler).post(save_setting_handler),
            )
            .route("/api/modules", get(get_modules_handler))
            .route("/api/config", get(get_config_handler))
            .route("/api/system_language", get(system_language_handler))
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
    let stats = system_monitor::get_stats();
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
) -> Json<Value> {
    log::info!(
        "[Server] Module control request: id={} action={}",
        id,
        payload.action
    );

    // Convert string action to enum
    let action_enum = match payload.action.parse::<module_controller::ModuleAction>() {
        Ok(a) => a,
        Err(e) => {
            log::warn!(
                "[Server] Invalid module action attempting to parse: {}",
                payload.action
            );
            return Json(json!({
                "success": false,
                "message": format!("Invalid action: {e}")
            }));
        }
    };

    #[allow(clippy::redundant_clone)] // AppHandle clone is intentional for async ownership
    match module_controller::control(state.tauri_app.clone(), &id, action_enum) {
        Ok(res) => {
            log::info!("[Server] Module control success: {res:?}");
            Json(json!(res))
        }
        Err(e) => {
            log::error!("[Server] Module control failed: {e}");
            Json(json!({
                "success": false,
                "message": format!("Error: {e}")
            }))
        }
    }
}

// --- Web Support Handlers ---

use axum::extract::Query;

#[derive(serde::Deserialize)]
struct LangQuery {
    lang: Option<String>,
}

async fn translations_handler(Query(params): Query<LangQuery>) -> Json<Value> {
    let lang = params.lang.unwrap_or_else(|| "en".to_string());
    log::debug!("[Server] Translations requested for {lang}");

    // Use unified resource path resolution
    let mut path = crate::utils::paths::RESOURCES_DIR.join("locales");
    path.push(format!("{lang}.json"));

    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                return Json(json);
            }
            log::error!(
                "[Server] Failed to parse translation file at {}",
                path.display()
            );
        } else {
            log::error!(
                "[Server] Failed to read translation file at {}",
                path.display()
            );
        }
    } else {
        log::warn!("[Server] Translation file not found at {}", path.display());
    }

    // Fallback if file not found
    Json(json!({
        "ui.sidebar.menu": "Main Menu (Fallback)",
        "ui.sidebar.chat": "Chat",
        "ui.sidebar.modules": "Modules",
        "ui.sidebar.settings": "Settings",
        "ui.error.file_not_found": format!("Locales not found at {path:?}")
    }))
}

#[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
async fn gpu_info_handler() -> Json<Value> {
    let stats = system_monitor::get_stats();

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

// Helpers for settings persistence
fn get_settings_path() -> std::path::PathBuf {
    crate::utils::paths::CONFIG_DIR.join("user_settings.json")
}

#[allow(clippy::collapsible_if)]
fn load_settings_map() -> std::collections::HashMap<String, String> {
    let path = get_settings_path();
    if let Ok(content) = std::fs::read_to_string(path) {
        if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&content)
        {
            return map;
        }
    }
    // Return defaults if no file or parsing fails
    let mut map = std::collections::HashMap::new();
    map.insert("LANGUAGE".to_string(), "en".to_string());
    map.insert("THEME".to_string(), "dark".to_string());
    map.insert("USE_GPU".to_string(), "true".to_string());
    map
}

async fn get_settings_handler() -> Json<Value> {
    let map = load_settings_map();
    Json(serde_json::to_value(map).unwrap_or_else(|_| json!({})))
}

#[derive(serde::Deserialize)]
struct SaveSettingRequest {
    key: String,
    value: String,
}

async fn save_setting_handler(Json(payload): Json<SaveSettingRequest>) -> Json<Value> {
    log::info!("[Server] Save setting: {} = {}", payload.key, payload.value);

    let mut map = load_settings_map();
    map.insert(payload.key, payload.value);

    let path = get_settings_path();
    // Ensure dir exists
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match std::fs::write(
        &path,
        serde_json::to_string_pretty(&map).unwrap_or_default(),
    ) {
        Ok(()) => Json(json!({ "success": true })),
        Err(e) => {
            log::error!("[Server] Failed to save settings: {e}");
            Json(json!({ "success": false, "message": e.to_string() }))
        }
    }
}

async fn get_modules_handler() -> Json<Value> {
    let modules = module_controller::get_all_modules();
    Json(serde_json::to_value(modules).unwrap_or(json!([])))
}

async fn system_language_handler() -> Json<Value> {
    let map = load_settings_map();
    let lang = map
        .get("LANGUAGE")
        .cloned()
        .unwrap_or_else(|| "en".to_string());
    Json(json!({ "language": lang }))
}

async fn get_config_handler(State(state): State<AppState>) -> Json<Value> {
    use crate::domain::modules::downloader;
    use crate::domain::system::config_service::ConfigService;
    use crate::infrastructure::config::config_repository::FileConfigRepository;

    let repo = FileConfigRepository::new(state.tauri_app);
    let service = ConfigService::new(Box::new(repo));

    match service.load_full_config() {
        Ok(mut config) => {
            // Populate installed status
            for module in &mut config.catalog.ai {
                module.installed = downloader::is_module_installed(&module.id);
            }
            for module in &mut config.catalog.services {
                module.installed = downloader::is_module_installed(&module.id);
            }
            let _ai = config.catalog.ai.len();
            let _srv = config.catalog.services.len();
            // The original instruction had a malformed line here. Assuming the intent was to keep the loop for services.
            // If there was an intent to remove the loop for services, please clarify.
            Json(serde_json::to_value(config).unwrap_or_else(|_| json!({})))
        }
        Err(e) => {
            log::error!("[Server] Failed to load config: {e}");
            Json(json!({}))
        }
    }
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
