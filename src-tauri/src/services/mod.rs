/// AI Provider integration service (OpenAI, Gemini, Anthropic)
pub mod ai_service;
/// Configuration file management service
pub mod config_service;
/// Custom AI model management service
pub mod custom_model_service;
/// Async module download and extraction service
pub mod downloader;
/// File system operations service
pub mod file_service;
/// Backend health monitoring service
pub mod health;
/// License validation and storage service
pub mod license;
/// Frontend log capture and retrieval service
pub mod logs;
/// Module process lifecycle controller
pub mod module_controller;
/// Module initialization and teardown lifecycle management
pub mod module_lifecycle;
/// AES-256-GCM hardware-bound encryption service
pub mod secure_storage;
/// HTTP server for inter-process communication
pub mod server;
/// Application settings persistence service
pub mod settings;
/// Real-time hardware monitoring service (CPU, RAM, GPU)
pub mod system_monitor;
/// System theme and accent color detection service
pub mod theme;
/// Internationalization and locale management service
pub mod translations;
/// UI state persistence service
pub mod ui_state;
/// Window position and size persistence service
pub mod window_settings;
