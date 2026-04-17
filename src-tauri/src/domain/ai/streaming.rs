//! AI streaming abstractions and provider implementations
//!
//! Defines the `AiProvider` trait, `StreamSink` abstraction, and the unified
//! `OpenRouterProvider` which routes to OpenAI, Gemini, Claude, etc.

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

/// OpenRouter Unified Provider Implementation
#[derive(Debug)]
pub struct OpenRouterProvider {
    base_url: String,
    client: Client,
}

impl OpenRouterProvider {
    /// Creates a new OpenRouterProvider with the specified base URL
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            client: Client::new(),
        }
    }

    /// Executes a non-streaming chat completion request and returns one aggregated reply.
    pub async fn generate_completion(
        &self,
        request_id: String,
        message_id: String,
        req: ChatRequest,
    ) -> Result<ChatResponse, crate::errors::AppError> {
        let api_key = resolve_api_key(&req, &self.base_url)?;
        let payload = build_request_payload(&req, false, is_local_base_url(&self.base_url));
        let endpoint = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let res = self
            .send_request(&endpoint, &request_id, &api_key, &payload)
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_default();
            return Ok(ChatResponse {
                id: message_id,
                ok: false,
                reply: None,
                error: Some(format!("API Error {status}: {error_text}")),
                model: Some(req.model),
                thought_signature: None,
                usage: None,
            });
        }

        let body = res.json::<serde_json::Value>().await.map_err(|error| {
            crate::errors::AppError::External {
                request_id: Some(request_id),
                message: format!("error decoding response body: {error}"),
            }
        })?;

        Ok(parse_non_stream_response(body, message_id, req.model))
    }

    async fn send_request(
        &self,
        endpoint: &str,
        request_id: &str,
        api_key: &str,
        payload: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<reqwest::Response, crate::errors::AppError> {
        let mut attempts = 0;
        const MAX_RETRIES: u32 = 3;

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
                    if (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
                        && attempts <= MAX_RETRIES
                    {
                        let base_wait = 2u64.pow(attempts);
                        let jitter = rand::random_range(0..500);
                        tokio::time::sleep(std::time::Duration::from_millis(
                            base_wait * 1000 + jitter,
                        ))
                        .await;
                        continue;
                    }
                    return Ok(resp);
                }
                Err(error) => {
                    if attempts <= MAX_RETRIES {
                        let base_wait = 2u64.pow(attempts);
                        let jitter = rand::random_range(0..500);
                        tokio::time::sleep(std::time::Duration::from_millis(
                            base_wait * 1000 + jitter,
                        ))
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

    payload.insert(
        "max_tokens".to_string(),
        serde_json::json!(req.max_tokens.unwrap_or(8192)),
    );

    if !is_local
        && let Some(web_search) = req.web_search.as_ref()
        && web_search.enabled
    {
        payload.insert(
            "tools".to_string(),
            serde_json::Value::Array(vec![build_web_search_tool(web_search)]),
        );
    }

    payload
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
    body: serde_json::Value,
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
impl AiProvider for OpenRouterProvider {
    async fn generate_stream(
        &self,
        request_id: String,
        message_id: String,
        req: ChatRequest,
        sink: Arc<dyn StreamSink>,
    ) -> Result<ChatResponse, crate::errors::AppError> {
        let api_key = resolve_api_key(&req, &self.base_url)?;
        let payload = build_request_payload(&req, true, is_local_base_url(&self.base_url));
        let endpoint = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let res = self
            .send_request(&endpoint, &request_id, &api_key, &payload)
            .await?;

        // Final key drop to be safe
        std::mem::drop(api_key);

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_default();
            return Ok(ChatResponse {
                id: message_id,
                ok: false,
                reply: None,
                error: Some(format!("API Error {status}: {error_text}")),
                model: Some(req.model),
                thought_signature: None,
                usage: None,
            });
        }

        let mut stream = res.bytes_stream();
        let mut full_content = String::new();
        let mut buffer = String::new();
        let mut final_usage: Option<TokenUsage> = None;

        'outer: while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| crate::errors::AppError::External {
                request_id: Some(request_id.clone()),
                message: e.to_string(),
            })?;
            let chunk_str = String::from_utf8_lossy(&chunk);

            // Memory Safety: Prevent buffer overflow from malformed streams (~1MB limit)
            if buffer.len() + chunk_str.len() > 1_024_024 {
                tracing::error!(
                    "[AI] Stream buffer overflow protection triggered. Clearing buffer."
                );
                buffer.clear();
            }

            buffer.push_str(&chunk_str);

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if line.starts_with("data: ") {
                    let data = line.trim_start_matches("data: ");
                    if data == "[DONE]" {
                        break 'outer;
                    }

                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        // Extract usage if present in chunk
                        if let Some(usage_val) = json.get("usage")
                            && let Ok(usage) =
                                serde_json::from_value::<TokenUsage>(usage_val.clone())
                        {
                            final_usage = Some(usage);
                        }

                        if let Some(choices) = json.get("choices").and_then(|c| c.as_array())
                            && let Some(choice) = choices.first()
                        {
                            let delta = choice.get("delta");

                            // Reasoning extraction
                            if let Some(reasoning) = delta
                                .and_then(|d| d.get("reasoning_content"))
                                .and_then(|v| v.as_str())
                                .or_else(|| {
                                    delta
                                        .and_then(|d| d.get("reasoning"))
                                        .and_then(|v| v.as_str())
                                })
                            {
                                sink.emit(StreamEvent::ThoughtChunk {
                                    message_id: message_id.clone(),
                                    content: reasoning.to_string(),
                                });
                            }

                            // Content extraction
                            if let Some(content) = delta
                                .and_then(|d| d.get("content"))
                                .and_then(|v| v.as_str())
                            {
                                full_content.push_str(content);
                                sink.emit(StreamEvent::ChatChunk {
                                    message_id: message_id.clone(),
                                    content: content.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // Final event
        sink.emit(StreamEvent::Done {
            message_id: message_id.clone(),
            usage: final_usage.clone(),
        });

        Ok(ChatResponse {
            id: message_id,
            ok: true,
            reply: Some(ChatReply {
                text: full_content,
                role: "assistant".to_string(),
            }),
            error: None,
            model: Some(req.model),
            thought_signature: None,
            usage: final_usage,
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{build_web_search_tool, is_local_base_url};
    use crate::domain::ai::WebSearchOptions;

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
}
