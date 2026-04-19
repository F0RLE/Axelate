mod ai_dispatch;
/// AI service implementation
pub mod ai_service;
/// Custom model management service
pub mod custom_model_service;
/// Shared state for active image-generation requests
pub mod image_generation_state;
mod image_service;
/// Chat session persistence and management
pub mod session;
mod session_context;
/// AI streaming abstractions and provider implementations
pub mod streaming;
/// AI Data Transfer Objects (DTOs)
pub mod types;
/// Launcher-side web grounding for local models
pub mod web_grounding;

// Re-export public surface so existing callers need no changes
pub use ai_service::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage, count_tokens,
    process_chat_request, validate_api_key,
};
pub use image_generation_state::ImageGenerationState;
pub use session::ChatSessionManager;
pub use streaming::{
    AiProvider, ChannelSink, NoopSink, OpenRouterProvider, StreamEvent, StreamSink,
};
pub use types::{ImageGenerationRequest, ImageGenerationResponse, WebSearchOptions};
