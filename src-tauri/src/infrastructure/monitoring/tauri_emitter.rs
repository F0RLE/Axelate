use tauri::{AppHandle, Emitter};

use crate::domain::monitoring::system_monitor::SystemStatsEmitter;
use crate::models::system::SystemStats;

/// Tauri-backed emitter for streaming monitoring snapshots to the frontend.
#[derive(Debug)]
pub struct TauriMonitoringEmitter {
    app: AppHandle,
}

impl TauriMonitoringEmitter {
    /// Creates a new Tauri monitoring emitter.
    #[must_use]
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl SystemStatsEmitter for TauriMonitoringEmitter {
    fn emit_stats(&self, stats: &SystemStats) {
        if let Err(error) = self.app.emit("system_stats", stats.clone()) {
            tracing::warn!("Failed to emit system stats: {error}");
        }
    }
}
