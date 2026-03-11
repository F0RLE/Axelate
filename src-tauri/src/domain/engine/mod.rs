//! Engine management subsystem
//!
//! Handles local AI engine lifecycle (start, stop, hot-swap),
//! request queuing, and capability-based routing.

/// Engine binary detection (installed check + path resolution)
pub mod detector;
/// Engine event emission trait
pub mod events;
/// Engine lifecycle manager (start/stop/hot-swap)
pub mod manager;
/// Sequential request queue
pub mod queue;
/// Engine definition loader from config
pub mod registry;
/// Core type definitions
pub mod types;
