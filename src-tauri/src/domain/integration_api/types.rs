//! DTOs and internal types for the local launcher HTTP API.

use crate::domain::ai::types::{
    ChatMessage, ChatResponse, ImageGenerationResponse, WebSearchOptions,
};
use crate::domain::engine::types::EngineState;
use crate::infrastructure::logging::LogEntry;
use crate::models::{ModelCapabilities, SelectedModule};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex, mpsc};

use super::LauncherHttpApiContext;

// ── HTTP primitives ──────────────────────────────────────────────────────────

#[derive(Debug)]
pub(super) struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub(super) struct HttpResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

pub(super) struct ValidatedHttpRequest {
    pub stream: TcpStream,
    pub request: HttpRequest,
    pub context: LauncherHttpApiContext,
    pub peer_addr: Option<SocketAddr>,
}

pub(super) type HttpWorkerReceiver = Arc<Mutex<mpsc::Receiver<ValidatedHttpRequest>>>;

// ── Auth ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum AuthorizedClient {
    Launcher,
    Module(String),
}

// ── Integration request DTOs ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IntegrationTextRequest {
    pub prompt: Option<String>,
    pub messages: Option<Vec<ChatMessage>>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub thinking_level: Option<String>,
    pub web_search: Option<WebSearchOptions>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IntegrationImageRequest {
    pub prompt: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub settings_key: Option<String>,
    pub steps: Option<u32>,
    pub cfg_scale: Option<f32>,
    pub denoising_strength: Option<f32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub sampler: Option<String>,
    pub seed: Option<i32>,
    pub clip_skip: Option<i32>,
    pub negative_prompt: Option<String>,
    pub batch_size: Option<u32>,
    pub scheduler: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IntegrationModuleStageRequest {
    pub stage: String,
    pub label: String,
    pub details: Option<String>,
    pub progress: Option<f64>,
}

// ── Integration response DTOs ────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TextApiResponse {
    pub ok: bool,
    pub provider: String,
    pub model: Option<String>,
    pub response: ChatResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ImageApiResponse {
    pub ok: bool,
    pub provider: String,
    pub model: String,
    pub response: ImageGenerationResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModuleContextApiResponse {
    pub ok: bool,
    pub api_version: &'static str,
    pub module_id: String,
    pub module_dir: String,
    pub runtime_dir: String,
    pub module_runtime_dir: String,
    pub module_log_dir: String,
    pub http_api_base: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentLauncherStateResponse {
    pub ok: bool,
    pub api_version: &'static str,
    pub selected_modules: HashMap<String, SelectedModule>,
    pub modules: Vec<AgentModuleSummary>,
    pub providers: Vec<AgentProviderSummary>,
    pub engine_state: EngineState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentLogsResponse {
    pub ok: bool,
    pub api_version: &'static str,
    pub view_id: Option<String>,
    pub since: f64,
    pub limit: usize,
    pub logs: Vec<LogEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentModuleSummary {
    pub id: String,
    pub name: String,
    pub category: String,
    pub installed: bool,
    pub enabled: bool,
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentProviderSummary {
    pub id: String,
    pub name: String,
    pub provider_type: Option<String>,
    pub capabilities: Vec<String>,
    pub models: Vec<AgentModelSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentModelSummary {
    pub id: String,
    pub name: String,
    pub capabilities: Option<ModelCapabilities>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModuleStageChangedEvent {
    pub module_id: String,
    pub stage: String,
    pub label: String,
    pub details: Option<String>,
    pub progress: Option<f64>,
    pub source: &'static str,
}
