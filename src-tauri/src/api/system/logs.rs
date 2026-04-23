use crate::errors::AppError;
use crate::infrastructure::logging::logger;
use crate::infrastructure::logging::{self as logs, LogEntry};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use tauri::State;

struct ConsoleOverviewBuilder;

struct ConsoleLabelFormatter;

/// Console log view metadata for frontend tabs.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ConsoleLogView {
    /// Stable view identifier.
    pub id: String,
    /// Human-readable label.
    pub label: String,
}

/// Runtime status used by the console overview.
#[derive(Debug, Clone, Copy, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ConsoleRuntimeStatus {
    /// Process is currently running.
    Running,
    /// Process is starting or switching.
    Starting,
    /// Process failed or status lookup failed.
    Failed,
    /// Process is stopped.
    Stopped,
}

/// Console status row for engines or modules.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ConsoleStatusItem {
    /// Stable item identifier.
    pub id: String,
    /// Human-readable label.
    pub label: String,
    /// Status category discriminator.
    pub kind: String,
    /// Runtime status.
    pub status: ConsoleRuntimeStatus,
    /// Additional detail text.
    pub detail: String,
}

/// Aggregated console metadata payload.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ConsoleOverview {
    /// Available log views including the default general tab.
    pub views: Vec<ConsoleLogView>,
    /// Runtime status rows for engines and modules.
    pub status_items: Vec<ConsoleStatusItem>,
}

#[tauri::command]
#[specta::specta]
/// Retrieves log entries since a given timestamp
pub fn get_logs(since: f64) -> Result<Vec<LogEntry>, AppError> {
    Ok(logs::get_frontend_logs_since(since))
}

#[tauri::command]
#[specta::specta]
/// Clears all stored log entries
pub fn clear_logs() -> Result<(), AppError> {
    logs::clear_logs();
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Returns aggregated console metadata for views and runtime statuses.
pub async fn get_console_overview(
    engine_manager: State<'_, Arc<crate::domain::engine::manager::EngineManager>>,
) -> Result<ConsoleOverview, AppError> {
    let engine_state = engine_manager.state().await;
    let logs = logger::get_frontend_logs_since(0.0);
    Ok(ConsoleOverviewBuilder::build(&engine_state, &logs).await)
}

#[tauri::command]
#[specta::specta]
/// Adds a single log entry to the log store
pub fn add_log(msg: &str, source: &str, level: &str) -> Result<(), AppError> {
    logs::add_log(msg, source, level);
    Ok(())
}
/// Batch log entry from frontend
#[derive(Debug, serde::Deserialize, specta::Type)]
pub struct BatchLogEntry {
    /// Log level ("info", "warn", "error")
    pub level: String,
    /// Log message content
    pub message: String,
}

#[tauri::command]
#[specta::specta]
/// Adds multiple log entries in batch from frontend
pub fn log_batch(logs: Vec<BatchLogEntry>) -> Result<(), AppError> {
    for log in logs {
        logs::add_log(&log.message, "Frontend", &log.level);
    }
    Ok(())
}

const fn describe_status(status: ConsoleRuntimeStatus) -> &'static str {
    match status {
        ConsoleRuntimeStatus::Running => "Running",
        ConsoleRuntimeStatus::Starting => "Starting…",
        ConsoleRuntimeStatus::Failed => "Failed",
        ConsoleRuntimeStatus::Stopped => "Stopped",
    }
}

impl ConsoleOverviewBuilder {
    async fn build(
        engine_state: &crate::domain::engine::types::EngineState,
        logs: &[LogEntry],
    ) -> ConsoleOverview {
        let module_ids = Self::collect_logged_module_ids(logs);
        let engine_labels = Self::collect_engine_labels(engine_state);
        let views = Self::build_views(&engine_labels, &module_ids);
        let status_items =
            Self::build_status_items(engine_state, &engine_labels, &module_ids).await;

        ConsoleOverview {
            views,
            status_items,
        }
    }

    fn collect_logged_module_ids(logs: &[LogEntry]) -> BTreeSet<String> {
        logs.iter()
            .filter_map(|entry| entry.module_id.clone())
            .collect()
    }

    fn collect_engine_labels(
        state: &crate::domain::engine::types::EngineState,
    ) -> BTreeMap<String, String> {
        match state {
            crate::domain::engine::types::EngineState::Ready { slots } => slots
                .iter()
                .map(|slot| (slot.engine.id.clone(), slot.engine.name.clone()))
                .collect(),
            _ => BTreeMap::new(),
        }
    }

    fn build_views(
        engine_labels: &BTreeMap<String, String>,
        module_ids: &BTreeSet<String>,
    ) -> Vec<ConsoleLogView> {
        let mut view_labels = engine_labels.clone();
        for module_id in module_ids {
            view_labels
                .entry(module_id.clone())
                .or_insert_with(|| ConsoleLabelFormatter::format_module_label(module_id));
        }

        let mut views = Vec::with_capacity(view_labels.len() + 1);
        views.push(ConsoleLogView {
            id: "general".to_string(),
            label: "General".to_string(),
        });
        views.extend(
            view_labels
                .into_iter()
                .map(|(id, label)| ConsoleLogView { id, label }),
        );
        views
    }

    async fn build_status_items(
        engine_state: &crate::domain::engine::types::EngineState,
        engine_labels: &BTreeMap<String, String>,
        module_ids: &BTreeSet<String>,
    ) -> Vec<ConsoleStatusItem> {
        let mut status_items = Self::build_engine_status_items(engine_state);
        for module_id in module_ids {
            status_items.push(Self::build_module_status_item(module_id, engine_labels).await);
        }
        status_items
    }

    async fn build_module_status_item(
        module_id: &str,
        engine_labels: &BTreeMap<String, String>,
    ) -> ConsoleStatusItem {
        let status_text = crate::domain::modules::controller::get_module_status(module_id).await;
        let status = if status_text == "running" {
            ConsoleRuntimeStatus::Running
        } else {
            ConsoleRuntimeStatus::Stopped
        };

        ConsoleStatusItem {
            id: format!("module:{module_id}"),
            label: engine_labels
                .get(module_id)
                .cloned()
                .unwrap_or_else(|| ConsoleLabelFormatter::format_module_label(module_id)),
            kind: "module".to_string(),
            status,
            detail: describe_status(status).to_string(),
        }
    }

    fn build_engine_status_items(
        state: &crate::domain::engine::types::EngineState,
    ) -> Vec<ConsoleStatusItem> {
        use crate::domain::engine::types::EngineState;

        match state {
            EngineState::Idle => vec![ConsoleStatusItem {
                id: "engine:idle".to_string(),
                label: "Engines".to_string(),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Stopped,
                detail: "No active engines".to_string(),
            }],
            EngineState::Starting { engine_id } => vec![ConsoleStatusItem {
                id: format!("engine:{engine_id}"),
                label: ConsoleLabelFormatter::format_module_label(engine_id),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Starting,
                detail: "Starting…".to_string(),
            }],
            EngineState::Swapping { from, to } => vec![ConsoleStatusItem {
                id: format!("engine:{to}"),
                label: ConsoleLabelFormatter::format_module_label(to),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Starting,
                detail: format!("Switching from {from}"),
            }],
            EngineState::Error { engine_id, message } => vec![ConsoleStatusItem {
                id: format!("engine:{engine_id}"),
                label: ConsoleLabelFormatter::format_module_label(engine_id),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Failed,
                detail: message.clone(),
            }],
            EngineState::Ready { slots } => slots
                .iter()
                .map(|slot| ConsoleStatusItem {
                    id: format!("engine:{}", slot.engine.id),
                    label: slot.engine.name.clone(),
                    kind: "engine".to_string(),
                    status: ConsoleRuntimeStatus::Running,
                    detail: ConsoleLabelFormatter::format_capability(slot.capability),
                })
                .collect(),
        }
    }
}

impl ConsoleLabelFormatter {
    fn format_module_label(module_id: &str) -> String {
        if module_id == "axelate-telegram-bot" {
            return "Telegram Bot".to_string();
        }

        module_id
            .trim_start_matches("axelate-")
            .split('-')
            .filter(|part| !part.is_empty())
            .map(Self::format_label_part)
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn format_capability(capability: crate::domain::engine::types::Capability) -> String {
        match capability {
            crate::domain::engine::types::Capability::Text => "text".to_string(),
            crate::domain::engine::types::Capability::Image => "image".to_string(),
            crate::domain::engine::types::Capability::Vision => "vision".to_string(),
        }
    }

    fn format_label_part(part: &str) -> String {
        let mut chars = part.chars();
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
