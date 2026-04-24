//! AI streaming abstractions and provider implementations
//!
//! Defines the `AiProvider` trait, `StreamSink` abstraction, and the unified
//! OpenAI-compatible provider used for OpenRouter and local `/v1/chat/completions`
//! servers such as `llama.cpp`.

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use std::sync::Arc;
use tokio::sync::mpsc;

use super::types::{ChatReply, ChatRequest, ChatResponse, TokenUsage, WebSearchOptions};

// ==================================================================================
// Stream Protocol
// ==================================================================================

/// Typed events for AI streaming (Platform-level Protocol)
#[derive(Debug)]
pub enum StreamEvent {
    /// A single text chunk for the chat conversation
    ChatChunk {
        /// ID of the message this chunk belongs to
        message_id: String,
        /// The text content
        content: String,
    },
    /// A single thinking/reasoning chunk
    ThoughtChunk {
        /// ID of the message this chunk belongs to
        message_id: String,
        /// The reasoning content
        content: String,
    },
    /// Stream termination event with final metadata
    Done {
        /// ID of the resulting message
        message_id: String,
        /// Final token usage (if provided by model)
        usage: Option<TokenUsage>,
    },
}

/// Abstraction for streaming AI output (Decouples UI from Infrastructure)
pub trait StreamSink: Send + Sync {
    /// Emit a stream event to the sink
    fn emit(&self, event: StreamEvent);
}

/// Channel-backed implementation of `StreamSink`.
#[derive(Debug)]
pub struct ChannelSink {
    tx: mpsc::Sender<StreamEvent>,
}

impl ChannelSink {
    /// Creates a new channel sink with the provided sender.
    pub const fn new(tx: mpsc::Sender<StreamEvent>) -> Self {
        Self { tx }
    }
}

impl StreamSink for ChannelSink {
    fn emit(&self, event: StreamEvent) {
        // Use try_send to avoid blocking the provider if the UI consumer is slow.
        if let Err(e) = self.tx.try_send(event) {
            tracing::warn!("[Sink] Failed to send event (channel full or closed): {e}");
        }
    }
}

/// Sink for non-streaming callers that only need the final response.
#[derive(Debug, Default)]
pub struct NoopSink;

impl StreamSink for NoopSink {
    fn emit(&self, _event: StreamEvent) {}
}

// ==================================================================================
// Provider Trait
// ==================================================================================

/// Core interface for AI providers
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Generates a stream of responses for the given request
    async fn generate_stream(
        &self,
        request_id: String,
        message_id: String,
        req: ChatRequest,
        sink: Arc<dyn StreamSink>,
    ) -> Result<ChatResponse, crate::errors::AppError>;
}

// ==================================================================================
// OpenRouter Unified Provider
// ==================================================================================

/// OpenAI-compatible provider implementation.
#[derive(Debug)]
pub struct OpenAiCompatibleProvider {
    base_url: String,
    client: Client,
}

/// Backward-compatible alias for the legacy provider name.
pub type OpenRouterProvider = OpenAiCompatibleProvider;

struct RequestExecution {
    endpoint: String,
    api_key: String,
    payload: serde_json::Map<String, serde_json::Value>,
}

struct StreamingAccumulator {
    full_content: String,
    buffer: String,
    final_usage: Option<TokenUsage>,
    saw_terminal_chunk: bool,
}

impl StreamingAccumulator {
    const fn new() -> Self {
        Self {
            full_content: String::new(),
            buffer: String::new(),
            final_usage: None,
            saw_terminal_chunk: false,
        }
    }
}

enum StreamChunkResult {
    Continue,
    Done,
    Error(String),
}

impl OpenAiCompatibleProvider {
    /// Creates a new OpenAI-compatible provider with the specified base URL.
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            client: Client::builder()
                .connect_timeout(std::time::Duration::from_secs(8))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    /// Executes a non-streaming chat completion request and returns one aggregated reply.
    pub async fn generate_completion(
        &self,
        request_id: String,
        message_id: String,
        req: ChatRequest,
    ) -> Result<ChatResponse, crate::errors::AppError> {
        let execution = self.prepare_request_execution(&req, false)?;
        let res = self
            .send_request(
                &execution.endpoint,
                &request_id,
                &execution.api_key,
                &execution.payload,
            )
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_default();
            return Ok(build_api_error_response(
                message_id,
                req.model,
                status,
                &error_text,
            ));
        }

        let body = res.json::<serde_json::Value>().await.map_err(|error| {
            crate::errors::AppError::External {
                request_id: Some(request_id),
                message: format!("error decoding response body: {error}"),
            }
        })?;

        Ok(parse_non_stream_response(&body, message_id, req.model))
    }

    fn prepare_request_execution(
        &self,
        req: &ChatRequest,
        stream: bool,
    ) -> Result<RequestExecution, crate::errors::AppError> {
        let is_local = is_local_base_url(&self.base_url);
        Ok(RequestExecution {
            endpoint: format!("{}/chat/completions", self.base_url.trim_end_matches('/')),
            api_key: resolve_api_key(req, &self.base_url)?,
            payload: build_request_payload(req, stream, is_local),
        })
    }

    async fn send_request(
        &self,
        endpoint: &str,
        request_id: &str,
        api_key: &str,
        payload: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<reqwest::Response, crate::errors::AppError> {
        let mut attempts = 0;
        const MAX_RETRIES: u32 = 1;

        loop {
            attempts += 1;

            let request_builder = self
                .client
                .post(endpoint)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .header("HTTP-Referer", "https://github.com/F0RLE/Axelate")
                .header("X-Title", "Axelate")
                .header("X-Request-Id", request_id)
                .json(payload);

            match request_builder.send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        return Ok(resp);
                    }
                    let status = resp.status();
                    if should_retry_status(status) && attempts <= MAX_RETRIES {
                        tokio::time::sleep(retry_delay(attempts, status)).await;
                        continue;
                    }
                    return Ok(resp);
                }
                Err(error) => {
                    if should_retry_error(&error) && attempts <= MAX_RETRIES {
                        tokio::time::sleep(retry_delay(attempts, StatusCode::REQUEST_TIMEOUT))
                            .await;
                        continue;
                    }
                    return Err(crate::errors::AppError::External {
                        request_id: Some(request_id.to_string()),
                        message: format!("Request failed after {MAX_RETRIES} attempts: {error}"),
                    });
                }
            }
        }
    }
}

const fn should_retry_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

fn should_retry_error(error: &reqwest::Error) -> bool {
    error.is_connect() || error.is_timeout()
}

fn retry_delay(attempt: u32, status: StatusCode) -> std::time::Duration {
    let capped_attempt = attempt.max(1);
    let base_ms = if status == StatusCode::TOO_MANY_REQUESTS {
        700u64
    } else {
        350u64
    };
    let backoff_multiplier = 2u64.saturating_pow(capped_attempt.saturating_sub(1));
    let jitter_ms = rand::random_range(0..150u64);

    std::time::Duration::from_millis(base_ms * backoff_multiplier + jitter_ms)
}

fn is_local_base_url(base_url: &str) -> bool {
    base_url.contains("localhost") || base_url.contains("127.0.0.1")
}

fn resolve_api_key(req: &ChatRequest, base_url: &str) -> Result<String, crate::errors::AppError> {
    let api_key = req.api_key.clone().unwrap_or_default();
    if !api_key.is_empty() {
        return Ok(api_key);
    }

    if is_local_base_url(base_url) {
        return Ok("local".to_string());
    }

    Err(crate::errors::AppError::Config(
        "No API key provided".to_string(),
    ))
}

fn build_request_payload(
    req: &ChatRequest,
    stream: bool,
    is_local: bool,
) -> serde_json::Map<String, serde_json::Value> {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "model".to_string(),
        serde_json::Value::String(req.model.clone()),
    );

    let mapped_messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|message| {
            serde_json::json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect();
    payload.insert(
        "messages".to_string(),
        serde_json::Value::Array(mapped_messages),
    );
    payload.insert("stream".to_string(), serde_json::Value::Bool(stream));

    if stream && !is_local {
        payload.insert(
            "stream_options".to_string(),
            serde_json::json!({ "include_usage": true }),
        );
    }

    if let Some(level) = &req.thinking_level
        && level != "off"
        && !is_local
    {
        payload.insert(
            "reasoning".to_string(),
            serde_json::json!({ "effort": level }),
        );
    }

    let max_tokens = serde_json::json!(req.max_tokens.unwrap_or(8192));
    if is_local {
        payload.insert("max_tokens".to_string(), max_tokens);
    } else {
        payload.insert("max_completion_tokens".to_string(), max_tokens);
    }

    if !is_local
        && let Some(session_id) = req.session_id.as_ref().map(|value| value.trim())
        && !session_id.is_empty()
    {
        payload.insert(
            "session_id".to_string(),
            serde_json::Value::String(session_id.to_string()),
        );
    }

    if !is_local
        && should_attach_web_search(req)
        && let Some(web_search) = req.web_search.as_ref()
    {
        payload.insert(
            "tools".to_string(),
            serde_json::Value::Array(vec![build_web_search_tool(web_search)]),
        );
        payload.insert(
            "tool_choice".to_string(),
            serde_json::Value::String("auto".to_string()),
        );
    }

    payload
}

fn should_attach_web_search(req: &ChatRequest) -> bool {
    if !req
        .web_search
        .as_ref()
        .is_some_and(|web_search| web_search.enabled)
    {
        return false;
    }

    let Some(last_user_message) = req
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
    else {
        return false;
    };
    let text = extract_message_text(&last_user_message.content).to_lowercase();
    let text = text.trim();
    if text.is_empty() {
        return false;
    }

    const WEB_SEARCH_TRIGGERS: &[&str] = &[
        "актуаль",
        "интернет",
        "найди",
        "новост",
        "погугли",
        "поиск",
        "посмотри в сети",
        "свеж",
        "сейчас",
        "сегодня",
        "ссылка",
        "site:",
        "today",
        "latest",
        "current",
        "recent",
        "news",
        "search",
        "browse",
        "web",
        "internet",
        "look up",
        "price",
        "weather",
    ];

    text.starts_with("http://")
        || text.starts_with("https://")
        || text.contains(" http://")
        || text.contains(" https://")
        || WEB_SEARCH_TRIGGERS
            .iter()
            .any(|trigger| text.contains(trigger))
}

fn extract_message_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                (part.get("type")?.as_str()? == "text")
                    .then(|| part.get("text")?.as_str())
                    .flatten()
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn parse_non_stream_response(
    body: &serde_json::Value,
    message_id: String,
    model: String,
) -> ChatResponse {
    let usage = body
        .get("usage")
        .cloned()
        .and_then(|value| serde_json::from_value::<TokenUsage>(value).ok());

    let reply_text = body
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .map(extract_message_text)
        .unwrap_or_default();

    if reply_text.trim().is_empty() {
        return ChatResponse {
            id: message_id,
            ok: false,
            reply: None,
            error: Some("Empty response body from AI provider".to_string()),
            model: Some(model),
            thought_signature: None,
            usage,
        };
    }

    ChatResponse {
        id: message_id,
        ok: true,
        reply: Some(ChatReply {
            text: reply_text,
            role: "assistant".to_string(),
        }),
        error: None,
        model: Some(model),
        thought_signature: None,
        usage,
    }
}

fn build_api_error_response(
    message_id: String,
    model: String,
    status: StatusCode,
    error_text: &str,
) -> ChatResponse {
    ChatResponse {
        id: message_id,
        ok: false,
        reply: None,
        error: Some(format!("API Error {status}: {error_text}")),
        model: Some(model),
        thought_signature: None,
        usage: None,
    }
}

fn build_web_search_tool(options: &WebSearchOptions) -> serde_json::Value {
    let mut parameters = serde_json::Map::new();
    parameters.insert(
        "engine".to_string(),
        serde_json::Value::String(
            options
                .engine
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "auto".to_string()),
        ),
    );
    parameters.insert(
        "max_results".to_string(),
        serde_json::json!(options.max_results.unwrap_or(5).clamp(1, 25)),
    );
    parameters.insert(
        "max_total_results".to_string(),
        serde_json::json!(options.max_total_results.unwrap_or(10).max(1)),
    );
    parameters.insert(
        "search_context_size".to_string(),
        serde_json::Value::String(
            options
                .search_context_size
                .clone()
                .filter(|value| matches!(value.as_str(), "low" | "medium" | "high"))
                .unwrap_or_else(|| "medium".to_string()),
        ),
    );

    if !options.allowed_domains.is_empty() {
        parameters.insert(
            "allowed_domains".to_string(),
            serde_json::Value::Array(
                options
                    .allowed_domains
                    .iter()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| serde_json::Value::String(value.trim().to_string()))
                    .collect(),
            ),
        );
    }

    if !options.excluded_domains.is_empty() {
        parameters.insert(
            "excluded_domains".to_string(),
            serde_json::Value::Array(
                options
                    .excluded_domains
                    .iter()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| serde_json::Value::String(value.trim().to_string()))
                    .collect(),
            ),
        );
    }

    serde_json::json!({
        "type": "openrouter:web_search",
        "parameters": parameters,
    })
}

#[async_trait]
impl AiProvider for OpenAiCompatibleProvider {
    async fn generate_stream(
        &self,
        request_id: String,
        message_id: String,
        req: ChatRequest,
        sink: Arc<dyn StreamSink>,
    ) -> Result<ChatResponse, crate::errors::AppError> {
        let execution = self.prepare_request_execution(&req, true)?;
        let res = self
            .send_request(
                &execution.endpoint,
                &request_id,
                &execution.api_key,
                &execution.payload,
            )
            .await?;

        // Final key drop to be safe
        std::mem::drop(execution.api_key);

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_default();
            return Ok(build_api_error_response(
                message_id,
                req.model,
                status,
                &error_text,
            ));
        }

        let mut stream = res.bytes_stream();
        let mut state = StreamingAccumulator::new();
        let mut saw_done = false;

        'outer: while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| crate::errors::AppError::External {
                request_id: Some(request_id.clone()),
                message: e.to_string(),
            })?;
            match process_stream_chunk(&chunk, &message_id, sink.as_ref(), &mut state) {
                StreamChunkResult::Continue => {}
                StreamChunkResult::Done => {
                    saw_done = true;
                    break 'outer;
                }
                StreamChunkResult::Error(message) => {
                    return Ok(ChatResponse {
                        id: message_id,
                        ok: false,
                        reply: None,
                        error: Some(message),
                        model: Some(req.model),
                        thought_signature: None,
                        usage: state.final_usage,
                    });
                }
            }
        }

        match process_trailing_stream_buffer(&message_id, sink.as_ref(), &mut state) {
            StreamChunkResult::Continue => {}
            StreamChunkResult::Done => {
                saw_done = true;
            }
            StreamChunkResult::Error(message) => {
                return Ok(ChatResponse {
                    id: message_id,
                    ok: false,
                    reply: None,
                    error: Some(message),
                    model: Some(req.model),
                    thought_signature: None,
                    usage: state.final_usage,
                });
            }
        }

        if !saw_done && !state.saw_terminal_chunk {
            return Ok(ChatResponse {
                id: message_id,
                ok: false,
                reply: None,
                error: Some("AI stream ended before a completion marker was received".to_string()),
                model: Some(req.model),
                thought_signature: None,
                usage: state.final_usage,
            });
        }

        // Final event
        sink.emit(StreamEvent::Done {
            message_id: message_id.clone(),
            usage: state.final_usage.clone(),
        });

        Ok(ChatResponse {
            id: message_id,
            ok: true,
            reply: Some(ChatReply {
                text: state.full_content,
                role: "assistant".to_string(),
            }),
            error: None,
            model: Some(req.model),
            thought_signature: None,
            usage: state.final_usage,
        })
    }
}

fn process_stream_chunk(
    chunk: &[u8],
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    let chunk_str = String::from_utf8_lossy(chunk);

    if state.buffer.len() + chunk_str.len() > 1_024_024 {
        tracing::error!("[AI] Stream buffer overflow protection triggered. Clearing buffer.");
        state.buffer.clear();
    }

    state.buffer.push_str(&chunk_str);

    while let Some(pos) = state.buffer.find('\n') {
        let line = state.buffer[..pos].trim().to_string();
        state.buffer.drain(..=pos);

        match process_stream_line(&line, message_id, sink, state) {
            StreamChunkResult::Continue => {}
            result => return result,
        }
    }

    StreamChunkResult::Continue
}

fn process_trailing_stream_buffer(
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    let line = state.buffer.trim().to_string();
    state.buffer.clear();

    if line.is_empty() {
        return StreamChunkResult::Continue;
    }

    process_stream_line(&line, message_id, sink, state)
}

fn process_stream_line(
    line: &str,
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
        return StreamChunkResult::Continue;
    }

    let Some(data) = line.strip_prefix("data:").map(str::trim) else {
        return StreamChunkResult::Continue;
    };

    if data == "[DONE]" {
        return StreamChunkResult::Done;
    }

    handle_stream_json_line(data, message_id, sink, state)
}

fn handle_stream_json_line(
    data: &str,
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    let json = serde_json::from_str::<serde_json::Value>(data).map_err(|error| {
        tracing::debug!("[AI] Failed to parse stream JSON chunk: {error}");
        format!("AI stream returned malformed JSON chunk: {error}")
    });
    let Ok(json) = json else {
        return StreamChunkResult::Error("AI stream returned malformed JSON chunk".to_string());
    };

    if let Some(message) = extract_stream_error_message(&json) {
        return StreamChunkResult::Error(message);
    }

    if let Some(usage_val) = json.get("usage")
        && let Ok(usage) = serde_json::from_value::<TokenUsage>(usage_val.clone())
    {
        state.final_usage = Some(usage);
    }

    let Some(choice) = json
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
    else {
        return StreamChunkResult::Continue;
    };

    if let Some(message) = choice.get("error").and_then(extract_error_message) {
        return StreamChunkResult::Error(message);
    }

    if let Some(finish_reason) = choice.get("finish_reason").and_then(|value| value.as_str()) {
        if finish_reason.eq_ignore_ascii_case("error") {
            return StreamChunkResult::Error(
                extract_error_message(choice)
                    .unwrap_or_else(|| "AI provider reported a streaming error".to_string()),
            );
        }

        if !finish_reason.trim().is_empty() {
            state.saw_terminal_chunk = true;
        }
    }

    let delta = choice.get("delta");

    if let Some(reasoning) = delta
        .and_then(|d| d.get("reasoning_content"))
        .and_then(extract_stream_text)
        .or_else(|| {
            delta
                .and_then(|d| d.get("reasoning"))
                .and_then(extract_stream_text)
        })
    {
        sink.emit(StreamEvent::ThoughtChunk {
            message_id: message_id.to_string(),
            content: reasoning,
        });
    }

    if let Some(content) = delta
        .and_then(|d| d.get("content"))
        .and_then(extract_stream_text)
    {
        state.full_content.push_str(&content);
        sink.emit(StreamEvent::ChatChunk {
            message_id: message_id.to_string(),
            content,
        });
    }

    StreamChunkResult::Continue
}

fn extract_stream_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(|candidate| candidate.as_str())
                        .or_else(|| part.get("content").and_then(|candidate| candidate.as_str()))
                })
                .collect::<Vec<_>>()
                .join("");

            (!text.is_empty()).then_some(text)
        }
        serde_json::Value::Object(object) => object
            .get("text")
            .and_then(|candidate| candidate.as_str())
            .map(ToOwned::to_owned),
        _ => None,
    }
}

fn extract_stream_error_message(json: &serde_json::Value) -> Option<String> {
    json.get("error")
        .and_then(extract_error_message)
        .or_else(|| json.get("errors").and_then(extract_error_message))
}

fn extract_error_message(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(message) => {
            let trimmed = message.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        serde_json::Value::Array(items) => items.iter().find_map(extract_error_message),
        serde_json::Value::Object(object) => ["message", "detail", "error"]
            .iter()
            .find_map(|key| object.get(*key).and_then(extract_error_message)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::indexing_slicing)]

    use super::{
        StreamChunkResult, StreamingAccumulator, build_request_payload, build_web_search_tool,
        is_local_base_url, process_stream_chunk, retry_delay, should_retry_status,
    };
    use crate::domain::ai::{ChatMessage, ChatRequest};
    use crate::domain::ai::{StreamEvent, StreamSink, WebSearchOptions};
    use reqwest::StatusCode;
    use serde_json::json;

    #[derive(Default)]
    struct TestSink {
        events: std::sync::Mutex<Vec<StreamEvent>>,
    }

    impl StreamSink for TestSink {
        fn emit(&self, event: StreamEvent) {
            self.events.lock().expect("sink mutex").push(event);
        }
    }

    fn sample_request() -> ChatRequest {
        ChatRequest {
            provider: "gpt".to_string(),
            model: "openai/gpt-5.4".to_string(),
            messages: vec![ChatMessage {
                id: "m1".to_string(),
                role: "user".to_string(),
                content: json!("hello"),
                thought_signature: None,
            }],
            api_key: None,
            thinking_level: Some("high".to_string()),
            max_tokens: Some(2048),
            request_id: Some("req-1".to_string()),
            session_id: Some("session-1".to_string()),
            web_search: None,
        }
    }

    #[test]
    fn build_web_search_tool_applies_defaults() {
        let tool = build_web_search_tool(&WebSearchOptions {
            enabled: true,
            ..Default::default()
        });

        assert_eq!(tool["type"], "openrouter:web_search");
        assert_eq!(tool["parameters"]["engine"], "auto");
        assert_eq!(tool["parameters"]["max_results"], 5);
        assert_eq!(tool["parameters"]["max_total_results"], 10);
        assert_eq!(tool["parameters"]["search_context_size"], "medium");
    }

    #[test]
    fn build_web_search_tool_keeps_domain_filters() {
        let tool = build_web_search_tool(&WebSearchOptions {
            enabled: true,
            allowed_domains: vec!["openai.com".to_string()],
            excluded_domains: vec!["reddit.com".to_string()],
            ..Default::default()
        });

        assert_eq!(tool["parameters"]["allowed_domains"][0], "openai.com");
        assert_eq!(tool["parameters"]["excluded_domains"][0], "reddit.com");
    }

    #[test]
    fn local_base_url_detection_matches_local_endpoints() {
        assert!(is_local_base_url("http://localhost:8081/v1"));
        assert!(is_local_base_url("http://127.0.0.1:8081/v1"));
        assert!(!is_local_base_url("https://openrouter.ai/api/v1"));
    }

    #[test]
    fn retry_policy_is_limited_to_interactive_safe_cases() {
        assert!(should_retry_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(should_retry_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(should_retry_status(StatusCode::BAD_GATEWAY));
        assert!(should_retry_status(StatusCode::GATEWAY_TIMEOUT));
        assert!(!should_retry_status(StatusCode::INTERNAL_SERVER_ERROR));
        assert!(!should_retry_status(StatusCode::FORBIDDEN));
    }

    #[test]
    fn retry_delay_stays_short_for_chat_requests() {
        assert!(retry_delay(1, StatusCode::SERVICE_UNAVAILABLE).as_millis() < 500);
        assert!(retry_delay(1, StatusCode::TOO_MANY_REQUESTS).as_millis() < 900);
    }

    #[test]
    fn build_request_payload_uses_cloud_token_field_and_session_id() {
        let payload = build_request_payload(&sample_request(), true, false);

        assert_eq!(payload.get("max_completion_tokens"), Some(&json!(2048)));
        assert_eq!(payload.get("session_id"), Some(&json!("session-1")));
        assert!(payload.get("max_tokens").is_none());
        assert_eq!(payload.get("reasoning"), Some(&json!({ "effort": "high" })));
    }

    #[test]
    fn build_request_payload_skips_web_search_for_generic_prompts() {
        let mut request = sample_request();
        request.web_search = Some(WebSearchOptions {
            enabled: true,
            ..Default::default()
        });

        let payload = build_request_payload(&request, true, false);

        assert!(payload.get("tool_choice").is_none());
        assert!(payload.get("tools").is_none());
    }

    #[test]
    fn build_request_payload_exposes_web_search_for_current_prompts() {
        let mut request = sample_request();
        request.messages[0].content = json!("What is the latest OpenAI news today?");
        request.web_search = Some(WebSearchOptions {
            enabled: true,
            ..Default::default()
        });

        let payload = build_request_payload(&request, true, false);

        assert_eq!(payload.get("tool_choice"), Some(&json!("auto")));
        assert_eq!(
            payload
                .get("tools")
                .and_then(|tools| tools.as_array())
                .map(std::vec::Vec::len),
            Some(1)
        );
    }

    #[test]
    fn build_request_payload_keeps_local_compatibility_fields() {
        let payload = build_request_payload(&sample_request(), true, true);

        assert_eq!(payload.get("max_tokens"), Some(&json!(2048)));
        assert!(payload.get("max_completion_tokens").is_none());
        assert!(payload.get("session_id").is_none());
        assert!(payload.get("reasoning").is_none());
    }

    #[test]
    fn process_stream_chunk_surfaces_provider_errors() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"error\":{\"message\":\"rate limited\"}}\n\n".as_slice();

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Error(message) if message == "rate limited"));
    }

    #[test]
    fn process_stream_chunk_collects_content_and_terminal_reason() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n";

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Continue));
        assert_eq!(state.full_content, "hello");
        assert!(state.saw_terminal_chunk);
        assert_eq!(
            state.final_usage.as_ref().map(|usage| usage.total_tokens),
            Some(3)
        );

        let events = sink.events.lock().expect("sink events");
        assert!(matches!(
            events.first(),
            Some(StreamEvent::ChatChunk { content, .. }) if content == "hello"
        ));
    }
}
