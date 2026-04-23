use crate::domain::modules::settings_ui::{
    resolve_module_settings_ui_location, resolve_settings_ui_asset_path,
};
use crate::errors::{AppError, IpcError};
use serde_json::Value;
use std::collections::HashMap;
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
const HOST_INDEX_HTML: &str = include_str!("../../../resources/module_settings_host/index.html");
const HOST_SCRIPT: &str = include_str!("../../../resources/module_settings_host/host.js");
const HOST_STYLES: &str = include_str!("../../../resources/module_settings_host/host.css");
const HOST_CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none';";

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
    let module_id = match parse_module_id_from_label(&webview_label) {
        Ok(module_id) => module_id,
        Err(error) => return error_response(StatusCode::FORBIDDEN, error),
    };

    let path = request.uri().path();
    let response = match path {
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
        "/api/settings" => handle_settings_api(&app_handle, &module_id, request).await,
        _ => match parse_module_asset_request(path) {
            Some(requested_asset) => serve_module_asset(&module_id, requested_asset).await,
            None => Err(AppError::NotFound(format!(
                "Unsupported module settings route: {path}"
            ))),
        },
    };

    match response {
        Ok(response) => response,
        Err(error) => error_response(status_for_error(&error), error),
    }
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
    let mime_type =
        tauri::utils::mime_type::MimeType::parse(&bytes, asset_path.to_string_lossy().as_ref());

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
