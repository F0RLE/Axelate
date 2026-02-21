//! AI streaming abstractions and provider implementations
//!
//! Defines the `AiProvider` trait, `StreamSink` abstraction, and the unified
//! `OpenRouterProvider` which routes to OpenAI, Gemini, Claude, etc.

use async_trait::async_trait;
use futures_util::StreamExt;
use rand::Rng;
use reqwest::{Client, StatusCode};
use std::sync::Arc;
use tokio::sync::mpsc;

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

/// Tauri-specific implementation of StreamSink using a bounded channel
#[derive(Debug)]
pub struct WindowSink {
    tx: mpsc::Sender<StreamEvent>,
}

impl WindowSink {
    /// Creates a new WindowSink with the provided channel sender
    pub const fn new(tx: mpsc::Sender<StreamEvent>) -> Self {
        Self { tx }
    }
}

impl StreamSink for WindowSink {
    fn emit(&self, event: StreamEvent) {
        // Use try_send to avoid blocking the provider if the UI consumer is slow.
        if let Err(e) = self.tx.try_send(event) {
            tracing::warn!("[Sink] Failed to send event (channel full or closed): {e}");
        }
    }
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
}

impl OpenRouterProvider {
    /// Creates a new OpenRouterProvider with the specified base URL
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
        }
    }
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
        let api_key = req
            .api_key
            .clone()
            .ok_or_else(|| crate::errors::AppError::Config("No API key provided".to_string()))?;

        let client = Client::builder()
            .build()
            .map_err(|e| crate::errors::AppError::External {
                request_id: Some(request_id.clone()),
                message: e.to_string(),
            })?;

        let mut payload = serde_json::Map::new();
        payload.insert(
            "model".to_string(),
            serde_json::Value::String(req.model.clone()),
        );
        payload.insert("messages".to_string(), serde_json::json!(req.messages));
        payload.insert("stream".to_string(), serde_json::Value::Bool(true));

        if let Some(level) = &req.thinking_level {
            payload.insert(
                "reasoning_effort".to_string(),
                serde_json::Value::String(level.clone()),
            );
        }

        let max_tokens = req.max_tokens.unwrap_or(8192);
        payload.insert("max_tokens".to_string(), serde_json::json!(max_tokens));

        let endpoint = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        let mut attempts = 0;
        const MAX_RETRIES: u32 = 3;

        let res: reqwest::Response = loop {
            attempts += 1;

            let request_builder = client
                .post(&endpoint)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .header("HTTP-Referer", "https://github.com/F0RLE/Axelate")
                .header("X-Title", "Axelate")
                .header("X-Request-Id", &request_id)
                .json(&payload);

            match request_builder.send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        break resp;
                    }
                    let status = resp.status();
                    if (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
                        && attempts <= MAX_RETRIES
                    {
                        let base_wait = 2u64.pow(attempts);
                        let jitter = rand::rng().random_range(0..500);
                        tokio::time::sleep(std::time::Duration::from_millis(
                            base_wait * 1000 + jitter,
                        ))
                        .await;
                        continue;
                    }
                    break resp;
                }
                Err(e) => {
                    if attempts <= MAX_RETRIES {
                        let base_wait = 2u64.pow(attempts);
                        let jitter = rand::rng().random_range(0..500);
                        tokio::time::sleep(std::time::Duration::from_millis(
                            base_wait * 1000 + jitter,
                        ))
                        .await;
                        continue;
                    }
                    return Err(crate::errors::AppError::External {
                        request_id: Some(request_id),
                        message: format!("Request failed after {MAX_RETRIES} attempts: {e}"),
                    });
                }
            }
        };

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
