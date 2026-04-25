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
    /// Resolved module/runtime identifier when the log belongs to a module.
    pub module_id: Option<String>,
    /// Parsed time component extracted from the message when present.
    pub display_time: Option<String>,
    /// Normalized level used by the console UI.
    pub normalized_level: Option<String>,
    /// Parsed scope segment when present.
    pub scope: Option<String>,
    /// Precomputed summary message for console rendering.
    pub summary_message: Option<String>,
    /// Human-friendly source label for console rendering.
    pub source_label: Option<String>,
    /// CSS-friendly source class for console rendering.
    pub source_class: Option<String>,
    /// Page identifier extracted from navigation logs.
    pub page: Option<String>,
    /// Action extracted from module control logs.
    pub action: Option<String>,
    /// Expected manifest or artifact hint from error logs.
    pub expected: Option<String>,
}

struct LogStore {
    entries: VecDeque<LogEntry>,
}

struct RuntimeLogCollector;

struct ConsoleLogParser;

#[derive(Debug, Clone, Copy)]
enum RuntimeLogNamespace {
    Engine,
    Module,
}

static LOG_STORE: LazyLock<Mutex<LogStore>> = LazyLock::new(|| {
    Mutex::new(LogStore {
        entries: VecDeque::with_capacity(500),
    })
});

const MODULE_LOG_LIMIT: usize = 1000;

#[derive(Debug, Clone, Copy)]
struct CompactLocalTime;

impl FormatTime for CompactLocalTime {
    fn format_time(&self, writer: &mut Writer<'_>) -> std::fmt::Result {
        write!(
            writer,
            "{}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        )
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

    let entry = build_log_entry(now, source, level, message.to_string());

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

    logs.extend(RuntimeLogCollector::collect_since(since));
    logs.sort_by(|left, right| {
        left.timestamp
            .partial_cmp(&right.timestamp)
            .unwrap_or(Ordering::Equal)
    });

    logs
}

fn parse_runtime_log_line(
    namespace: RuntimeLogNamespace,
    runtime_id: &str,
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
        ..build_log_entry(
            timestamp,
            &infer_runtime_log_source(namespace, runtime_id),
            &parse_log_level(line),
            line.to_string(),
        )
    })
}

fn build_log_entry(timestamp: f64, source: &str, level: &str, message: String) -> LogEntry {
    let parsed = ConsoleLogParser::parse_message(&message, level);
    let normalized_source = normalize_log_source(source);

    LogEntry {
        timestamp,
        source: source.to_string(),
        level: level.to_string(),
        message,
        module_id: resolve_module_id(source, parsed.message.as_str()),
        display_time: parsed.time,
        normalized_level: parsed.level.clone(),
        scope: parsed.scope.clone(),
        summary_message: Some(build_summary_message(parsed.message.as_str())),
        source_label: Some(format_log_source(&normalized_source, source)),
        source_class: Some(if source.starts_with("module:") {
            "src-MODULE".to_string()
        } else {
            format!("src-{normalized_source}")
        }),
        page: extract_page(parsed.message.as_str()),
        action: extract_action(parsed.message.as_str()),
        expected: extract_expected(parsed.message.as_str()),
    }
}

#[derive(Debug, Clone)]
struct ParsedConsoleMessage {
    time: Option<String>,
    level: Option<String>,
    scope: Option<String>,
    message: String,
}

fn parse_levelled_console_message(raw_message: &str) -> Option<(Option<String>, &str, &str, &str)> {
    let (time, remainder) = if raw_message.len() > 20
        && raw_message
            .get(..19)
            .and_then(|text| chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").ok())
            .is_some()
        && raw_message.as_bytes().get(19).copied() == Some(b' ')
    {
        (
            raw_message
                .get(11..19)
                .map(std::string::ToString::to_string),
            raw_message.get(20..)?,
        )
    } else {
        (None, raw_message)
    };

    let bracket_open = remainder.strip_prefix('[')?;
    let level_end = bracket_open.find(']')?;
    let level = bracket_open.get(..level_end)?.trim();
    let after_level = bracket_open.get(level_end + 1..)?.trim_start();
    let separator = after_level.find(':')?;
    let scope = after_level.get(..separator)?.trim();
    let message = after_level.get(separator + 1..)?.trim_start();

    if level.is_empty() || scope.is_empty() || message.is_empty() {
        return None;
    }

    Some((time, level, scope, message))
}

fn parse_scoped_console_message(raw_message: &str) -> Option<(&str, &str)> {
    let bracket_open = raw_message.strip_prefix('[')?;
    let scope_end = bracket_open.find(']')?;
    let scope = bracket_open.get(..scope_end)?.trim();
    let message = bracket_open.get(scope_end + 1..)?.trim_start();
    if scope.is_empty() || message.is_empty() {
        return None;
    }
    Some((scope, message))
}

fn normalize_log_level(level: &str) -> Option<String> {
    let normalized = level.trim().to_ascii_uppercase();
    if normalized.is_empty() {
        return None;
    }

    if normalized == "WARNING" {
        Some("WARN".to_string())
    } else {
        Some(normalized)
    }
}

fn normalize_log_source(source: &str) -> String {
    source
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
        .collect::<String>()
        .to_ascii_uppercase()
}

fn format_source_part(part: &str) -> String {
    let normalized = part.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return String::new();
    }

    match normalized.as_str() {
        "ai" => "AI".to_string(),
        "api" => "API".to_string(),
        "bot" => "Bot".to_string(),
        "cpu" => "CPU".to_string(),
        "frontend" => "Frontend".to_string(),
        "gpu" => "GPU".to_string(),
        "llm" => "LLM".to_string(),
        "ram" => "RAM".to_string(),
        "sd" => "SD".to_string(),
        "system" => "System".to_string(),
        "ui" => "UI".to_string(),
        "vram" => "VRAM".to_string(),
        _ => {
            let mut chars = normalized.chars();
            match chars.next() {
                Some(first) => {
                    let mut label = first.to_uppercase().to_string();
                    label.push_str(chars.as_str());
                    label
                }
                None => String::new(),
            }
        }
    }
}

fn format_log_source(normalized_source: &str, original_source: &str) -> String {
    let source = original_source.trim();
    if let Some(module_source) = source.strip_prefix("module:") {
        return module_source
            .trim_start_matches("axelate-")
            .split('-')
            .filter(|part| !part.is_empty())
            .map(format_source_part)
            .collect::<Vec<_>>()
            .join(" ");
    }

    let label_source = if source.is_empty() {
        normalized_source.to_ascii_lowercase()
    } else {
        source.to_string()
    };

    label_source
        .trim_start_matches("axelate-")
        .split([':', '.', '_', '-'])
        .filter(|part| !part.is_empty())
        .map(format_source_part)
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_summary_message(message: &str) -> String {
    let message = message.trim();
    if contains_ignore_case(message, "manifest not found") {
        return "Manifest not found".to_string();
    }

    if let Some(page) = extract_token_after(message, "Navigating to:") {
        return format!("Page {page}");
    }
    if let Some(page) = extract_token_after(message, "Navigating back to:") {
        return format!("Back to {page}");
    }
    if let Some(page) = extract_token_after(message, "Navigating forward to:") {
        return format!("Forward to {page}");
    }
    if let Some(page) = extract_token_after(message, "Restored last page:") {
        return format!("Restore page {page}");
    }
    if let Some(page) = extract_token_after(message, "nav ->") {
        return format!("Page {page}");
    }
    if let Some(module_id) = extract_token_after(message, "Starting provider:") {
        return format!("Start provider {module_id}");
    }
    if let Some(module_id) = extract_token_after(message, "Switching provider to:") {
        return format!("Switch provider {module_id}");
    }
    if let Some(module_id) = extract_token_after(message, "Requesting stop for local module:") {
        return format!("Stop provider {module_id}");
    }
    if let Some(module_id) = extract_token_after(message, "Launching App:") {
        return format!("Launch app {module_id}");
    }
    if let Some((module_id, action)) = extract_control_summary(message) {
        return format!("Module {module_id}: {action}");
    }

    message
        .strip_prefix("Control failed: Error:")
        .map_or_else(|| message.to_string(), |trimmed| trimmed.trim().to_string())
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}

fn extract_token_after<'a>(message: &'a str, marker: &str) -> Option<&'a str> {
    let lower_message = message.to_ascii_lowercase();
    let lower_marker = marker.to_ascii_lowercase();
    let start = lower_message.find(&lower_marker)? + lower_marker.len();
    let token = message.get(start..)?.split_whitespace().next()?;
    if token.is_empty() { None } else { Some(token) }
}

fn extract_control_summary(message: &str) -> Option<(String, String)> {
    let start = message.find("Control ")? + "Control ".len();
    let tail = message.get(start..)?;
    let separator = tail.find("->")?;
    let module_id = tail.get(..separator)?.trim().to_string();
    let action = tail
        .get(separator + 2..)?
        .split_whitespace()
        .next()?
        .to_string();
    if module_id.is_empty() || action.is_empty() {
        return None;
    }
    Some((module_id, action))
}

fn extract_page(message: &str) -> Option<String> {
    [
        "Navigating to:",
        "Navigating back to:",
        "Navigating forward to:",
        "Restored last page:",
        "nav ->",
    ]
    .into_iter()
    .find_map(|marker| extract_token_after(message, marker).map(std::string::ToString::to_string))
}

fn extract_action(message: &str) -> Option<String> {
    extract_control_summary(message).map(|(_, action)| action)
}

fn extract_expected(message: &str) -> Option<String> {
    let marker = "Expected ";
    let lower_message = message.to_ascii_lowercase();
    let start = lower_message.find(&marker.to_ascii_lowercase())? + marker.len();
    let expected = message
        .get(start..)?
        .replace(" or ", " | ")
        .trim()
        .to_string();
    if expected.is_empty() {
        None
    } else {
        Some(expected)
    }
}

fn resolve_module_id(source: &str, message: &str) -> Option<String> {
    extract_module_id_from_source(source).or_else(|| resolve_module_id_from_text(message))
}

fn extract_module_id_from_source(source: &str) -> Option<String> {
    source
        .strip_prefix("module:")
        .map(std::string::ToString::to_string)
}

fn resolve_module_id_from_text(message: &str) -> Option<String> {
    const PREFIX_PATTERNS: &[&str] = &[
        "Launching App:",
        "Starting provider:",
        "Switching provider to:",
        "Requesting stop for local module:",
        "Stopping module:",
    ];
    const SUFFIX_PATTERNS: &[&str] = &[" successfully stopped"];

    if let Some(module_id) = extract_module_id_between(message, "Control ", " ->") {
        return Some(module_id);
    }

    for prefix in PREFIX_PATTERNS {
        if let Some(module_id) = extract_module_id_after_prefix(message, prefix) {
            return Some(module_id);
        }
    }

    for suffix in SUFFIX_PATTERNS {
        if let Some(module_id) = extract_module_id_before_suffix(message, "Module ", suffix) {
            return Some(module_id);
        }
    }

    None
}

fn extract_module_id_between(message: &str, prefix: &str, suffix: &str) -> Option<String> {
    let start = message.find(prefix)? + prefix.len();
    let tail = message.get(start..)?;
    let end = tail.find(suffix)?;
    sanitize_module_id(tail.get(..end)?)
}

fn extract_module_id_after_prefix(message: &str, prefix: &str) -> Option<String> {
    let start = message.find(prefix)? + prefix.len();
    sanitize_module_id(message.get(start..)?)
}

fn extract_module_id_before_suffix(message: &str, prefix: &str, suffix: &str) -> Option<String> {
    let start = message.find(prefix)? + prefix.len();
    let tail = message.get(start..)?;
    let end = tail.find(suffix)?;
    sanitize_module_id(tail.get(..end)?)
}

fn sanitize_module_id(raw: &str) -> Option<String> {
    let module_id = raw.split_whitespace().next().unwrap_or_default().trim();

    if module_id.is_empty()
        || !module_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return None;
    }

    Some(module_id.to_string())
}

fn infer_runtime_log_source(namespace: RuntimeLogNamespace, runtime_id: &str) -> String {
    match namespace {
        RuntimeLogNamespace::Engine => runtime_id.to_string(),
        RuntimeLogNamespace::Module => format!("module:{runtime_id}"),
    }
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
    RuntimeLogCollector::clear_runtime_logs();
}

/// Initializes the global tracing subscriber
pub fn init_global_logger() -> Result<tracing_appender::non_blocking::WorkerGuard, String> {
    let log_dir = &*crate::utils::paths::LOG_DIR;
    std::fs::create_dir_all(log_dir).map_err(|e| e.to_string())?;

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
                .with_timer(CompactLocalTime)
                .with_target(false),
        ) // Stdout
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_timer(CompactLocalTime)
                .with_target(false)
                .with_writer(non_blocking),
        ) // File
        .with(FrontendLayer) // UI Store
        .init();

    Ok(guard)
}

impl RuntimeLogCollector {
    fn collect_since(since: f64) -> Vec<LogEntry> {
        let mut entries = Vec::new();
        entries.extend(Self::collect_root(
            RuntimeLogNamespace::Engine,
            &crate::utils::paths::ENGINE_LOGS_DIR,
            since,
        ));
        entries.extend(Self::collect_root(
            RuntimeLogNamespace::Module,
            &crate::utils::paths::MODULE_LOGS_DIR,
            since,
        ));

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

    fn collect_root(namespace: RuntimeLogNamespace, root: &Path, since: f64) -> Vec<LogEntry> {
        let Ok(runtime_dirs) = fs::read_dir(root) else {
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
            entries.extend(Self::collect_runtime_entries(
                namespace,
                &runtime_id,
                &runtime_dir.path(),
                since,
            ));
        }

        entries
    }

    fn collect_runtime_entries(
        namespace: RuntimeLogNamespace,
        runtime_id: &str,
        log_dir: &Path,
        since: f64,
    ) -> Vec<LogEntry> {
        let Ok(log_files) = fs::read_dir(log_dir) else {
            return Vec::new();
        };

        let mut entries = Vec::new();
        for log_file in log_files.filter_map(Result::ok) {
            let path = log_file.path();
            if !Self::is_log_file(&path) {
                continue;
            }

            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };

            entries.extend(
                content
                    .lines()
                    .filter_map(|line| parse_runtime_log_line(namespace, runtime_id, line, since)),
            );
        }

        entries
    }

    fn clear_runtime_logs() {
        Self::clear_runtime_logs_in_root(&crate::utils::paths::ENGINE_LOGS_DIR);
        Self::clear_runtime_logs_in_root(&crate::utils::paths::MODULE_LOGS_DIR);
    }

    fn clear_runtime_logs_in_root(root: &Path) {
        let Ok(runtime_dirs) = fs::read_dir(root) else {
            return;
        };

        for runtime_dir in runtime_dirs.filter_map(Result::ok) {
            let Ok(log_files) = fs::read_dir(runtime_dir.path()) else {
                continue;
            };

            for log_file in log_files.filter_map(Result::ok) {
                let path = log_file.path();
                if Self::is_log_file(&path) {
                    let _ = fs::write(path, "");
                }
            }
        }
    }

    fn is_log_file(path: &Path) -> bool {
        path.extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))
    }
}

impl ConsoleLogParser {
    fn parse_message(raw_message: &str, fallback_level: &str) -> ParsedConsoleMessage {
        let raw_message = raw_message.trim();

        if let Some((time, level, scope, message)) = parse_levelled_console_message(raw_message) {
            return ParsedConsoleMessage {
                time,
                level: normalize_log_level(level),
                scope: Some(scope.to_string()),
                message: message.to_string(),
            };
        }

        if let Some((scope, message)) = parse_scoped_console_message(raw_message) {
            return ParsedConsoleMessage {
                time: None,
                level: normalize_log_level(fallback_level),
                scope: Some(scope.to_string()),
                message: message.to_string(),
            };
        }

        ParsedConsoleMessage {
            time: None,
            level: normalize_log_level(fallback_level),
            scope: None,
            message: raw_message.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{RuntimeLogNamespace, parse_runtime_log_line};

    #[test]
    fn module_runtime_log_line_uses_module_source_namespace() -> Result<(), String> {
        let entry = parse_runtime_log_line(
            RuntimeLogNamespace::Module,
            "axelate-telegram-bot",
            "2026-04-24 07:00:00 [INFO] Bot started",
            0.0,
        )
        .ok_or_else(|| "module runtime log entry".to_string())?;

        assert_eq!(entry.source, "module:axelate-telegram-bot");
        assert_eq!(entry.module_id.as_deref(), Some("axelate-telegram-bot"));
        assert_eq!(entry.source_label.as_deref(), Some("Parser"));
        Ok(())
    }

    #[test]
    fn engine_runtime_log_line_keeps_engine_source_namespace() -> Result<(), String> {
        let entry = parse_runtime_log_line(
            RuntimeLogNamespace::Engine,
            "llamacpp",
            "2026-04-24 07:00:00 [INFO] model loaded",
            0.0,
        )
        .ok_or_else(|| "engine runtime log entry".to_string())?;

        assert_eq!(entry.source, "llamacpp");
        assert_eq!(entry.module_id, None);
        assert_eq!(entry.source_label.as_deref(), Some("Llamacpp"));
        Ok(())
    }
}
