//! Route dispatch and request handlers for the local integration API.

use crate::domain::agent_control::{AgentApprovalRequest, AgentScope};
use crate::domain::ai::ai_service;
use crate::domain::ai::types::{
    ChatMessage, ChatRequest, ImageGenerationRequest, WebSearchOptions,
};
use crate::domain::modules::controller::{self as module_controller, ModuleAction};
use crate::domain::modules::paths as module_paths;
use crate::errors::AppError;
use crate::models::{
    AiModel, ApiProvider, ModelTier, Module, ModuleItem, ProviderType, SelectedModule,
};
use serde_json::json;
use std::collections::HashMap;
use std::net::SocketAddr;
use tauri::Emitter;

use super::auth::{authorize_request_with_agent_profiles, is_loopback_peer};
use super::http::{json_error, json_response, parse_json_body, request_path, status_for_app_error};
use super::types::{
    AgentLauncherStateResponse, AgentLogsResponse, AgentModelSummary, AgentModuleSummary,
    AgentOpenPageEvent, AgentProviderSummary, AuthorizedClient, HttpRequest, HttpResponse,
    ImageApiResponse, IntegrationAgentApprovalRequest, IntegrationImageRequest,
    IntegrationModuleStageRequest, IntegrationOpenPageRequest, IntegrationSelectModuleRequest,
    IntegrationTextRequest, ModuleContextApiResponse, ModuleStageChangedEvent, TextApiResponse,
};
use super::{LauncherHttpApiContext, SDK_API_VERSION, api_base_url};

const AGENT_LOGS_DEFAULT_LIMIT: usize = 200;
const AGENT_LOGS_MAX_LIMIT: usize = 1000;
const CUSTOM_TEXT_PROVIDER_ID: &str = "custom-text";
const CUSTOM_IMAGE_PROVIDER_ID: &str = "custom-image";
const CUSTOM_TEXT_BACKEND_PROVIDER_ID: &str = "gpt";
const CUSTOM_IMAGE_BACKEND_PROVIDER_ID: &str = "gpt-image";

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

    match route_authorized_request(path, &request, context, &client).await {
        Ok(response) => response,
        Err(error) => json_error(status_for_app_error(&error), &error.to_string()),
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
            let response = handle_put_module_settings_request(request, &context, module_id).await?;
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
            if response.success && matches!(action, ModuleAction::Start | ModuleAction::Restart) {
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

fn handle_agent_logs_request(request: &HttpRequest) -> Result<HttpResponse, AppError> {
    let query = parse_agent_logs_query(&request.path)?;
    let logs = match query.view_id.as_deref() {
        Some(view_id) => {
            crate::api::system::logs::get_console_logs(view_id.to_string(), query.since)?
        }
        None => crate::api::system::logs::get_logs(query.since)?,
    };
    let skip = logs.len().saturating_sub(query.limit);
    let logs = logs.into_iter().skip(skip).collect::<Vec<_>>();

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
    if payload.action.trim().is_empty()
        || payload.target.trim().is_empty()
        || payload.diff.trim().is_empty()
    {
        return Ok(json_error(
            400,
            "Agent approval requests require action, target, and diff",
        ));
    }

    let approval = context
        .agent_control_service
        .create_approval_request(
            agent,
            payload.action.trim().to_string(),
            payload.target.trim().to_string(),
            payload.diff.trim().to_string(),
            payload.risk.trim().to_string(),
        )
        .await?;
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
                result.view_id = Some(value.trim().to_string()).filter(|value| !value.is_empty());
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
    let settings = context
        .settings_service
        .get_module_settings(module_id)
        .await?;

    Ok(json_response(
        200,
        json!({ "ok": true, "moduleId": module_id, "settings": settings }),
    ))
}

async fn handle_put_module_settings_request(
    request: &HttpRequest,
    context: &LauncherHttpApiContext,
    module_id: &str,
) -> Result<HttpResponse, AppError> {
    ensure_installed_module_id(module_id)?;
    let settings: HashMap<String, serde_json::Value> = parse_json_body(request)?;
    context
        .settings_service
        .save_module_settings(module_id, &settings)
        .await?;

    Ok(json_response(
        200,
        json!({ "ok": true, "moduleId": module_id, "settings": settings }),
    ))
}

async fn handle_patch_module_settings_request(
    request: &HttpRequest,
    context: &LauncherHttpApiContext,
    module_id: &str,
) -> Result<HttpResponse, AppError> {
    ensure_installed_module_id(module_id)?;
    let updates: HashMap<String, serde_json::Value> = parse_json_body(request)?;
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
        json!({ "ok": true, "moduleId": module_id, "settings": settings }),
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
        AuthorizedClient::Agent(agent) if agent.scopes.contains(&scope) => Ok(()),
        AuthorizedClient::Agent(_) => Err(AppError::PermissionDenied(format!(
            "Agent token is missing required scope: {scope:?}"
        ))),
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
        ModuleAction::Install => "install",
        ModuleAction::Uninstall => "uninstall",
        ModuleAction::Update => "update",
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
