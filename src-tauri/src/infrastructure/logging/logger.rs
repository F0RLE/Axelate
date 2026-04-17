use serde::Serialize;
use std::cmp::Ordering;
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::Subscriber;
use tracing_subscriber::Layer;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::time::FormatTime;
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

const MODULE_LOG_LIMIT: usize = 1000;

#[derive(Debug, Clone, Copy)]
struct CompactUtcTime;

impl FormatTime for CompactUtcTime {
    fn format_time(&self, writer: &mut Writer<'_>) -> std::fmt::Result {
        write!(writer, "{}", chrono::Utc::now().format("%Y-%m-%d %H:%M:%S"))
    }
}

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

fn is_frontend_relevant_log(entry: &LogEntry) -> bool {
    let message = entry.message.to_ascii_uppercase();
    let source = entry.source.to_ascii_uppercase();

    let is_bot_source = source.contains("CHATSERVICE")
        || source.contains("AIBRIDGE")
        || source.contains("AI_SERVICE");

    let is_ai_noise = message.contains("GEMINI_ERROR")
        || message.contains("ERROR 429")
        || message.contains("ERROR 400")
        || message.contains("ERROR 403")
        || message.contains("ERROR 500")
        || message.contains("QUOTA")
        || message.contains("PERMISSION_DENIED")
        || message.contains("INVALID_ARGUMENT")
        || message.contains("DEADLINE_EXCEEDED")
        || message.contains("FAILED_PRECONDITION")
        || message.contains("UNAVAILABLE")
        || message.contains("INTERNAL_ERROR");

    !(is_bot_source || is_ai_noise)
}

/// Retrieves frontend-facing log entries since a timestamp with noisy AI chatter removed.
pub fn get_frontend_logs_since(since: f64) -> Vec<LogEntry> {
    let mut logs: Vec<LogEntry> = get_logs_since(since)
        .into_iter()
        .filter(is_frontend_relevant_log)
        .collect();

    logs.extend(get_module_runtime_logs_since(since));
    logs.sort_by(|left, right| {
        left.timestamp
            .partial_cmp(&right.timestamp)
            .unwrap_or(Ordering::Equal)
    });

    logs
}

fn get_module_runtime_logs_since(since: f64) -> Vec<LogEntry> {
    let runtime_root = crate::utils::paths::LOG_DIR.join("Engines");
    let Ok(runtime_dirs) = fs::read_dir(&runtime_root) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for runtime_dir in runtime_dirs.filter_map(Result::ok) {
        let Ok(file_type) = runtime_dir.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let runtime_id = runtime_dir.file_name().to_string_lossy().to_string();
        collect_runtime_log_entries(&runtime_id, &runtime_dir.path(), since, &mut entries);
    }

    entries.sort_by(|left, right| {
        left.timestamp
            .partial_cmp(&right.timestamp)
            .unwrap_or(Ordering::Equal)
    });

    if entries.len() > MODULE_LOG_LIMIT {
        entries.split_off(entries.len() - MODULE_LOG_LIMIT)
    } else {
        entries
    }
}

fn collect_runtime_log_entries(
    runtime_id: &str,
    log_dir: &Path,
    since: f64,
    entries: &mut Vec<LogEntry>,
) {
    let Ok(log_files) = fs::read_dir(log_dir) else {
        return;
    };

    for log_file in log_files.filter_map(Result::ok) {
        let path = log_file.path();
        if path
            .extension()
            .is_none_or(|ext| !ext.eq_ignore_ascii_case("log"))
        {
            continue;
        }

        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };

        entries.extend(
            content
                .lines()
                .filter_map(|line| parse_runtime_log_line(runtime_id, &path, line, since)),
        );
    }
}

fn parse_runtime_log_line(
    runtime_id: &str,
    path: &Path,
    line: &str,
    since: f64,
) -> Option<LogEntry> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let timestamp = parse_log_timestamp(line)?;
    if timestamp <= since {
        return None;
    }

    Some(LogEntry {
        timestamp,
        source: infer_runtime_log_source(runtime_id, path),
        level: parse_log_level(line),
        message: line.to_string(),
    })
}

fn infer_runtime_log_source(runtime_id: &str, path: &Path) -> String {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case("runtime.log") {
        return format!("module:{runtime_id}");
    }

    runtime_id.to_string()
}

fn parse_log_timestamp(line: &str) -> Option<f64> {
    let timestamp_text = line.get(..19)?;
    chrono::NaiveDateTime::parse_from_str(timestamp_text, "%Y-%m-%d %H:%M:%S")
        .ok()
        .and_then(|timestamp| {
            let timestamp = timestamp.and_utc();
            let seconds = timestamp.timestamp().to_string().parse::<f64>().ok()?;
            let milliseconds = timestamp
                .timestamp_subsec_millis()
                .to_string()
                .parse::<f64>()
                .ok()?;
            Some(seconds + milliseconds / 1000.0)
        })
}

fn parse_log_level(line: &str) -> String {
    let rest = line.get(19..).unwrap_or_default().trim_start();
    let bracket_body = rest.strip_prefix('[').and_then(|value| {
        let end = value.find(']')?;
        value.get(..end)
    });

    match bracket_body.unwrap_or("info").to_ascii_lowercase().as_str() {
        "warning" => "warn".to_string(),
        value => value.to_string(),
    }
}

/// Clears all log entries from the store
pub fn clear_logs() {
    if let Ok(mut store) = LOG_STORE.lock() {
        store.entries.clear();
    }
    clear_module_runtime_logs();
}

fn clear_module_runtime_logs() {
    let runtime_root = crate::utils::paths::LOG_DIR.join("Engines");
    let Ok(runtime_dirs) = fs::read_dir(&runtime_root) else {
        return;
    };

    for runtime_dir in runtime_dirs.filter_map(Result::ok) {
        let Ok(log_files) = fs::read_dir(runtime_dir.path()) else {
            continue;
        };

        for log_file in log_files.filter_map(Result::ok) {
            let path = log_file.path();
            if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))
            {
                let _ = fs::write(path, "");
            }
        }
    }
}

fn normalize_engine_runtime_logs(log_dir: &Path) {
    let engines_root = log_dir.join("Engines");
    let Ok(entries) = fs::read_dir(&engines_root) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some((engine_id, stream_name)) = parse_legacy_engine_log_name(file_name) else {
            continue;
        };

        let target_dir = engines_root.join(engine_id);
        let _ = fs::create_dir_all(&target_dir);
        let target_path = target_dir.join(stream_name);
        if !target_path.exists() {
            let _ = fs::rename(&path, &target_path);
        }
    }
}

fn parse_legacy_engine_log_name(file_name: &str) -> Option<(&str, &str)> {
    if let Some(engine_id) = file_name.strip_suffix(".stdout.log") {
        return Some((engine_id, "stdout.log"));
    }
    if let Some(engine_id) = file_name.strip_suffix(".stderr.log") {
        return Some((engine_id, "stderr.log"));
    }
    None
}

/// Initializes the global tracing subscriber
pub fn init_global_logger() -> Result<tracing_appender::non_blocking::WorkerGuard, String> {
    let log_dir = &*crate::utils::paths::LOG_DIR;
    std::fs::create_dir_all(log_dir).map_err(|e| e.to_string())?;
    normalize_legacy_launcher_logs(log_dir);
    normalize_engine_runtime_logs(log_dir);

    // Keep the launcher log easy to open from the UI and external editors.
    let file_appender = tracing_appender::rolling::never(log_dir, "axelate.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let mut filter = tracing_subscriber::EnvFilter::from_default_env()
        .add_directive(tracing_subscriber::filter::LevelFilter::INFO.into());

    if let Ok(dir) = "tao=error".parse() {
        filter = filter.add_directive(dir);
    }
    if let Ok(dir) = "wry=error".parse() {
        filter = filter.add_directive(dir);
    }

    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_timer(CompactUtcTime)
                .with_target(false),
        ) // Stdout
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_timer(CompactUtcTime)
                .with_target(false)
                .with_writer(non_blocking),
        ) // File
        .with(FrontendLayer) // UI Store
        .init();

    Ok(guard)
}

fn normalize_legacy_launcher_logs(log_dir: &Path) {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !file_name.starts_with("axelate.log.") {
            continue;
        }

        let path = entry.path();
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let normalized = strip_ansi_sequences(&content);
        if normalized != content {
            let _ = fs::write(path, normalized);
        }
    }
}

fn strip_ansi_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek().is_some_and(|next| *next == '[') {
            let _ = chars.next();
            for code in chars.by_ref() {
                if code.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }

        output.push(ch);
    }

    output
}
