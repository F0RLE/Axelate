mod ai_dispatch;
/// AI service implementation
pub mod ai_service;
/// Custom model management service
pub mod custom_model_service;
mod image_cloud;
mod image_comfyui;
/// Shared state for active image-generation requests
pub mod image_generation_state;
mod image_http;
mod image_local;
mod image_payload;
mod image_provider_adapter;
mod image_response;
mod image_service;
mod image_settings;
mod provider_http;
mod provider_payload;
mod provider_response;
/// Chat session persistence and management
pub mod session;
mod session_context;
mod session_persistence;
/// AI streaming abstractions and provider implementations
pub mod streaming;
/// AI Data Transfer Objects (DTOs)
pub mod types;
// Re-export public surface so existing callers need no changes
pub use ai_service::{
    ChatMessage, ChatReply, ChatRequest, ChatResponse, ChatSession, TokenUsage, count_tokens,
    process_chat_request, validate_api_key,
};
pub use image_generation_state::ImageGenerationState;
pub use image_provider_adapter::cancel_image_provider_generation;
pub use session::ChatSessionManager;
pub use streaming::{
    AiProvider, ChannelSink, NoopSink, OpenAiCompatibleProvider, StreamEvent, StreamSink,
};
pub use types::{ImageGenerationRequest, ImageGenerationResponse, WebSearchOptions};
