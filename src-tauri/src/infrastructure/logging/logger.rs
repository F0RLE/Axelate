use serde::Serialize;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::Subscriber;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::Context;
use tracing_subscriber::prelude::*;

/// Log entry for frontend display
#[derive(Debug, Serialize, Clone, specta::Type)]
pub struct LogEntry {
    /// Unix timestamp
    pub timestamp: f64,
    /// Log source component
    pub source: String,
    /// Log level ("info", "warn", "error")
    pub level: String,
    /// Log message
    pub message: String,
}

struct LogStore {
    entries: VecDeque<LogEntry>,
}

static LOG_STORE: LazyLock<Mutex<LogStore>> = LazyLock::new(|| {
    Mutex::new(LogStore {
        entries: VecDeque::with_capacity(500),
    })
});

/// Tracing Layer that forwards logs to the in-memory store for the frontend
struct FrontendLayer;

impl<S> Layer<S> for FrontendLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let level = metadata.level().to_string().to_lowercase();
        let target = metadata.target().to_string();

        // Filter out noisy internal logs
        if target.contains("tao") || target.contains("wry") || target.contains("TAOPLATFORM") {
            return;
        }

        let mut visitor = LogVisitor::default();
        event.record(&mut visitor);
        let message = visitor.message;

        add_log(&message, &target, &level);
    }
}

#[derive(Default)]
struct LogVisitor {
    message: String,
}

impl tracing::field::Visit for LogVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        }
    }
}

fn get_log_dir() -> Result<PathBuf, String> {
    let app_data =
        std::env::var("APPDATA").map_err(|_| "Could not find APPDATA directory".to_string())?;
    let mut path = PathBuf::from(app_data);
    path.push("AxelateData");
    path.push("Logs");
    Ok(path)
}

/// Adds a log entry to in-memory store
pub fn add_log(message: &str, source: &str, level: &str) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();

    let entry = LogEntry {
        timestamp: now,
        source: source.to_string(),
        level: level.to_string(),
        message: message.to_string(),
    };

    if let Ok(mut store) = LOG_STORE.lock() {
        store.entries.push_back(entry);
        if store.entries.len() > 500 {
            store.entries.pop_front();
        }
    }
}

/// Retrieves all log entries since a timestamp
pub fn get_logs_since(since: f64) -> Vec<LogEntry> {
    if let Ok(store) = LOG_STORE.lock() {
        store
            .entries
            .iter()
            .filter(|e| e.timestamp > since)
            .cloned()
            .collect()
    } else {
        Vec::new()
    }
}

/// Clears all log entries from the store
pub fn clear_logs() {
    if let Ok(mut store) = LOG_STORE.lock() {
        store.entries.clear();
    }
}

/// Initializes the global tracing subscriber
pub fn init_global_logger() -> Result<(), String> {
    let log_dir = get_log_dir()?;
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    // Create file appender (rolling daily)
    let file_appender = tracing_appender::rolling::daily(&log_dir, "axelate.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // Note: _guard must be kept alive, but in Tauri/Axum we usually want static leakage or
    // managing it in the main loop. For simplicity, we'll let it leak for now as it's a global logger.
    // In production Rust, you'd store it in a global or AppState.
    std::mem::forget(guard);

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env()
            .add_directive(tracing_subscriber::filter::LevelFilter::INFO.into()))
        .with(tracing_subscriber::fmt::layer()) // Stdout
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking)) // File
        .with(FrontendLayer) // UI Store
        .init();

    Ok(())
}
