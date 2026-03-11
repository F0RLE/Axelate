//! Engine event emission trait
//!
//! Decouples the domain-layer `EngineManager` from Tauri.
//! Any event backend (Tauri, test stub, noop) implements this trait.

/// Emits engine lifecycle events to the frontend or any other observer.
pub trait EngineEventEmitter: Send + Sync + 'static {
    /// One engine is being stopped and another started.
    fn emit_swapping(&self, from: &str, to: &str);
    /// An engine is starting up (before health check passes).
    fn emit_starting(&self, engine_id: &str);
    /// An engine has passed its health check and is ready.
    fn emit_ready(&self, engine_id: &str, endpoint: &str);
    /// An engine failed to start or encountered a runtime error.
    fn emit_error(&self, engine_id: &str, message: &str);
    /// An engine emitted a progress log line.
    fn emit_log(&self, engine_id: &str, line: &str);
}

/// No-op emitter for tests or when events are not needed.
#[derive(Debug)]
pub struct NoopEmitter;

impl EngineEventEmitter for NoopEmitter {
    fn emit_swapping(&self, _from: &str, _to: &str) {}
    fn emit_starting(&self, _engine_id: &str) {}
    fn emit_ready(&self, _engine_id: &str, _endpoint: &str) {}
    fn emit_error(&self, _engine_id: &str, _message: &str) {}
    fn emit_log(&self, _engine_id: &str, _line: &str) {}
}
