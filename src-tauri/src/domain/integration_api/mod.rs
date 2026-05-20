//! Local HTTP API exposed to trusted launcher integrations.
//!
//! The server is bound to loopback only and requires a per-process bearer token. Module
//! runtimes receive the base URL and token through environment variables.

mod auth;
mod http;
mod routing;
mod types;

use crate::domain::ai::ChatSessionManager;
use crate::domain::ai::ImageGenerationState;
use crate::domain::engine::manager::EngineManager;
use crate::domain::system::config_service::ConfigService;
use crate::domain::system::ports::{LAUNCHER_LOCAL_PORT_RANGE, LocalPortPurpose};
use crate::errors::AppError;
use crate::infrastructure::config::settings::SettingsService;
use crate::infrastructure::config::ui_state::UiStateService;
use once_cell::sync::OnceCell;
use serde_json::json;
use std::net::TcpListener;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, mpsc};
use tauri::AppHandle;

use auth::is_loopback_peer;
use http::{complete_http_request_body, json_error, read_http_request_head, write_response_or_log};
use routing::dispatch_http_request;
use types::{HttpWorkerReceiver, ValidatedHttpRequest};

const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:3000";
/// Public launcher integration SDK contract version exposed to module runtimes.
pub const SDK_API_VERSION: &str = "1";
const MAX_HTTP_API_WORKERS: usize = 8;
const MAX_HTTP_API_QUEUE: usize = 32;

static API_BASE_URL: OnceCell<String> = OnceCell::new();
static API_TOKEN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
});

// Re-export public surface
pub use auth::{revoke_all_module_api_tokens, revoke_module_api_token};

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
pub fn apply_process_env(
    command: &mut tokio::process::Command,
    module_id: &str,
) -> Result<(), AppError> {
    let module_dir = crate::domain::modules::downloader::get_module_path(module_id);
    let module_runtime_dir = crate::domain::modules::paths::runtime_root(module_id);
    let module_log_dir = crate::domain::modules::paths::log_dir(module_id);
    let token = auth::issue_module_api_token(module_id)?;

    command
        .env("AXELATE_HTTP_API_BASE", api_base_url())
        .env("AXELATE_HTTP_API_TOKEN", token)
        .env("AXELATE_INTEGRATION_API_VERSION", SDK_API_VERSION)
        .env("AXELATE_MODULE_ID", module_id)
        .env("AXELATE_MODULE_DIR", module_dir)
        .env("AXELATE_RUNTIME_DIR", &*crate::utils::paths::RUNTIME_DIR)
        .env("AXELATE_MODULE_RUNTIME_DIR", module_runtime_dir)
        .env("AXELATE_MODULE_LOG_DIR", module_log_dir);

    Ok(())
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

// ── Server loop ──────────────────────────────────────────────────────────────

fn serve_launcher_http_api(listener: &TcpListener, context: &LauncherHttpApiContext) {
    let (sender, receiver) = mpsc::sync_channel(MAX_HTTP_API_QUEUE);
    let receiver = Arc::new(Mutex::new(receiver));
    let mut started_workers = 0_usize;
    for worker_index in 0..MAX_HTTP_API_WORKERS {
        let worker_receiver = Arc::clone(&receiver);
        match std::thread::Builder::new()
            .name(format!("axelate-local-http-worker-{worker_index}"))
            .spawn(move || run_http_api_worker(&worker_receiver))
        {
            Ok(_) => {
                started_workers += 1;
            }
            Err(error) => {
                tracing::warn!("Failed to spawn launcher HTTP API worker: {error}");
            }
        }
    }

    if started_workers == 0 {
        tracing::error!("Launcher HTTP API started with zero worker threads");
        return;
    }

    for incoming in listener.incoming() {
        match incoming {
            Ok(mut stream) => {
                let request_context = context.clone();
                let peer_addr = stream.peer_addr().ok();
                let request = match read_http_request_head(&mut stream) {
                    Ok(request) => request,
                    Err(error) => {
                        let response = types::HttpResponse {
                            status: 400,
                            body: json!({ "ok": false, "error": error }),
                        };
                        write_response_or_log(&mut stream, &response);
                        continue;
                    }
                };
                if let Some(response) = preflight_http_request(&request, peer_addr) {
                    write_response_or_log(&mut stream, &response);
                    continue;
                }
                let job = ValidatedHttpRequest {
                    stream,
                    request,
                    context: request_context,
                    peer_addr,
                };
                match sender.try_send(job) {
                    Ok(()) => {}
                    Err(mpsc::TrySendError::Full(mut job)) => {
                        let response = json_error(503, "Launcher API request queue is full");
                        write_response_or_log(&mut job.stream, &response);
                    }
                    Err(mpsc::TrySendError::Disconnected(mut job)) => {
                        let response = json_error(500, "Launcher API workers are unavailable");
                        write_response_or_log(&mut job.stream, &response);
                    }
                }
            }
            Err(error) => {
                tracing::warn!("Launcher HTTP API accept failed: {error}");
            }
        }
    }
}

fn run_http_api_worker(receiver: &HttpWorkerReceiver) {
    loop {
        let job = {
            let Ok(receiver) = receiver.lock() else {
                tracing::warn!("Launcher HTTP API worker receiver lock is poisoned");
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            };
            receiver.recv()
        };

        match job {
            Ok(job) => {
                if std::panic::catch_unwind(AssertUnwindSafe(|| {
                    handle_validated_request(job.stream, job.request, job.context, job.peer_addr);
                }))
                .is_err()
                {
                    tracing::error!("Launcher HTTP API worker recovered from request panic");
                }
            }
            Err(_) => return,
        }
    }
}

fn preflight_http_request(
    request: &types::HttpRequest,
    peer_addr: Option<std::net::SocketAddr>,
) -> Option<types::HttpResponse> {
    if !is_loopback_peer(peer_addr) {
        return Some(json_error(
            403,
            "Launcher API only accepts loopback clients",
        ));
    }

    let path = http::request_path(request);
    if request.method == "GET" && path == "/v1/health" {
        return None;
    }

    if !auth::is_authorized(&request.headers) {
        return Some(json_error(401, "Missing or invalid launcher API token"));
    }

    None
}

fn handle_validated_request(
    mut stream: std::net::TcpStream,
    request: types::HttpRequest,
    context: LauncherHttpApiContext,
    peer_addr: Option<std::net::SocketAddr>,
) {
    let response = match complete_http_request_body(&mut stream, request) {
        Ok(request) => {
            tauri::async_runtime::block_on(dispatch_http_request(request, context, peer_addr))
        }
        Err(error) => types::HttpResponse {
            status: 400,
            body: json!({ "ok": false, "error": error }),
        },
    };
    write_response_or_log(&mut stream, &response);
}

#[cfg(test)]
mod tests;
