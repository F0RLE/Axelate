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

use super::provider_http;
use super::provider_payload;
use super::provider_response;
use super::streaming_chunks::{
    StreamChunkResult, StreamingAccumulator, process_stream_chunk, process_trailing_stream_buffer,
};
use super::types::{ChatReply, ChatRequest, ChatResponse, TokenUsage};

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

struct RequestExecution {
    endpoint: String,
    api_key: String,
    payload: serde_json::Map<String, serde_json::Value>,
}

impl OpenAiCompatibleProvider {
    /// Creates a new OpenAI-compatible provider with the specified base URL.
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            client: provider_http::build_provider_client(),
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
            return Ok(provider_response::build_api_error_response(
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

        Ok(provider_response::parse_non_stream_response(
            &body, message_id, req.model,
        ))
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
            payload: provider_payload::build_chat_completion_payload(req, stream, is_local),
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
                .header("Accept", resolve_accept_header(payload))
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
                    if provider_http::should_retry_status(status) && attempts <= MAX_RETRIES {
                        tokio::time::sleep(provider_http::retry_delay(attempts, status)).await;
                        continue;
                    }
                    return Ok(resp);
                }
                Err(error) => {
                    if provider_http::should_retry_error(&error) && attempts <= MAX_RETRIES {
                        tokio::time::sleep(provider_http::retry_delay(
                            attempts,
                            StatusCode::REQUEST_TIMEOUT,
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

pub(super) fn is_local_base_url(base_url: &str) -> bool {
    provider_payload::is_local_base_url(base_url)
}

fn resolve_accept_header(payload: &serde_json::Map<String, serde_json::Value>) -> &'static str {
    if payload
        .get("stream")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        "text/event-stream"
    } else {
        "application/json"
    }
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
            return Ok(provider_response::build_api_error_response(
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
            tracing::warn!(
                request_id = %request_id,
                message_id = %message_id,
                chunks = state.chunks_emitted,
                "AI stream ended before a completion marker was received"
            );
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

        tracing::info!(
            request_id = %request_id,
            message_id = %message_id,
            chunks = state.chunks_emitted,
            first_chunk_ms = state
                .first_chunk_after
                .map(|duration| duration.as_millis())
                .unwrap_or_default(),
            total_ms = state.started_at.elapsed().as_millis(),
            "AI stream completed"
        );

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

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::indexing_slicing)]

    use super::is_local_base_url;
    use crate::domain::ai::WebSearchOptions;
    use crate::domain::ai::{ChatMessage, ChatRequest};
    use crate::domain::ai::{provider_http, provider_payload};
    use reqwest::StatusCode;
    use serde_json::json;

    fn sample_request() -> ChatRequest {
        ChatRequest {
            provider: "gpt".to_string(),
            model: "openai/gpt-5.5".to_string(),
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
            cloud_api_base_url: None,
        }
    }

    #[test]
    fn build_web_search_tool_applies_defaults() {
        let tool = provider_payload::build_web_search_tool(&WebSearchOptions {
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
        let tool = provider_payload::build_web_search_tool(&WebSearchOptions {
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
        assert!(is_local_base_url("http://[::1]:8081/v1"));
        assert!(!is_local_base_url("https://openrouter.ai/api/v1"));
        assert!(!is_local_base_url("https://localhost.example.com/v1"));
    }

    #[test]
    fn retry_policy_is_limited_to_interactive_safe_cases() {
        assert!(provider_http::should_retry_status(
            StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(provider_http::should_retry_status(
            StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(provider_http::should_retry_status(StatusCode::BAD_GATEWAY));
        assert!(provider_http::should_retry_status(
            StatusCode::GATEWAY_TIMEOUT
        ));
        assert!(!provider_http::should_retry_status(
            StatusCode::INTERNAL_SERVER_ERROR
        ));
        assert!(!provider_http::should_retry_status(StatusCode::FORBIDDEN));
    }

    #[test]
    fn retry_delay_stays_short_for_chat_requests() {
        assert!(provider_http::retry_delay(1, StatusCode::SERVICE_UNAVAILABLE).as_millis() < 500);
        assert!(provider_http::retry_delay(1, StatusCode::TOO_MANY_REQUESTS).as_millis() < 900);
    }

    #[test]
    fn build_request_payload_uses_cloud_token_field_and_session_id() {
        let payload =
            provider_payload::build_chat_completion_payload(&sample_request(), true, false);

        assert_eq!(payload.get("max_completion_tokens"), Some(&json!(2048)));
        assert_eq!(payload.get("session_id"), Some(&json!("session-1")));
        assert!(payload.get("max_tokens").is_none());
        assert_eq!(payload.get("reasoning"), Some(&json!({ "effort": "high" })));
    }

    #[test]
    fn build_request_payload_maps_off_reasoning_to_openrouter_none() {
        let mut request = sample_request();
        request.thinking_level = Some("off".to_string());

        let payload = provider_payload::build_chat_completion_payload(&request, true, false);

        assert_eq!(payload.get("reasoning"), Some(&json!({ "effort": "none" })));
    }

    #[test]
    fn build_request_payload_keeps_explicit_none_reasoning() {
        let mut request = sample_request();
        request.thinking_level = Some("none".to_string());

        let payload = provider_payload::build_chat_completion_payload(&request, true, false);

        assert_eq!(payload.get("reasoning"), Some(&json!({ "effort": "none" })));
    }

    #[test]
    fn build_request_payload_skips_web_search_for_generic_prompts() {
        let mut request = sample_request();
        request.web_search = Some(WebSearchOptions {
            enabled: true,
            ..Default::default()
        });

        let payload = provider_payload::build_chat_completion_payload(&request, true, false);

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

        let payload = provider_payload::build_chat_completion_payload(&request, true, false);

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
        let payload =
            provider_payload::build_chat_completion_payload(&sample_request(), true, true);

        assert_eq!(payload.get("max_tokens"), Some(&json!(2048)));
        assert!(payload.get("max_completion_tokens").is_none());
        assert!(payload.get("session_id").is_none());
        assert!(payload.get("reasoning").is_none());
    }
}
