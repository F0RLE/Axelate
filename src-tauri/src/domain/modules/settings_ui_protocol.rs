use crate::domain::modules::settings_ui::{
    resolve_module_settings_ui_location, resolve_settings_ui_asset_path,
};
use crate::errors::{AppError, IpcError};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};
use tauri::http::{
    Method, Request, Response, StatusCode,
    header::{CACHE_CONTROL, CONTENT_TYPE},
};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

type HttpResponse = Response<Vec<u8>>;
type ModuleSettingsPayload = HashMap<String, Value>;

const MODULE_SETTINGS_SCHEME: &str = "module-settings";
const MODULE_SETTINGS_LABEL_PREFIX: &str = "module-settings";
const MODULE_SETTINGS_SESSION_TTL: Duration = Duration::from_secs(60 * 60);
const MODULE_SETTINGS_MAX_SESSIONS: usize = 128;
const HOST_INDEX_HTML: &str = include_str!("../../../resources/module_settings_host/index.html");
const HOST_SCRIPT: &str = include_str!("../../../resources/module_settings_host/host.js");
const HOST_STYLES: &str = include_str!("../../../resources/module_settings_host/host.css");
const HOST_CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none';";

#[derive(Clone, Debug)]
struct ModuleSettingsSession {
    module_id: String,
    last_accessed_at: Instant,
}

#[derive(Debug, Default)]
/// Stores scoped access tokens for module-owned settings iframes embedded in the main UI.
pub struct ModuleSettingsSessionStore {
    sessions: Mutex<HashMap<String, ModuleSettingsSession>>,
}

impl ModuleSettingsSessionStore {
    /// Creates a new settings session token for a module with a custom settings UI.
    pub async fn create_session(&self, module_id: &str) -> Result<String, AppError> {
        resolve_module_settings_ui_location(module_id).await?;

        let token = uuid::Uuid::new_v4().to_string();
        let now = Instant::now();
        let mut sessions = self.lock_sessions()?;
        prune_sessions(&mut sessions, now);
        sessions.insert(
            token.clone(),
            ModuleSettingsSession {
                module_id: module_id.to_string(),
                last_accessed_at: now,
            },
        );
        trim_sessions(&mut sessions);
        Ok(token)
    }

    fn resolve_module_id(&self, token: &str) -> Result<Option<String>, AppError> {
        let now = Instant::now();
        let mut sessions = self.lock_sessions()?;
        prune_sessions(&mut sessions, now);
        let Some(session) = sessions.get_mut(token) else {
            return Ok(None);
        };

        session.last_accessed_at = now;
        Ok(Some(session.module_id.clone()))
    }

    fn lock_sessions(
        &self,
    ) -> Result<MutexGuard<'_, HashMap<String, ModuleSettingsSession>>, AppError> {
        self.sessions.lock().map_err(|_| AppError::Internal {
            request_id: None,
            message: "Module settings session store is unavailable".to_string(),
        })
    }
}

/// Registers the custom protocol used by module-owned settings UIs.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("module-settings-protocol")
        .register_asynchronous_uri_scheme_protocol(
            MODULE_SETTINGS_SCHEME,
            |context, request, responder| {
                let app_handle = context.app_handle().clone();
                let webview_label = context.webview_label().to_string();
                tauri::async_runtime::spawn(async move {
                    let response =
                        handle_protocol_request(app_handle, webview_label, request).await;
                    responder.respond(response);
                });
            },
        )
        .build()
}

async fn handle_protocol_request<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    webview_label: String,
    request: Request<Vec<u8>>,
) -> HttpResponse {
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path = uri.path().to_string();
    let session_path = parse_session_path(&path);
    let route_path = session_path
        .as_ref()
        .map_or(path.as_str(), |(_, stripped_path)| stripped_path.as_str());

    tracing::debug!(
        target: "module_settings_protocol",
        webview_label = webview_label,
        method = %method,
        uri = %uri,
        route_path = route_path,
        "Handling module settings protocol request",
    );

    let response = match route_path {
        "/host" | "/host/" | "/host/index.html" => Ok(host_asset_response(
            "index.html",
            "text/html; charset=utf-8",
            HOST_INDEX_HTML.as_bytes(),
            &[("content-security-policy", HOST_CONTENT_SECURITY_POLICY)],
        )
        .await),
        "/host/host.js" => Ok(host_asset_response(
            "host.js",
            "text/javascript; charset=utf-8",
            HOST_SCRIPT.as_bytes(),
            &[],
        )
        .await),
        "/host/host.css" => Ok(host_asset_response(
            "host.css",
            "text/css; charset=utf-8",
            HOST_STYLES.as_bytes(),
            &[],
        )
        .await),
        "/api/settings" => {
            match resolve_module_id_for_request(
                &app_handle,
                &webview_label,
                &request,
                session_path.as_ref().map(|(token, _)| token.as_str()),
            ) {
                Ok(module_id) => handle_settings_api(&app_handle, &module_id, request).await,
                Err(error) => Err(error),
            }
        }
        _ => match parse_module_asset_request(route_path) {
            Some(requested_asset) => {
                match resolve_module_id_for_request(
                    &app_handle,
                    &webview_label,
                    &request,
                    session_path.as_ref().map(|(token, _)| token.as_str()),
                ) {
                    Ok(module_id) => serve_module_asset(&module_id, requested_asset).await,
                    Err(error) => Err(error),
                }
            }
            None => Err(AppError::NotFound(format!(
                "Unsupported module settings route: {route_path}"
            ))),
        },
    };

    match response {
        Ok(response) => {
            tracing::debug!(
                target: "module_settings_protocol",
                webview_label = webview_label,
                route_path = route_path,
                status = %response.status(),
                "Module settings protocol request succeeded",
            );
            response
        }
        Err(error) => {
            tracing::error!(
                target: "module_settings_protocol",
                webview_label = webview_label,
                route_path = route_path,
                error = %error,
                "Module settings protocol request failed",
            );
            error_response(status_for_error(&error), error)
        }
    }
}

fn resolve_module_id_for_request<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    webview_label: &str,
    request: &Request<Vec<u8>>,
    session_token: Option<&str>,
) -> Result<String, AppError> {
    if let Some(token) = session_token
        .map(ToOwned::to_owned)
        .or_else(|| extract_query_value(request.uri().query(), "token"))
    {
        let Some(store) = app_handle.try_state::<ModuleSettingsSessionStore>() else {
            return Err(AppError::Internal {
                request_id: None,
                message: "Module settings session store is not available".to_string(),
            });
        };

        return store.resolve_module_id(&token)?.ok_or_else(|| {
            AppError::PermissionDenied("Invalid module settings session".to_string())
        });
    }

    parse_module_id_from_label(webview_label)
}

fn parse_session_path(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("/session/")?;
    let (token, route_path) = rest.split_once('/')?;
    if token.is_empty() {
        return None;
    }

    Some((token.to_string(), format!("/{route_path}")))
}

async fn handle_settings_api<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    module_id: &str,
    request: Request<Vec<u8>>,
) -> Result<HttpResponse, AppError> {
    let Some(settings_service) =
        app_handle.try_state::<crate::infrastructure::config::settings::SettingsService>()
    else {
        return Err(AppError::Internal {
            request_id: None,
            message: "Settings service is not available".to_string(),
        });
    };

    match *request.method() {
        Method::GET => {
            let settings = settings_service.get_module_settings(module_id).await?;
            json_response(StatusCode::OK, &settings)
        }
        Method::POST => {
            let settings = parse_settings_payload(request.body())?;
            settings_service
                .save_module_settings(module_id, &settings)
                .await?;
            json_response(StatusCode::OK, &settings)
        }
        _ => Ok(method_not_allowed_response()),
    }
}

fn parse_settings_payload(bytes: &[u8]) -> Result<ModuleSettingsPayload, AppError> {
    if bytes.is_empty() {
        return Ok(HashMap::new());
    }

    let value: Value = serde_json::from_slice(bytes)?;
    match value {
        Value::Object(map) => Ok(map.into_iter().collect()),
        _ => Err(AppError::Validation(
            "settings payload must be a JSON object".to_string(),
        )),
    }
}

async fn serve_module_asset(
    module_id: &str,
    request: ModuleAssetRequest<'_>,
) -> Result<HttpResponse, AppError> {
    let location = resolve_module_settings_ui_location(module_id).await?;
    let asset_path = match request {
        ModuleAssetRequest::Entry => location.entry,
        ModuleAssetRequest::Asset(relative_path) => {
            resolve_settings_ui_asset_path(&location, relative_path).await?
        }
    };
    let bytes = tokio::fs::read(&asset_path)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;
    let mime_type = content_type_for_asset_path(&asset_path, &bytes);

    tracing::debug!(
        target: "module_settings_protocol",
        module_id = module_id,
        asset_path = %asset_path.display(),
        mime_type = mime_type,
        "Serving module settings asset",
    );

    Ok(build_response(
        StatusCode::OK,
        &mime_type,
        bytes,
        &[
            // Sandboxed module iframes use an opaque origin. ES modules and dynamic imports
            // therefore need an explicit CORS opt-in for same-folder assets to load.
            ("access-control-allow-origin", "*"),
            ("cross-origin-resource-policy", "cross-origin"),
        ],
    ))
}

fn content_type_for_asset_path(asset_path: &std::path::Path, bytes: &[u8]) -> String {
    match asset_path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html" | "htm") => "text/html; charset=utf-8".to_string(),
        Some("js" | "mjs") => "text/javascript; charset=utf-8".to_string(),
        Some("css") => "text/css; charset=utf-8".to_string(),
        Some("json") => "application/json; charset=utf-8".to_string(),
        Some("svg") => "image/svg+xml".to_string(),
        Some("png") => "image/png".to_string(),
        Some("jpg" | "jpeg") => "image/jpeg".to_string(),
        Some("gif") => "image/gif".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("ico") => "image/x-icon".to_string(),
        Some("woff") => "font/woff".to_string(),
        Some("woff2") => "font/woff2".to_string(),
        Some("ttf") => "font/ttf".to_string(),
        Some("otf") => "font/otf".to_string(),
        Some("txt") => "text/plain; charset=utf-8".to_string(),
        _ => tauri::utils::mime_type::MimeType::parse(bytes, asset_path.to_string_lossy().as_ref()),
    }
}

fn parse_module_id_from_label(label: &str) -> Result<String, AppError> {
    let mut parts = label.splitn(3, ':');
    let prefix = parts.next();
    let module_id = parts.next();
    let nonce = parts.next();

    if prefix != Some(MODULE_SETTINGS_LABEL_PREFIX) || module_id.is_none() || nonce.is_none() {
        return Err(AppError::PermissionDenied(
            "Module settings route is only available to owned settings webviews".to_string(),
        ));
    }

    let module_id = module_id.unwrap_or_default();
    crate::domain::modules::downloader::validate_module_id(module_id)?;
    Ok(module_id.to_string())
}

fn extract_query_value(query: Option<&str>, key: &str) -> Option<String> {
    query.and_then(|query| {
        query.split('&').find_map(|pair| {
            let (candidate_key, candidate_value) = pair.split_once('=')?;
            (candidate_key == key).then(|| candidate_value.to_string())
        })
    })
}

enum ModuleAssetRequest<'a> {
    Entry,
    Asset(&'a str),
}

fn parse_module_asset_request(path: &str) -> Option<ModuleAssetRequest<'_>> {
    match path {
        "/module" | "/module/" => Some(ModuleAssetRequest::Entry),
        _ => path.strip_prefix("/module/").map(ModuleAssetRequest::Asset),
    }
}

fn prune_sessions(sessions: &mut HashMap<String, ModuleSettingsSession>, now: Instant) {
    sessions.retain(|_, session| {
        now.saturating_duration_since(session.last_accessed_at) <= MODULE_SETTINGS_SESSION_TTL
    });
}

fn trim_sessions(sessions: &mut HashMap<String, ModuleSettingsSession>) {
    while sessions.len() > MODULE_SETTINGS_MAX_SESSIONS {
        let Some(oldest_token) = sessions
            .iter()
            .min_by_key(|(_, session)| session.last_accessed_at)
            .map(|(token, _)| token.clone())
        else {
            break;
        };

        sessions.remove(&oldest_token);
    }
}

async fn host_asset_response(
    file_name: &str,
    content_type: &str,
    fallback: &'static [u8],
    extra_headers: &[(&str, &str)],
) -> HttpResponse {
    let body = load_dev_host_asset(file_name, fallback).await;

    build_response(StatusCode::OK, content_type, body, extra_headers)
}

async fn load_dev_host_asset(file_name: &str, fallback: &'static [u8]) -> Vec<u8> {
    #[cfg(debug_assertions)]
    {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/module_settings_host")
            .join(file_name);
        if let Ok(bytes) = tokio::fs::read(path).await {
            return bytes;
        }
    }

    fallback.to_vec()
}

fn method_not_allowed_response() -> HttpResponse {
    build_response(
        StatusCode::METHOD_NOT_ALLOWED,
        "text/plain; charset=utf-8",
        b"Method not allowed".to_vec(),
        &[("allow", "GET, POST")],
    )
}

fn json_response<T: serde::Serialize>(
    status: StatusCode,
    value: &T,
) -> Result<HttpResponse, AppError> {
    let body = serde_json::to_vec(value)?;
    Ok(build_response(
        status,
        "application/json; charset=utf-8",
        body,
        &[],
    ))
}

fn error_response(status: StatusCode, error: AppError) -> HttpResponse {
    match serde_json::to_vec(&IpcError::from(error)) {
        Ok(body) => build_response(status, "application/json; charset=utf-8", body, &[]),
        Err(_) => build_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "application/json; charset=utf-8",
            br#"{"code":"INTERNAL","message":"Failed to serialize error response"}"#.to_vec(),
            &[],
        ),
    }
}

fn build_response(
    status: StatusCode,
    content_type: &str,
    body: Vec<u8>,
    extra_headers: &[(&str, &str)],
) -> HttpResponse {
    let mut builder = Response::builder()
        .status(status)
        .header(CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff")
        .header(CONTENT_TYPE, content_type);

    for (name, value) in extra_headers {
        builder = builder.header(*name, *value);
    }

    match builder.body(body) {
        Ok(response) => response,
        Err(_) => Response::new(Vec::new()),
    }
}

const fn status_for_error(error: &AppError) -> StatusCode {
    match error {
        AppError::Validation(_) => StatusCode::BAD_REQUEST,
        AppError::NotFound(_) => StatusCode::NOT_FOUND,
        AppError::PermissionDenied(_) => StatusCode::FORBIDDEN,
        AppError::Io(_)
        | AppError::Serialization(_)
        | AppError::Config(_)
        | AppError::External { .. }
        | AppError::Internal { .. } => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::content_type_for_asset_path;
    use std::path::Path;

    #[test]
    fn serves_html_with_explicit_text_html_mime() {
        assert_eq!(
            content_type_for_asset_path(Path::new("settings-ui/index.html"), b"<html></html>"),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn serves_javascript_with_explicit_script_mime() {
        assert_eq!(
            content_type_for_asset_path(Path::new("settings-ui/app.js"), b"console.log('ok');"),
            "text/javascript; charset=utf-8"
        );
    }

    #[test]
    fn serves_stylesheets_with_explicit_css_mime() {
        assert_eq!(
            content_type_for_asset_path(Path::new("settings-ui/styles.css"), b"body{}"),
            "text/css; charset=utf-8"
        );
    }
}
