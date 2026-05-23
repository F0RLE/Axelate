//! Route dispatch and request handlers for the local integration API.

use crate::domain::agent_control::{AgentApprovalRequest, AgentScope};
use crate::domain::ai::ai_service;
use crate::domain::ai::types::{
    ChatMessage, ChatRequest, ImageGenerationRequest, WebSearchOptions,
};
use crate::domain::modules::controller::{self as module_controller, ModuleAction};
use crate::domain::modules::paths as module_paths;
use crate::errors::AppError;
use crate::infrastructure::logging::LogEntry;
use crate::models::{
    AiModel, ApiProvider, ModelTier, Module, ModuleItem, ProviderType, SelectedModule,
};
use serde_json::json;
use sha2::Digest;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use tauri::Emitter;

use super::auth::{authorize_request_with_agent_profiles, is_loopback_peer};
use super::http::{json_error, json_response, parse_json_body, request_path, status_for_app_error};
use super::types::{
    AgentLauncherStateResponse, AgentLogsResponse, AgentModelSummary, AgentModuleSummary,
    AgentOpenPageEvent, AgentProviderSummary, AuthorizedClient, HttpRequest, HttpResponse,
    ImageApiResponse, IntegrationAgentApprovalRequest, IntegrationDraftCreateRequest,
    IntegrationDraftCreateResponse, IntegrationImageRequest, IntegrationModuleStageRequest,
    IntegrationOpenPageRequest, IntegrationSelectModuleRequest, IntegrationTextRequest,
    ModuleContextApiResponse, ModuleStageChangedEvent, TextApiResponse,
};
use super::{LauncherHttpApiContext, SDK_API_VERSION, api_base_url};

const AGENT_LOGS_DEFAULT_LIMIT: usize = 200;
const AGENT_LOGS_MAX_LIMIT: usize = 1000;
const CUSTOM_TEXT_PROVIDER_ID: &str = "custom-text";
const CUSTOM_IMAGE_PROVIDER_ID: &str = "custom-image";
const CUSTOM_TEXT_BACKEND_PROVIDER_ID: &str = "gpt";
const CUSTOM_IMAGE_BACKEND_PROVIDER_ID: &str = "gpt-image";
const INTEGRATION_DRAFTS_DIR_NAME: &str = "IntegrationDrafts";

#[derive(Debug, Clone, PartialEq)]
pub(super) struct AgentLogsQuery {
    pub view_id: Option<String>,
    pub since: f64,
    pub limit: usize,
}

pub(super) async fn dispatch_http_request(
    request: HttpRequest,
    context: LauncherHttpApiContext,
    peer_addr: Option<SocketAddr>,
) -> HttpResponse {
    if !is_loopback_peer(peer_addr) {
        return json_error(403, "Launcher API only accepts loopback clients");
    }

    let path = request_path(&request);
    if request.method == "GET" && path == "/v1/health" {
        return json_response(200, json!({ "ok": true, "service": "axelate-launcher" }));
    }

    let Some(client) =
        authorize_request_with_agent_profiles(&request.headers, &context.agent_control_service)
            .await
    else {
        return json_error(401, "Missing or invalid launcher API token");
    };

    match route_authorized_request(path, &request, context.clone(), &client).await {
        Ok(response) => response,
        Err(error) => {
            record_agent_audit(
                &context,
                &client,
                audit_action_from_request(&request.method, path),
                path.to_string(),
                audit_result_for_error(&error).to_string(),
            )
            .await;
            json_error(status_for_app_error(&error), &error.to_string())
        }
    }
}

async fn route_authorized_request(
    path: &str,
    request: &HttpRequest,
    context: LauncherHttpApiContext,
    client: &AuthorizedClient,
) -> Result<HttpResponse, AppError> {
    let segments = path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    match (request.method.as_str(), segments.as_slice()) {
        ("GET", ["v1", "agent", "state"]) => {
            ensure_launcher_client(client)?;
            ensure_agent_scope(client, AgentScope::Observe)?;
            handle_agent_state_request(&context).await
        }
        ("GET", ["v1", "agent", "capabilities"]) => {
            ensure_launcher_client(client)?;
            ensure_agent_scope(client, AgentScope::Observe)?;
            Ok(handle_agent_capabilities_request(client))
        }
        ("GET", ["v1", "agent", "logs"]) => {
            ensure_launcher_client(client)?;
            ensure_agent_scope(client, AgentScope::Observe)?;
            handle_agent_logs_request(request)
        }
        ("GET", ["v1", "agent", "approvals"]) => {
            ensure_launcher_client(client)?;
            ensure_agent_scope(client, AgentScope::Observe)?;
            handle_agent_approvals_request(&context).await
        }
        ("POST", ["v1", "agent", "approval-requests"]) => {
            let agent = ensure_profile_agent(client)?;
            handle_agent_approval_request(request, &context, agent).await
        }
        ("POST", ["v1", "launcher", "open-page"]) => {
            ensure_agent_scope(client, AgentScope::Operate)?;
            let response = handle_open_page_request(request, &context).await?;
            record_agent_audit(
                &context,
                client,
                "launcher.open-page".to_string(),
                response.page_id.clone(),
                "success".to_string(),
            )
            .await;
            Ok(json_response(
                200,
                json!({ "ok": true, "pageId": response.page_id }),
            ))
        }
        ("POST", ["v1", "launcher", "select-module"]) => {
            ensure_agent_scope(client, AgentScope::Operate)?;
            let response = handle_select_module_request(request, &context).await?;
            record_agent_audit(
                &context,
                client,
                "launcher.select-module".to_string(),
                format!("{}:{}", response.category, response.module.id),
                "success".to_string(),
            )
            .await;
            Ok(json_response(
                200,
                json!({ "ok": true, "category": response.category, "module": response.module }),
            ))
        }
        ("POST", ["v1", "integration-drafts"]) => {
            ensure_agent_scope(client, AgentScope::DraftCreate)?;
            let response = handle_create_integration_draft_request(request).await?;
            record_agent_audit(
                &context,
                client,
                "integration-draft.create".to_string(),
                response.id.clone(),
                "success".to_string(),
            )
            .await;
            Ok(json_response(201, json!(response)))
        }
        ("GET", ["v1", "modules"]) => {
            ensure_agent_scope(client, AgentScope::Observe)?;
            let modules =
                modules_visible_to_client(module_controller::get_all_modules().await, client);
            Ok(json_response(
                200,
                json!({ "ok": true, "modules": modules }),
            ))
        }
        ("GET", ["v1", "modules", module_id, "status"]) => {
            ensure_module_route_owner(client, module_id)?;
            ensure_agent_scope(client, AgentScope::Observe)?;
            crate::domain::modules::downloader::validate_module_id(module_id)?;
            let status = module_controller::get_module_status(module_id).await;
            Ok(json_response(
                200,
                json!({ "ok": true, "moduleId": module_id, "status": status }),
            ))
        }
        ("GET", ["v1", "modules", module_id, "context"]) => {
            ensure_module_route_owner(client, module_id)?;
            ensure_agent_scope(client, AgentScope::Observe)?;
            handle_module_context_request(module_id)
        }
        ("GET", ["v1", "modules", module_id, "settings"]) => {
            ensure_module_route_owner(client, module_id)?;
            ensure_agent_scope(client, AgentScope::Configure)?;
            handle_get_module_settings_request(&context, module_id).await
        }
        ("PUT", ["v1", "modules", module_id, "settings"]) => {
            ensure_module_route_owner(client, module_id)?;
            ensure_agent_scope(client, AgentScope::Configure)?;
            let response = handle_put_module_settings_request(request, &context, module_id)?;
            record_agent_audit(
                &context,
                client,
                "module.settings.put".to_string(),
                module_id.to_string(),
                "success".to_string(),
            )
            .await;
            Ok(response)
        }
        ("PATCH", ["v1", "modules", module_id, "settings"]) => {
            ensure_module_route_owner(client, module_id)?;
            ensure_agent_scope(client, AgentScope::Configure)?;
            let response =
                handle_patch_module_settings_request(request, &context, module_id).await?;
            record_agent_audit(
                &context,
                client,
                "module.settings.patch".to_string(),
                module_id.to_string(),
                "success".to_string(),
            )
            .await;
            Ok(response)
        }
        ("POST", ["v1", "modules", module_id, "stage"]) => {
            ensure_module_route_owner(client, module_id)?;
            ensure_agent_scope(client, AgentScope::Configure)?;
            handle_module_stage_request(request, &context, module_id)
        }
        ("POST", ["v1", "modules", module_id, action]) => {
            ensure_module_route_owner(client, module_id)?;
            ensure_agent_scope(client, AgentScope::Operate)?;
            crate::domain::modules::downloader::validate_module_id(module_id)?;
            let action = parse_module_action(action)?;
            let response =
                module_controller::control(context.app.clone(), module_id, action).await?;
            record_agent_audit(
                &context,
                client,
                format!("module.{}", module_action_name(action)),
                module_id.to_string(),
                if response.success {
                    "success"
                } else {
                    "failed"
                }
                .to_string(),
            )
            .await;
            if response.success
                && matches!(
                    action,
                    ModuleAction::Start | ModuleAction::Restart | ModuleAction::Repair
                )
            {
                sync_launcher_selected_module(&context, client, module_id).await?;
            }
            Ok(json_response(
                200,
                json!({ "ok": response.success, "response": response }),
            ))
        }
        ("POST", ["v1", "ai", "text"]) => {
            ensure_agent_scope(client, AgentScope::Operate)?;
            handle_text_request(request, context, client).await
        }
        ("POST", ["v1", "ai", "image"]) => {
            ensure_agent_scope(client, AgentScope::Operate)?;
            handle_image_request(request, context, client).await
        }
        _ => Ok(json_error(404, "Unknown launcher API route")),
    }
}

async fn handle_create_integration_draft_request(
    request: &HttpRequest,
) -> Result<IntegrationDraftCreateResponse, AppError> {
    let payload: IntegrationDraftCreateRequest = parse_json_body(request)?;
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Integration draft name is required".to_string(),
        ));
    }

    let id = match payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(id) => id.to_string(),
        None => draft_id_from_name(name),
    };
    crate::domain::modules::downloader::validate_module_id(&id)?;

    let runtime_kind = payload
        .runtime_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("python")
        .to_ascii_lowercase();
    validate_draft_runtime_kind(&runtime_kind)?;

    let entry = payload
        .entry
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map_or_else(|| default_draft_entry(&runtime_kind), ToOwned::to_owned);
    validate_relative_draft_path(&entry)?;

    let drafts_root = integration_drafts_dir();
    let draft_dir = drafts_root.join(&id);
    if draft_dir.exists() {
        return Err(AppError::Validation(format!(
            "Integration draft {id} already exists"
        )));
    }

    tokio::fs::create_dir_all(&draft_dir)
        .await
        .map_err(|error| AppError::Io(format!("Failed to create draft directory: {error}")))?;
    let entry_path = draft_dir.join(&entry);
    if let Some(parent) = entry_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            AppError::Io(format!("Failed to create draft entry directory: {error}"))
        })?;
    }

    let manifest_path = draft_dir.join("axelate-module.toml");
    tokio::fs::write(
        &manifest_path,
        draft_manifest_text(
            &id,
            name,
            payload.description.as_deref().unwrap_or_default(),
            &runtime_kind,
            &entry,
        ),
    )
    .await
    .map_err(|error| AppError::Io(format!("Failed to write draft manifest: {error}")))?;
    tokio::fs::write(&entry_path, draft_entry_text(&runtime_kind))
        .await
        .map_err(|error| AppError::Io(format!("Failed to write draft entry: {error}")))?;
    tokio::fs::write(
        draft_dir.join("README.md"),
        format!("# {name}\n\nDraft integration created by Agent Control.\n"),
    )
    .await
    .map_err(|error| AppError::Io(format!("Failed to write draft README: {error}")))?;

    Ok(IntegrationDraftCreateResponse {
        ok: true,
        id,
        draft_dir: draft_dir.display().to_string(),
        manifest_path: manifest_path.display().to_string(),
        entry_path: entry_path.display().to_string(),
    })
}

pub(super) fn handle_agent_logs_request(request: &HttpRequest) -> Result<HttpResponse, AppError> {
    let query = parse_agent_logs_query(&request.path)?;
    let logs = match query.view_id.as_deref() {
        Some(view_id) => {
            crate::api::system::logs::get_console_logs(view_id.to_string(), query.since)?
        }
        None => Vec::new(),
    };
    let skip = logs.len().saturating_sub(query.limit);
    let logs = logs
        .into_iter()
        .skip(skip)
        .map(sanitize_agent_log_entry)
        .collect::<Vec<_>>();

    Ok(json_response(
        200,
        json!(AgentLogsResponse {
            ok: true,
            api_version: SDK_API_VERSION,
            view_id: query.view_id,
            since: query.since,
            limit: query.limit,
            logs,
        }),
    ))
}

fn integration_drafts_dir() -> PathBuf {
    crate::utils::paths::RUNTIME_DIR.join(INTEGRATION_DRAFTS_DIR_NAME)
}

pub(super) fn draft_id_from_name(name: &str) -> String {
    let mut id = String::with_capacity(name.len());
    let mut last_was_dash = false;
    for character in name.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            id.push(character);
            last_was_dash = false;
        } else if !last_was_dash {
            id.push('-');
            last_was_dash = true;
        }
    }
    let id = id.trim_matches('-');
    if id.is_empty() {
        format!(
            "draft-{}",
            &hex::encode(sha2::Sha256::digest(name.as_bytes()))[..12]
        )
    } else {
        id.to_string()
    }
}

pub(super) fn validate_draft_runtime_kind(kind: &str) -> Result<(), AppError> {
    match kind {
        "python" | "node" | "bun" => Ok(()),
        _ => Err(AppError::Validation(format!(
            "Unsupported draft runtime kind: {kind}"
        ))),
    }
}

pub(super) fn validate_relative_draft_path(path: &str) -> Result<(), AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Validation(
            "Draft entry path cannot be empty".to_string(),
        ));
    }
    let path = Path::new(path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(AppError::Validation(
            "Draft entry path must stay inside the draft directory".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn default_draft_entry(runtime_kind: &str) -> String {
    match runtime_kind {
        "node" => "src/main.js",
        "bun" => "src/main.ts",
        _ => "src/main.py",
    }
    .to_string()
}

pub(super) fn draft_manifest_text(
    id: &str,
    name: &str,
    description: &str,
    runtime_kind: &str,
    entry: &str,
) -> String {
    format!(
        r#"api_version = "1"
id = "{}"
name = "{}"
version = "0.1.0"
description = "{}"
type = "service"

[runtime]
kind = "{}"
entry = "{}"
"#,
        escape_toml_string(id),
        escape_toml_string(name),
        escape_toml_string(description),
        escape_toml_string(runtime_kind),
        escape_toml_string(entry),
    )
}

fn draft_entry_text(runtime_kind: &str) -> &'static str {
    match runtime_kind {
        "node" | "bun" => "console.log('Axelate draft integration started');\n",
        _ => "print('Axelate draft integration started')\n",
    }
}

pub(super) fn escape_toml_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

pub(super) fn sanitize_agent_log_entry(mut entry: LogEntry) -> LogEntry {
    entry.source = redact_sensitive_log_text(&entry.source);
    entry.level = redact_sensitive_log_text(&entry.level);
    entry.message = redact_sensitive_log_text(&entry.message);
    entry.display_time = entry.display_time.as_deref().map(redact_sensitive_log_text);
    entry.normalized_level = entry
        .normalized_level
        .as_deref()
        .map(redact_sensitive_log_text);
    entry.scope = entry.scope.as_deref().map(redact_sensitive_log_text);
    entry.summary_message = entry
        .summary_message
        .as_deref()
        .map(redact_sensitive_log_text);
    entry.source_label = entry.source_label.as_deref().map(redact_sensitive_log_text);
    entry.source_class = entry.source_class.as_deref().map(redact_sensitive_log_text);
    entry.page = entry.page.as_deref().map(redact_sensitive_log_text);
    entry.action = entry.action.as_deref().map(redact_sensitive_log_text);
    entry.expected = entry.expected.as_deref().map(redact_sensitive_log_text);
    entry
}

pub(super) fn redact_sensitive_log_text(input: &str) -> String {
    let with_assignments = redact_sensitive_assignments(input);
    redact_bearer_tokens(&with_assignments)
}

fn redact_sensitive_assignments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        let Some(byte) = bytes.get(index).copied() else {
            break;
        };
        if !is_key_char(byte) {
            if let Some(character) = input[index..].chars().next() {
                output.push(character);
                index += character.len_utf8();
            } else {
                break;
            }
            continue;
        }

        let key_start = index;
        while bytes.get(index).copied().is_some_and(is_key_char) {
            index += 1;
        }
        let key_end = index;
        let mut cursor = skip_ascii_spaces(bytes, index);
        let Some(delimiter) = bytes
            .get(cursor)
            .copied()
            .filter(|byte| matches!(byte, b':' | b'='))
        else {
            output.push_str(&input[key_start..key_end]);
            continue;
        };

        cursor += 1;
        cursor = skip_ascii_spaces(bytes, cursor);

        if !is_sensitive_key(&input[key_start..key_end]) {
            output.push_str(&input[key_start..cursor]);
            index = cursor;
            continue;
        }

        output.push_str(&input[key_start..key_end]);
        output.push_str(&input[key_end..cursor]);

        let quote = bytes
            .get(cursor)
            .copied()
            .filter(|byte| matches!(byte, b'"' | b'\''));
        if quote.is_some() {
            if let Some(byte) = bytes.get(cursor).copied() {
                output.push(char::from(byte));
            }
            cursor += 1;
        }

        output.push_str("[REDACTED]");
        cursor = skip_sensitive_value(bytes, cursor, quote, delimiter);
        if let Some(quote_byte) = quote
            && bytes.get(cursor).is_some_and(|byte| *byte == quote_byte)
        {
            output.push(char::from(quote_byte));
            cursor += 1;
        }
        index = cursor;
    }

    output
}

fn redact_bearer_tokens(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let mut index = 0;

    while let Some(relative) = lower[index..].find("bearer ") {
        let marker_start = index + relative;
        let token_start = marker_start + "bearer ".len();
        output.push_str(&input[index..token_start]);

        let token_end = input
            .as_bytes()
            .get(token_start..)
            .unwrap_or_default()
            .iter()
            .position(|byte| is_bearer_token_delimiter(*byte))
            .map_or(input.len(), |position| token_start + position);

        if token_end > token_start {
            output.push_str("[REDACTED]");
        }
        index = token_end;
    }

    output.push_str(&input[index..]);
    output
}

const fn is_key_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
}

fn skip_ascii_spaces(bytes: &[u8], mut index: usize) -> usize {
    while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
        index += 1;
    }
    index
}

fn skip_sensitive_value(bytes: &[u8], mut index: usize, quote: Option<u8>, delimiter: u8) -> usize {
    if quote.is_none()
        && starts_with_ascii_case_insensitive(bytes.get(index..).unwrap_or_default(), b"bearer ")
    {
        index += "bearer".len();
        index = skip_ascii_spaces(bytes, index);
        while bytes
            .get(index)
            .copied()
            .is_some_and(|byte| !is_bearer_token_delimiter(byte))
        {
            index += 1;
        }
        return index;
    }

    while index < bytes.len() {
        let Some(byte) = bytes.get(index).copied() else {
            break;
        };
        if quote.is_some_and(|quote| byte == quote) {
            break;
        }
        if quote.is_none()
            && (byte.is_ascii_whitespace()
                || matches!(byte, b',' | b'}' | b']')
                || (delimiter == b'=' && byte == b'&'))
        {
            break;
        }
        index += 1;
    }
    index
}

fn starts_with_ascii_case_insensitive(value: &[u8], expected: &[u8]) -> bool {
    value.len() >= expected.len()
        && value
            .iter()
            .zip(expected.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect::<String>();
    matches!(
        normalized.as_str(),
        "apikey" | "authorization" | "auth" | "password" | "secret" | "token" | "key"
    ) || normalized.ends_with("apikey")
        || normalized.ends_with("key")
        || normalized.ends_with("token")
        || normalized.ends_with("secret")
        || normalized.ends_with("password")
}

const fn is_bearer_token_delimiter(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'"' | b'\'' | b',' | b'}' | b']' | b')')
}

async fn handle_agent_approvals_request(
    context: &LauncherHttpApiContext,
) -> Result<HttpResponse, AppError> {
    let state = context
        .agent_control_service
        .state(api_base_url().to_string())
        .await?;
    Ok(json_response(
        200,
        json!({ "ok": true, "approvals": state.approvals }),
    ))
}

async fn handle_agent_approval_request(
    request: &HttpRequest,
    context: &LauncherHttpApiContext,
    agent: &crate::domain::agent_control::AuthorizedAgent,
) -> Result<HttpResponse, AppError> {
    let payload: IntegrationAgentApprovalRequest = parse_json_body(request)?;
    let action = normalize_approval_field("action", payload.action.trim(), 96)?;
    let target = normalize_approval_field("target", payload.target.trim(), 160)?;
    let diff = normalize_approval_field("diff", payload.diff.trim(), 4_000)?;
    let risk = normalize_approval_risk(payload.risk.trim())?;
    if !is_dangerous_approval_action(&action) && risk != "dangerous" {
        return Ok(json_error(
            400,
            "Approval requests are reserved for dangerous or high-risk actions",
        ));
    }

    let approval = context
        .agent_control_service
        .create_approval_request(agent, action, target, diff, risk)
        .await?;
    if let Err(error) = context.app.emit(
        "agent-control:state-changed",
        json!({
            "reason": "approval-request-created",
            "approvalId": approval.id,
        }),
    ) {
        tracing::warn!("Failed to emit Agent Control state change: {error}");
    }
    record_agent_audit(
        context,
        &AuthorizedClient::Agent(agent.clone()),
        "approval.request".to_string(),
        approval.target.clone(),
        "pending-approval".to_string(),
    )
    .await;

    Ok(json_response(
        202,
        json!(AgentApprovalCreatedResponse { ok: true, approval }),
    ))
}

fn handle_agent_capabilities_request(client: &AuthorizedClient) -> HttpResponse {
    json_response(
        200,
        json!({
            "ok": true,
            "apiVersion": SDK_API_VERSION,
            "auth": {
                "actorId": client.actor_id(),
                "actorName": client.actor_name(),
                "scopes": granted_agent_scopes(client),
            },
            "endpoints": {
                "observe": [
                    "GET /v1/health",
                    "GET /v1/agent/capabilities",
                    "GET /v1/agent/state",
                    "GET /v1/agent/logs?viewId=<console-view-id>",
                    "GET /v1/modules",
                    "GET /v1/modules/:id/status",
                    "GET /v1/modules/:id/context"
                ],
                "operate": [
                    "POST /v1/launcher/open-page",
                    "POST /v1/launcher/select-module",
                    "POST /v1/modules/:id/start",
                    "POST /v1/modules/:id/stop",
                    "POST /v1/modules/:id/restart",
                    "POST /v1/ai/text",
                    "POST /v1/ai/image"
                ],
                "configure": [
                    "GET /v1/modules/:id/settings",
                    "PATCH /v1/modules/:id/settings",
                    "POST /v1/modules/:id/stage"
                ],
                "draftCreate": [
                    "POST /v1/integration-drafts"
                ],
                "approval": [
                    "GET /v1/agent/approvals",
                    "POST /v1/agent/approval-requests"
                ]
            },
            "safety": {
                "loopbackOnly": true,
                "secretsRedacted": true,
                "rawLogsBlocked": true,
                "fullSettingsReplacementBlocked": true,
                "dangerousActionsRequireApproval": [
                    "install",
                    "delete",
                    "uninstall",
                    "update",
                    "secret",
                    "raw-log",
                    "filesystem",
                    "network-permission"
                ]
            }
        }),
    )
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentApprovalCreatedResponse {
    ok: bool,
    approval: AgentApprovalRequest,
}

#[derive(Debug)]
struct AgentOpenPageResponse {
    page_id: String,
}

#[derive(Debug)]
struct AgentSelectModuleResponse {
    category: String,
    module: SelectedModule,
}

async fn handle_open_page_request(
    request: &HttpRequest,
    context: &LauncherHttpApiContext,
) -> Result<AgentOpenPageResponse, AppError> {
    let payload: IntegrationOpenPageRequest = parse_json_body(request)?;
    let page_id = payload.page_id.trim();
    validate_agent_page_id(page_id)?;

    let mut ui_state = context.ui_state_service.get_ui_state().await?;
    ui_state.last_page = Some(page_id.to_string());
    context.ui_state_service.save_ui_state(&ui_state).await?;

    if let Err(error) = context.app.emit(
        "agent-control:open-page",
        AgentOpenPageEvent {
            page_id: page_id.to_string(),
            source: "agent-control",
        },
    ) {
        tracing::warn!("Failed to emit Agent Control page open request: {error}");
    }

    Ok(AgentOpenPageResponse {
        page_id: page_id.to_string(),
    })
}

async fn handle_select_module_request(
    request: &HttpRequest,
    context: &LauncherHttpApiContext,
) -> Result<AgentSelectModuleResponse, AppError> {
    let payload: IntegrationSelectModuleRequest = parse_json_body(request)?;
    let category = payload.category.trim();
    let module_id = payload.module_id.trim();
    validate_agent_selection_category(category)?;
    crate::domain::modules::downloader::validate_module_id(module_id)?;

    let module = match resolve_selectable_module(&context.config_service, module_id) {
        Ok(module) => module,
        Err(_) => resolve_runtime_selected_module(module_id).await?,
    };
    validate_selected_module_category(&context.config_service, category, module_id, &module)
        .await?;
    let mut ui_state = context.ui_state_service.get_ui_state().await?;
    ui_state
        .selected_modules
        .insert(category.to_string(), module.clone());
    context.ui_state_service.save_ui_state(&ui_state).await?;

    if let Err(error) = context.app.emit(
        "ui-state:selected-module-changed",
        json!({
            "category": category,
            "module": module,
            "source": "agent-control",
        }),
    ) {
        tracing::warn!("Failed to emit Agent Control selected module change: {error}");
    }

    Ok(AgentSelectModuleResponse {
        category: category.to_string(),
        module,
    })
}

pub(super) fn parse_agent_logs_query(path: &str) -> Result<AgentLogsQuery, AppError> {
    let mut result = AgentLogsQuery {
        view_id: None,
        since: 0.0,
        limit: AGENT_LOGS_DEFAULT_LIMIT,
    };
    let query = path.split_once('?').map_or("", |(_, query)| query);

    for pair in query.split('&').filter(|pair| !pair.trim().is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key.trim() {
            "viewId" | "view_id" => {
                let decoded = percent_decode_query_value(value.trim())?;
                result.view_id = Some(decoded).filter(|value| !value.is_empty());
            }
            "since" => {
                result.since = parse_non_negative_f64("since", value)?;
            }
            "limit" => {
                result.limit = parse_agent_logs_limit(value)?;
            }
            _ => {}
        }
    }

    Ok(result)
}

fn percent_decode_query_value(value: &str) -> Result<String, AppError> {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let Some(byte) = bytes.get(index).copied() else {
            break;
        };
        match byte {
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            b'%' => {
                let Some(hex) = value.get(index + 1..index + 3) else {
                    return Err(AppError::Validation(
                        "Query parameter contains incomplete percent encoding".to_string(),
                    ));
                };
                let byte = u8::from_str_radix(hex, 16).map_err(|_| {
                    AppError::Validation(
                        "Query parameter contains invalid percent encoding".to_string(),
                    )
                })?;
                output.push(byte);
                index += 3;
            }
            _ => {
                if let Some(character) = value[index..].chars().next() {
                    let mut buffer = [0; 4];
                    output.extend_from_slice(character.encode_utf8(&mut buffer).as_bytes());
                    index += character.len_utf8();
                } else {
                    break;
                }
            }
        }
    }
    String::from_utf8(output).map_err(|_| {
        AppError::Validation("Query parameter is not valid UTF-8 after decoding".to_string())
    })
}

fn parse_non_negative_f64(name: &str, value: &str) -> Result<f64, AppError> {
    let parsed = value
        .trim()
        .parse::<f64>()
        .map_err(|error| AppError::Validation(format!("Invalid {name}: {error}")))?;
    if parsed.is_finite() && parsed >= 0.0 {
        Ok(parsed)
    } else {
        Err(AppError::Validation(format!(
            "Invalid {name}: expected a non-negative finite number"
        )))
    }
}

fn parse_agent_logs_limit(value: &str) -> Result<usize, AppError> {
    let parsed = value
        .trim()
        .parse::<usize>()
        .map_err(|error| AppError::Validation(format!("Invalid limit: {error}")))?;
    if parsed == 0 {
        return Err(AppError::Validation(
            "Invalid limit: expected a positive number".to_string(),
        ));
    }

    Ok(parsed.min(AGENT_LOGS_MAX_LIMIT))
}

async fn handle_agent_state_request(
    context: &LauncherHttpApiContext,
) -> Result<HttpResponse, AppError> {
    let config = context.config_service.load_full_config()?;
    let ui_state = context.ui_state_service.get_ui_state().await?;
    let modules = module_controller::get_all_modules()
        .await
        .into_iter()
        .map(agent_module_summary)
        .collect::<Vec<_>>();
    let providers = config
        .api_providers
        .iter()
        .map(agent_provider_summary)
        .collect::<Vec<_>>();
    let engine_state = context.engine_manager.state().await;

    Ok(json_response(
        200,
        json!(AgentLauncherStateResponse {
            ok: true,
            api_version: SDK_API_VERSION,
            selected_modules: ui_state.selected_modules,
            modules,
            providers,
            engine_state,
        }),
    ))
}

fn agent_module_summary(module: crate::models::Module) -> AgentModuleSummary {
    AgentModuleSummary {
        id: module.id,
        name: module.name,
        category: module.category,
        installed: module.installed,
        enabled: module.enabled,
        status: module.status,
    }
}

pub(super) fn agent_provider_summary(provider: &ApiProvider) -> AgentProviderSummary {
    AgentProviderSummary {
        id: provider.id.clone(),
        name: provider.name.clone(),
        provider_type: provider
            .provider_type
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok())
            .and_then(|value| value.as_str().map(ToOwned::to_owned)),
        capabilities: provider.capabilities.clone().unwrap_or_default(),
        models: provider
            .models
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|model| AgentModelSummary {
                id: model.id.clone(),
                name: model.name.clone(),
                capabilities: model.capabilities.clone(),
            })
            .collect(),
    }
}

pub(super) fn modules_visible_to_client(
    mut modules: Vec<crate::models::Module>,
    client: &AuthorizedClient,
) -> Vec<crate::models::Module> {
    if let AuthorizedClient::Module(module_id) = client {
        modules.retain(|module| module.id == *module_id);
    }
    modules
}

fn handle_module_context_request(module_id: &str) -> Result<HttpResponse, AppError> {
    ensure_installed_module_id(module_id)?;
    let module_dir = crate::domain::modules::downloader::get_module_path(module_id);
    let module_runtime_dir = module_paths::runtime_root(module_id);
    let module_log_dir = module_paths::log_dir(module_id);

    Ok(json_response(
        200,
        json!(ModuleContextApiResponse {
            ok: true,
            api_version: SDK_API_VERSION,
            module_id: module_id.to_string(),
            module_dir: module_dir.display().to_string(),
            runtime_dir: crate::utils::paths::RUNTIME_DIR.display().to_string(),
            module_runtime_dir: module_runtime_dir.display().to_string(),
            module_log_dir: module_log_dir.display().to_string(),
            http_api_base: api_base_url().to_string(),
        }),
    ))
}

async fn handle_get_module_settings_request(
    context: &LauncherHttpApiContext,
    module_id: &str,
) -> Result<HttpResponse, AppError> {
    ensure_installed_module_id(module_id)?;
    let settings = sanitize_agent_module_settings(
        context
            .settings_service
            .get_module_settings(module_id)
            .await?,
    );

    Ok(json_response(
        200,
        json!({ "ok": true, "moduleId": module_id, "settings": settings }),
    ))
}

pub(super) fn sanitize_agent_module_settings(
    settings: HashMap<String, serde_json::Value>,
) -> HashMap<String, serde_json::Value> {
    settings
        .into_iter()
        .map(|(key, value)| {
            let value = if is_sensitive_key(&key) {
                serde_json::Value::String("[REDACTED]".to_string())
            } else {
                sanitize_agent_setting_value(value)
            };
            (key, value)
        })
        .collect()
}

fn sanitize_agent_setting_value(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    let value = if is_sensitive_key(&key) {
                        serde_json::Value::String("[REDACTED]".to_string())
                    } else {
                        sanitize_agent_setting_value(value)
                    };
                    (key, value)
                })
                .collect(),
        ),
        serde_json::Value::Array(values) => serde_json::Value::Array(
            values
                .into_iter()
                .map(sanitize_agent_setting_value)
                .collect(),
        ),
        value => value,
    }
}

pub(super) fn ensure_agent_settings_update_is_safe(
    settings: &HashMap<String, serde_json::Value>,
) -> Result<(), AppError> {
    for (key, value) in settings {
        ensure_agent_setting_key_is_safe(key)?;
        ensure_agent_setting_value_is_safe(value)?;
    }
    Ok(())
}

fn ensure_agent_setting_value_is_safe(value: &serde_json::Value) -> Result<(), AppError> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                ensure_agent_setting_key_is_safe(key)?;
                ensure_agent_setting_value_is_safe(value)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                ensure_agent_setting_value_is_safe(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn ensure_agent_setting_key_is_safe(key: &str) -> Result<(), AppError> {
    if is_sensitive_key(key) {
        return Err(AppError::PermissionDenied(format!(
            "Agent API cannot read or change sensitive module setting: {key}"
        )));
    }
    Ok(())
}

fn handle_put_module_settings_request(
    _request: &HttpRequest,
    _context: &LauncherHttpApiContext,
    _module_id: &str,
) -> Result<HttpResponse, AppError> {
    Err(AppError::PermissionDenied(
        "Full module settings replacement is not allowed through Agent API; use PATCH for safe settings"
            .to_string(),
    ))
}

async fn handle_patch_module_settings_request(
    request: &HttpRequest,
    context: &LauncherHttpApiContext,
    module_id: &str,
) -> Result<HttpResponse, AppError> {
    ensure_installed_module_id(module_id)?;
    let updates: HashMap<String, serde_json::Value> = parse_json_body(request)?;
    ensure_agent_settings_update_is_safe(&updates)?;
    let mut settings = context
        .settings_service
        .get_module_settings(module_id)
        .await?;
    merge_json_settings(&mut settings, updates);
    context
        .settings_service
        .save_module_settings(module_id, &settings)
        .await?;

    Ok(json_response(
        200,
        json!({
            "ok": true,
            "moduleId": module_id,
            "settings": sanitize_agent_module_settings(settings),
        }),
    ))
}

pub(super) fn merge_json_settings(
    settings: &mut HashMap<String, serde_json::Value>,
    updates: HashMap<String, serde_json::Value>,
) {
    for (key, update) in updates {
        match settings.get_mut(&key) {
            Some(existing) => merge_json_value(existing, update),
            None => {
                settings.insert(key, update);
            }
        }
    }
}

fn merge_json_value(target: &mut serde_json::Value, update: serde_json::Value) {
    match (target, update) {
        (serde_json::Value::Object(target), serde_json::Value::Object(update)) => {
            for (key, value) in update {
                match target.get_mut(&key) {
                    Some(existing) => merge_json_value(existing, value),
                    None => {
                        target.insert(key, value);
                    }
                }
            }
        }
        (target, update) => {
            *target = update;
        }
    }
}

fn ensure_installed_module_id(module_id: &str) -> Result<(), AppError> {
    crate::domain::modules::downloader::validate_module_id(module_id)?;
    if crate::domain::modules::downloader::is_module_installed(module_id) {
        Ok(())
    } else {
        Err(AppError::NotFound(format!(
            "Module {module_id} is not installed"
        )))
    }
}

pub(super) fn ensure_module_route_owner(
    client: &AuthorizedClient,
    module_id: &str,
) -> Result<(), AppError> {
    match client {
        AuthorizedClient::Launcher | AuthorizedClient::Agent(_) => Ok(()),
        AuthorizedClient::Module(owner_id) if owner_id == module_id => Ok(()),
        AuthorizedClient::Module(_) => Err(AppError::PermissionDenied(
            "Integration token cannot access another integration".to_string(),
        )),
    }
}

pub(super) fn ensure_launcher_client(client: &AuthorizedClient) -> Result<(), AppError> {
    match client {
        AuthorizedClient::Launcher | AuthorizedClient::Agent(_) => Ok(()),
        AuthorizedClient::Module(_) => Err(AppError::PermissionDenied(
            "Integration token cannot access launcher-wide agent state".to_string(),
        )),
    }
}

fn ensure_agent_scope(client: &AuthorizedClient, scope: AgentScope) -> Result<(), AppError> {
    match client {
        AuthorizedClient::Launcher | AuthorizedClient::Module(_) => Ok(()),
        AuthorizedClient::Agent(agent)
            if agent.scopes.contains(&scope) || agent.scopes.contains(&AgentScope::FullAccess) =>
        {
            Ok(())
        }
        AuthorizedClient::Agent(_) => Err(AppError::PermissionDenied(format!(
            "Agent token is missing required scope: {scope:?}"
        ))),
    }
}

fn granted_agent_scopes(client: &AuthorizedClient) -> Vec<AgentScope> {
    match client {
        AuthorizedClient::Agent(agent) => agent.scopes.clone(),
        AuthorizedClient::Launcher => vec![AgentScope::FullAccess],
        AuthorizedClient::Module(_) => Vec::new(),
    }
}

fn ensure_profile_agent(
    client: &AuthorizedClient,
) -> Result<&crate::domain::agent_control::AuthorizedAgent, AppError> {
    match client {
        AuthorizedClient::Agent(agent) => Ok(agent),
        AuthorizedClient::Launcher | AuthorizedClient::Module(_) => {
            Err(AppError::PermissionDenied(
                "Approval requests require an agent profile token".to_string(),
            ))
        }
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

pub(super) fn parse_module_action(action: &str) -> Result<ModuleAction, AppError> {
    match action {
        "start" => Ok(ModuleAction::Start),
        "stop" => Ok(ModuleAction::Stop),
        "restart" => Ok(ModuleAction::Restart),
        "repair" => Ok(ModuleAction::Repair),
        _ => Err(AppError::Validation(format!(
            "Unsupported module action: {action}"
        ))),
    }
}

const fn module_action_name(action: ModuleAction) -> &'static str {
    match action {
        ModuleAction::Start => "start",
        ModuleAction::Stop => "stop",
        ModuleAction::Restart => "restart",
        ModuleAction::Repair => "repair",
        ModuleAction::Install => "install",
        ModuleAction::Uninstall => "uninstall",
        ModuleAction::Update => "update",
    }
}

pub(super) fn normalize_approval_field(
    field: &str,
    value: &str,
    max_len: usize,
) -> Result<String, AppError> {
    if value.is_empty() {
        return Err(AppError::Validation(format!(
            "Agent approval {field} cannot be empty"
        )));
    }
    if value.len() > max_len {
        return Err(AppError::Validation(format!(
            "Agent approval {field} is too long"
        )));
    }
    Ok(value.to_string())
}

pub(super) fn normalize_approval_risk(value: &str) -> Result<String, AppError> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "high" | "dangerous" => Ok(normalized),
        "medium" | "low" | "" => Err(AppError::Validation(
            "Agent approval risk must be high or dangerous".to_string(),
        )),
        _ => Err(AppError::Validation(format!(
            "Unsupported agent approval risk: {value}"
        ))),
    }
}

pub(super) fn is_dangerous_approval_action(action: &str) -> bool {
    let normalized = action.to_ascii_lowercase();
    [
        "install",
        "delete",
        "remove",
        "uninstall",
        "update",
        "upgrade",
        "secret",
        "token",
        "raw-log",
        "raw_logs",
        "filesystem",
        "file-system",
        "network-permission",
        "permission",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

pub(super) fn audit_action_from_request(method: &str, path: &str) -> String {
    let normalized_path = path
        .split('?')
        .next()
        .unwrap_or(path)
        .trim_matches('/')
        .replace('/', ".");
    format!("http.{}.{}", method.to_ascii_lowercase(), normalized_path)
}

const fn audit_result_for_error(error: &AppError) -> &'static str {
    match error {
        AppError::PermissionDenied(_) | AppError::FrontendSecretForbidden(_) => "denied",
        AppError::Validation(_) => "rejected",
        AppError::NotFound(_) => "not-found",
        AppError::Io(_)
        | AppError::Serialization(_)
        | AppError::Config(_)
        | AppError::External { .. }
        | AppError::Internal { .. } => "failed",
    }
}

async fn record_agent_audit(
    context: &LauncherHttpApiContext,
    client: &AuthorizedClient,
    action: String,
    target: String,
    result: String,
) {
    if !matches!(
        client,
        AuthorizedClient::Launcher | AuthorizedClient::Agent(_)
    ) {
        return;
    }

    if let Err(error) = context
        .agent_control_service
        .record_audit(
            client.actor_id(),
            client.actor_name(),
            action,
            target,
            result,
        )
        .await
    {
        tracing::warn!("Failed to record agent audit entry: {error}");
    }
}

async fn handle_text_request(
    request: &HttpRequest,
    context: LauncherHttpApiContext,
    client: &AuthorizedClient,
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
        resolve_selected_provider_module(&context.config_service, &ui_provider)?;
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
    let session_id = resolve_session_id(payload.session_id.as_deref(), client);
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
        None => selected_thinking_level(&context.ui_state_service, &ui_provider).await?,
    };
    let web_search = match payload.web_search {
        Some(value) => Some(value),
        None => selected_web_search(&context.ui_state_service, &ui_provider).await?,
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
        cloud_api_base_url: None,
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
    client: &AuthorizedClient,
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
        resolve_selected_provider_module(&context.config_service, &ui_provider)?;
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
    let session_id = resolve_session_id(payload.session_id.as_deref(), client);
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

fn resolve_selected_provider_module(
    config_service: &crate::domain::system::config_service::ConfigService,
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

fn resolve_selectable_module(
    config_service: &crate::domain::system::config_service::ConfigService,
    module_id: &str,
) -> Result<SelectedModule, AppError> {
    resolve_selected_provider_module(config_service, module_id)
}

async fn resolve_runtime_selected_module(module_id: &str) -> Result<SelectedModule, AppError> {
    module_controller::get_all_modules()
        .await
        .into_iter()
        .find(|module| module.id == module_id)
        .map(|module| selected_module_from_runtime_module(&module))
        .ok_or_else(|| AppError::Validation(format!("Unknown selectable module: {module_id}")))
}

fn validate_agent_page_id(page_id: &str) -> Result<(), AppError> {
    if page_id.is_empty() {
        return Err(AppError::Validation("Page id cannot be empty".to_string()));
    }
    if !page_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err(AppError::Validation(
            "Page id contains invalid characters".to_string(),
        ));
    }
    Ok(())
}

fn validate_agent_selection_category(category: &str) -> Result<(), AppError> {
    match category {
        "ai_text" | "ai_image" | "services" => Ok(()),
        _ => Err(AppError::Validation(format!(
            "Unsupported selected module category: {category}"
        ))),
    }
}

async fn validate_selected_module_category(
    config_service: &crate::domain::system::config_service::ConfigService,
    category: &str,
    module_id: &str,
    module: &SelectedModule,
) -> Result<(), AppError> {
    let expected =
        selection_category_for_selected_module(config_service, module_id, module).await?;
    if expected == category {
        return Ok(());
    }

    Err(AppError::Validation(format!(
        "Module {module_id} belongs to {expected}, not {category}"
    )))
}

async fn selection_category_for_selected_module(
    config_service: &crate::domain::system::config_service::ConfigService,
    module_id: &str,
    module: &SelectedModule,
) -> Result<&'static str, AppError> {
    let config = config_service.load_full_config()?;
    if let Some(item) = config
        .catalog
        .services
        .iter()
        .find(|item| item.id == module_id)
    {
        return Ok(selection_category_for_catalog_item(item));
    }
    if let Some(item) = config.catalog.ai.iter().find(|item| item.id == module_id) {
        return Ok(selection_category_for_catalog_item(item));
    }
    if let Some(provider) = config
        .api_providers
        .iter()
        .find(|provider| provider.id == module_id)
    {
        return Ok(selection_category_for_provider(provider));
    }

    if module_id == CUSTOM_TEXT_PROVIDER_ID {
        return Ok("ai_text");
    }
    if module_id == CUSTOM_IMAGE_PROVIDER_ID {
        return Ok("ai_image");
    }

    module_controller::get_all_modules()
        .await
        .into_iter()
        .find(|candidate| candidate.id == module.id)
        .map(|runtime_module| selection_category_for_runtime_module(&runtime_module))
        .ok_or_else(|| AppError::Validation(format!("Unknown selectable module: {module_id}")))
}

fn selection_category_for_catalog_item(item: &ModuleItem) -> &'static str {
    if item.type_name.trim().eq_ignore_ascii_case("service") {
        return "services";
    }
    selection_category_for_capabilities(&item.capabilities)
}

fn selection_category_for_provider(provider: &ApiProvider) -> &'static str {
    provider
        .capabilities
        .as_deref()
        .map_or("ai_text", selection_category_for_capabilities)
}

pub(super) fn selection_category_for_capabilities(capabilities: &[String]) -> &'static str {
    let has_image = capabilities
        .iter()
        .any(|capability| capability.trim().eq_ignore_ascii_case("image"));
    let has_text = capabilities
        .iter()
        .any(|capability| capability.trim().eq_ignore_ascii_case("text"));
    if has_image && !has_text {
        "ai_image"
    } else {
        "ai_text"
    }
}

pub(super) fn selected_module_from_catalog_item(module: &ModuleItem) -> SelectedModule {
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

pub(super) fn selected_module_from_runtime_module(module: &Module) -> SelectedModule {
    SelectedModule {
        id: module.id.clone(),
        name: module.name.clone(),
        name_key: None,
        icon: module.icon.clone(),
        type_: "local".to_string(),
        desc_key: None,
        desc: module.description.clone(),
    }
}

pub(super) fn selected_module_from_api_provider(provider: &ApiProvider) -> SelectedModule {
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

pub(super) fn selection_category_for_runtime_module(module: &Module) -> &'static str {
    if module.category.trim().eq_ignore_ascii_case("ai") {
        "ai_text"
    } else {
        "services"
    }
}

pub(super) fn backend_provider_id(provider_id: &str) -> &str {
    match provider_id {
        CUSTOM_TEXT_PROVIDER_ID => CUSTOM_TEXT_BACKEND_PROVIDER_ID,
        CUSTOM_IMAGE_PROVIDER_ID => CUSTOM_IMAGE_BACKEND_PROVIDER_ID,
        _ => provider_id,
    }
}

async fn sync_launcher_selected_module(
    context: &LauncherHttpApiContext,
    client: &AuthorizedClient,
    module_id: &str,
) -> Result<(), AppError> {
    if matches!(client, AuthorizedClient::Module(_)) {
        return Ok(());
    }

    let Some(module) = module_controller::get_all_modules()
        .await
        .into_iter()
        .find(|module| module.id == module_id)
    else {
        tracing::warn!("Started module {module_id} but could not find it for UI selection sync");
        return Ok(());
    };

    let category = selection_category_for_runtime_module(&module);
    let selected_module = selected_module_from_runtime_module(&module);
    let mut state = context.ui_state_service.get_ui_state().await?;
    state
        .selected_modules
        .insert(category.to_string(), selected_module.clone());
    context.ui_state_service.save_ui_state(&state).await?;

    if let Err(error) = context.app.emit(
        "ui-state:selected-module-changed",
        json!({
            "category": category,
            "module": selected_module,
            "source": "integration-api"
        }),
    ) {
        tracing::warn!("Failed to emit selected module change for {module_id}: {error}");
    }

    Ok(())
}

fn is_custom_provider_id(provider_id: &str) -> bool {
    matches!(
        provider_id,
        CUSTOM_TEXT_PROVIDER_ID | CUSTOM_IMAGE_PROVIDER_ID
    )
}

async fn selected_module_id(
    ui_state_service: &crate::infrastructure::config::ui_state::UiStateService,
    category: &str,
) -> Result<Option<String>, AppError> {
    let state = ui_state_service.get_ui_state().await?;
    Ok(state
        .selected_modules
        .get(category)
        .map(|module| module.id.trim().to_string())
        .filter(|value| !value.is_empty()))
}

pub(super) fn resolve_session_id(
    requested: Option<&str>,
    client: &AuthorizedClient,
) -> Option<String> {
    if let Some(session_id) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return Some(session_id.to_string());
    }

    match client {
        AuthorizedClient::Module(module_id) => Some(format!("integration:{module_id}")),
        AuthorizedClient::Launcher | AuthorizedClient::Agent(_) => None,
    }
}

async fn selected_thinking_level(
    ui_state_service: &crate::infrastructure::config::ui_state::UiStateService,
    provider_id: &str,
) -> Result<Option<String>, AppError> {
    let state = ui_state_service.get_ui_state().await?;
    Ok(state
        .ai_thinking_level
        .get(provider_id)
        .cloned()
        .filter(|value| !value.trim().is_empty()))
}

async fn selected_web_search(
    ui_state_service: &crate::infrastructure::config::ui_state::UiStateService,
    provider_id: &str,
) -> Result<Option<WebSearchOptions>, AppError> {
    let state = ui_state_service.get_ui_state().await?;
    let enabled = state
        .ai_web_search_enabled
        .get(provider_id)
        .copied()
        .unwrap_or(false);

    Ok(enabled.then_some(WebSearchOptions {
        enabled,
        ..WebSearchOptions::default()
    }))
}

async fn resolve_model_id(
    config_service: &crate::domain::system::config_service::ConfigService,
    ui_state_service: &crate::infrastructure::config::ui_state::UiStateService,
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
    let selected_model = match ui_provider_id {
        Some(id) => state.selected_ai_models.get(id),
        None => state.selected_ai_models.get(provider_id),
    }
    .cloned();
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
        .max_by_key(|model| {
            (
                tier_rank(&model.tier),
                u16::from(model.stats.logic) + u16::from(model.stats.creative),
                model.stats.speed,
            )
        })
        .and_then(|model| model_api_id(model, capability).or_else(|| Some(model.id.clone())))
}

pub(super) fn model_api_id(model: &AiModel, capability: &str) -> Option<String> {
    let api_models = model.api_models.as_ref()?;
    match capability {
        "image" => api_models.image.clone().or_else(|| api_models.text.clone()),
        _ => api_models.text.clone(),
    }
    .filter(|value| !value.trim().is_empty())
}

pub(super) const fn tier_rank(tier: &ModelTier) -> u8 {
    match tier {
        ModelTier::Weak => 0,
        ModelTier::Medium => 1,
        ModelTier::Strong => 2,
    }
}
