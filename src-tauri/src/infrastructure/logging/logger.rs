use serde::Serialize;
use std::collections::VecDeque;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Adds a log entry to in-memory store
pub fn add_log(message: &str, source: &str, level: &str) {
    let mut store = LOG_STORE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();

    store.entries.push_back(LogEntry {
        timestamp: now,
        source: source.to_string(),
        level: level.to_string(),
        message: message.to_string(),
    });

    if store.entries.len() > 500 {
        store.entries.pop_front();
    }
}

/// Retrieves all log entries since a timestamp
pub fn get_logs_since(since: f64) -> Vec<LogEntry> {
    let store = LOG_STORE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    store
        .entries
        .iter()
        .filter(|e| e.timestamp > since)
        .cloned()
        .collect()
}

/// Clears all log entries from the store
pub fn clear_logs() {
    let mut store = LOG_STORE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    store.entries.clear();
}

// Global Logger Implementation
use log::{Level, LevelFilter, Metadata, Record, SetLoggerError};

struct FrontendLogger;

impl log::Log for FrontendLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= Level::Info
    }

    fn log(&self, record: &Record<'_>) {
        if self.enabled(record.metadata()) {
            // Filter out noisy internal logs
            let target = record.target();
            if target.contains("tao") || target.contains("wry") || target.contains("TAOPLATFORM") {
                return;
            }

            // Mirror to Stdout
            #[allow(clippy::print_stdout)] // Intentional console output for debugging
            {
                println!("[{}] {}", record.level(), record.args());
            }

            // Add to LogStore
            add_log(
                &record.args().to_string(),
                record.target(),
                &record.level().to_string().to_lowercase(),
            );
        }
    }

    fn flush(&self) {}
}

static LOGGER: FrontendLogger = FrontendLogger;

/// Initializes the global logger for backend-to-frontend log forwarding
pub fn init_global_logger() -> Result<(), SetLoggerError> {
    log::set_logger(&LOGGER).map(|()| log::set_max_level(LevelFilter::Info))
}
