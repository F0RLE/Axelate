//! AI Data Transfer Objects (DTOs)
//!
//! Defines all shared data structures exchanged between the AI service and the frontend.

use serde::{Deserialize, Serialize};
use specta::Type;

/// AI chat message with role and content
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ChatMessage {
    /// Unique message identifier (UUID v4)
    #[serde(default = "generate_uuid")]
    pub id: String,
    /// Role ("user", "assistant", "system")
    pub role: String,
    /// Message content (text or structured data)
    pub content: serde_json::Value,
    /// Optional signature for extended thinking
    pub thought_signature: Option<String>,
}

pub(super) fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Token usage statistics
#[derive(Debug, Serialize, Deserialize, Clone, Type, Default)]
pub struct TokenUsage {
    /// Tokens in the prompt
    pub prompt_tokens: u32,
    /// Tokens in the completion
    pub completion_tokens: u32,
    /// Total tokens used
    pub total_tokens: u32,
}

/// Optional web search configuration for provider-backed chat requests.
#[derive(Debug, Serialize, Deserialize, Clone, Type, Default)]
pub struct WebSearchOptions {
    /// Enables provider-side web search.
    #[serde(default)]
    pub enabled: bool,
    /// Search engine preference (`auto`, `native`, `exa`, ...).
    #[serde(default)]
    pub engine: Option<String>,
    /// Maximum results per search call.
    #[serde(default)]
    pub max_results: Option<u32>,
    /// Maximum results across all search calls in one request.
    #[serde(default)]
    pub max_total_results: Option<u32>,
    /// Search context size (`low`, `medium`, `high`).
    #[serde(default)]
    pub search_context_size: Option<String>,
    /// Optional allow-list of domains.
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    /// Optional deny-list of domains.
    #[serde(default)]
    pub excluded_domains: Vec<String>,
}

/// AI chat request parameters
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ChatRequest {
    /// AI provider ("openai", "gemini", "local") - largely ignored now as we route via OpenRouter
    pub provider: String,
    /// Model identifier
    pub model: String,
    /// Chat history and new message
    pub messages: Vec<ChatMessage>,
    /// Optional API key
    pub api_key: Option<String>,
    /// Thinking level ("low", "medium", "high")
    pub thinking_level: Option<String>,
    /// Optional max output tokens
    pub max_tokens: Option<u32>,
    /// Client-generated request identifier for stream isolation
    pub request_id: Option<String>,
    /// Session identifier for history tracking
    pub session_id: Option<String>,
    /// Optional web search controls for cloud/API providers
    #[serde(default)]
    pub web_search: Option<WebSearchOptions>,
}

/// AI chat response
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ChatResponse {
    /// Corresponding request identifier
    #[serde(default = "generate_uuid")]
    pub id: String,
    /// Whether request was successful
    pub ok: bool,
    /// AI reply content
    pub reply: Option<ChatReply>,
    /// Error message if failed
    pub error: Option<String>,
    /// Model used
    pub model: Option<String>,
    /// Thinking signature
    pub thought_signature: Option<String>,
    /// Token usage metrics
    pub usage: Option<TokenUsage>,
}

/// AI reply content
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ChatReply {
    /// Reply text
    pub text: String,
    /// Role (typically "assistant")
    pub role: String,
}

/// Chat session with message history
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ChatSession {
    /// Message history
    pub history: Vec<ChatMessage>,
    /// Persisted recap of older turns used to keep long chats within local context limits
    #[serde(default)]
    pub summary: Option<String>,
    /// Number of leading messages already folded into the persisted recap
    #[serde(default)]
    pub summary_message_count: u32,
    /// Last modification time (Unix timestamp)
    pub last_updated: f64,
}

/// Image generation request parameters
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ImageGenerationRequest {
    /// AI provider or local engine ID
    pub provider: String,
    /// The text prompt for generation
    pub prompt: String,
    /// Original user text before UI prompt prefixes
    pub original_prompt: Option<String>,
    /// Model identifier
    pub model: String,
    /// Optional settings namespace key when UI-selected module differs from provider id
    pub settings_key: Option<String>,
    /// Session identifier for history tracking
    pub session_id: Option<String>,
    /// Number of inference steps
    pub steps: Option<u32>,
    /// Guidance scale (CFG)
    pub cfg_scale: Option<f32>,
    /// Image width in pixels
    pub width: Option<u32>,
    /// Image height in pixels
    pub height: Option<u32>,
    /// Sampler algorithm
    pub sampler: Option<String>,
    /// Random seed
    pub seed: Option<i32>,
    /// Clip skip
    pub clip_skip: Option<i32>,
    /// Optional negative prompt
    pub negative_prompt: Option<String>,
    /// Number of images to generate (batch size)
    pub batch_size: Option<u32>,
    /// Scheduler algorithm
    pub scheduler: Option<String>,
}

/// Image generation response
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ImageGenerationResponse {
    /// Base64 encoded images or URLs
    pub images: Vec<String>,
    /// Whether request was successful
    pub ok: bool,
    /// Error message if failed
    pub error: Option<String>,
}
