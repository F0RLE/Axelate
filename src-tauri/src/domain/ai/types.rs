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
    /// Session identifier for history tracking
    pub session_id: Option<String>,
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
    /// Last modification time (Unix timestamp)
    pub last_updated: f64,
}
