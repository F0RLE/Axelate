//! Tauri-backed engine event emitter

use crate::domain::engine::events::EngineEventEmitter;
use serde_json::json;
use tauri::Emitter;

/// Emits engine lifecycle events via the Tauri AppHandle.
#[derive(Debug)]
pub struct TauriEngineEmitter {
    handle: tauri::AppHandle,
}

impl TauriEngineEmitter {
    /// Creates a new `TauriEngineEmitter` backed by the given AppHandle.
    pub const fn new(handle: tauri::AppHandle) -> Self {
        Self { handle }
    }
}

impl EngineEventEmitter for TauriEngineEmitter {
    fn emit_swapping(&self, from: &str, to: &str) {
        let _ = self
            .handle
            .emit("ai:engine:swapping", json!({ "from": from, "to": to }));
    }

    fn emit_starting(&self, engine_id: &str) {
        let _ = self
            .handle
            .emit("ai:engine:starting", json!({ "engine_id": engine_id }));
    }

    fn emit_ready(&self, engine_id: &str, endpoint: &str) {
        let _ = self.handle.emit(
            "ai:engine:ready",
            json!({ "engine_id": engine_id, "endpoint": endpoint }),
        );
    }

    fn emit_error(&self, engine_id: &str, message: &str) {
        let _ = self.handle.emit(
            "ai:engine:error",
            json!({ "engine_id": engine_id, "message": message }),
        );
    }

    fn emit_log(&self, engine_id: &str, line: &str) {
        if engine_id == "sdcpp" || engine_id == "stable-diffusion" {
            crate::app::tray::update_background_generation_progress(&self.handle, line);
        }
        let _ = self.handle.emit(
            "ai:engine:log",
            json!({ "engine_id": engine_id, "line": line }),
        );
    }
}
