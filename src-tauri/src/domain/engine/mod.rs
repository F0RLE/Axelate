//! Engine management subsystem
//!
//! Handles local AI engine lifecycle (start, stop, hot-swap),
//! request queuing, and capability-based routing.

/// Engine configuration helpers
pub mod config;
/// Engine binary detection (installed check + path resolution)
pub mod detector;
mod engine_args;
mod engine_runtime;
/// Engine event emission trait
pub mod events;
/// Engine lifecycle manager (start/stop/hot-swap)
pub mod manager;
/// Engine definition loader from config
pub mod registry;
/// Core type definitions
pub mod types;
