/// AI service implementation
pub mod ai_service;
/// Custom model management service
pub mod custom_model_service;
/// Chat session persistence and management
pub mod session;
/// AI streaming abstractions and provider implementations
pub mod streaming;
/// AI Data Transfer Objects (DTOs)
pub mod types;

// Re-export public surface so existing callers need no changes
pub use ai_service::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage, count_tokens,
    process_chat_request, validate_api_key,
};
pub use session::ChatSessionManager;
pub use streaming::{AiProvider, ChannelSink, OpenRouterProvider, StreamEvent, StreamSink};
pub use types::{ImageGenerationRequest, ImageGenerationResponse};
