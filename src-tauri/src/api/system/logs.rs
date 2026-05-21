use crate::domain::engine::manager::canonical_engine_id;
use crate::domain::engine::types::EngineDefinition;
use crate::errors::AppError;
use crate::infrastructure::logging::logger;
use crate::infrastructure::logging::{self as logs, LogEntry};
use crate::models::{SelectedModule, UIState};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::process::Command;
use std::sync::Arc;
use tauri::State;

use super::log_targets::{
    canonical_console_view_id, clear_all_console_log_files, clear_console_log_target,
    resolve_console_log_target,
};

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
/// Retrieves log entries for a single console view since a given timestamp.
#[allow(clippy::needless_pass_by_value)]
pub fn get_console_logs(view_id: String, since: f64) -> Result<Vec<LogEntry>, AppError> {
    let view_id = canonical_console_view_id(&view_id);
    Ok(logs::get_frontend_logs_for_view(&view_id, since))
}

#[tauri::command]
#[specta::specta]
/// Clears all stored log entries
pub fn clear_logs() -> Result<(), AppError> {
    logs::clear_logs();
    clear_all_console_log_files(crate::utils::paths::LOG_DIR.as_path())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Clears log entries and files for a single console view.
#[allow(clippy::needless_pass_by_value)]
pub fn clear_console_logs(view_id: String) -> Result<(), AppError> {
    let canonical_view_id = canonical_console_view_id(&view_id);
    let target = resolve_console_log_target(&canonical_view_id)?;
    logs::clear_logs_for_view(&canonical_view_id);
    clear_console_log_target(&canonical_view_id, &target)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Returns the root folder where launcher logs are stored.
pub fn get_log_dir() -> Result<String, AppError> {
    std::fs::create_dir_all(crate::utils::paths::LOG_DIR.as_path())?;
    Ok(crate::utils::paths::LOG_DIR.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
/// Opens the root folder where launcher logs are stored.
pub fn open_log_dir() -> Result<(), AppError> {
    std::fs::create_dir_all(crate::utils::paths::LOG_DIR.as_path())?;
    open_folder(crate::utils::paths::LOG_DIR.as_path())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Opens the log folder for a single console view.
#[allow(clippy::needless_pass_by_value)]
pub fn open_console_log_target(view_id: String) -> Result<(), AppError> {
    let target = resolve_console_log_target(&view_id)?;
    fs::create_dir_all(&target)?;
    open_folder(&target)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
/// Returns aggregated console metadata for views and runtime statuses.
pub async fn get_console_overview(
    engine_manager: State<'_, Arc<crate::domain::engine::manager::EngineManager>>,
    ui_state_service: State<'_, crate::infrastructure::config::ui_state::UiStateService>,
) -> Result<ConsoleOverview, AppError> {
    let engine_state = engine_manager.state().await;
    let engine_definitions = engine_manager.list_definitions().await;
    let ui_state = ui_state_service
        .get_ui_state()
        .await
        .unwrap_or_else(|error| {
            tracing::warn!("Failed to load UI state for console overview, using defaults: {error}");
            UIState::default()
        });
    let logs = logger::get_frontend_logs_since(0.0);
    Ok(ConsoleOverviewBuilder::build(&engine_state, &engine_definitions, &ui_state, &logs).await)
}

#[tauri::command]
#[specta::specta]
/// Adds a single log entry to the log store
pub fn add_log(msg: &str, source: &str, level: &str) -> Result<(), AppError> {
    if source.trim().eq_ignore_ascii_case("frontend") {
        trace_frontend_log(level, msg);
    } else {
        logs::add_log(msg, source, level);
    }
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
        trace_frontend_log(&log.level, &log.message);
    }
    Ok(())
}

fn trace_frontend_log(level: &str, message: &str) {
    let normalized_level = level.trim().to_ascii_lowercase();
    match normalized_level.as_str() {
        "error" => tracing::error!(target: "frontend", message = message),
        "warn" | "warning" => tracing::warn!(target: "frontend", message = message),
        "debug" => {
            logs::add_log(message, "frontend", &normalized_level);
            tracing::debug!(target: "frontend", message = message);
        }
        "trace" => {
            logs::add_log(message, "frontend", &normalized_level);
            tracing::trace!(target: "frontend", message = message);
        }
        _ => tracing::info!(target: "frontend", message = message),
    }
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
        engine_definitions: &[EngineDefinition],
        ui_state: &UIState,
        logs: &[LogEntry],
    ) -> ConsoleOverview {
        let registry_engine_labels = Self::collect_registry_engine_labels(engine_definitions);
        let module_labels = Self::collect_module_labels(&ui_state.selected_modules);
        let module_ids = Self::collect_module_ids(logs, &module_labels);
        let mut engine_labels = Self::collect_engine_labels(engine_state);
        engine_labels.extend(Self::collect_selected_engine_labels(
            &ui_state.selected_modules,
        ));
        engine_labels.extend(Self::collect_logged_engine_labels(
            logs,
            &registry_engine_labels,
        ));
        let views = Self::build_views(&engine_labels, &module_labels, &module_ids);
        let status_items = Self::build_status_items(
            engine_state,
            &registry_engine_labels,
            &engine_labels,
            &module_labels,
            &module_ids,
        )
        .await;

        ConsoleOverview {
            views,
            status_items,
        }
    }

    fn collect_registry_engine_labels(
        engine_definitions: &[EngineDefinition],
    ) -> BTreeMap<String, String> {
        engine_definitions
            .iter()
            .map(|definition| {
                (
                    canonical_engine_id(&definition.id),
                    definition.name.trim().to_string(),
                )
            })
            .filter(|(_, name)| !name.is_empty())
            .collect()
    }

    fn collect_module_labels(
        modules: &std::collections::HashMap<String, SelectedModule>,
    ) -> BTreeMap<String, String> {
        modules
            .iter()
            .filter(|(category, module)| category.as_str() == "services" && module.type_ != "api")
            .map(|(_, module)| (module.id.clone(), module.name.clone()))
            .collect()
    }

    fn collect_selected_engine_labels(
        modules: &std::collections::HashMap<String, SelectedModule>,
    ) -> BTreeMap<String, String> {
        modules
            .iter()
            .filter(|(category, module)| {
                matches!(category.as_str(), "ai_text" | "ai_image") && module.type_ != "api"
            })
            .map(|(_, module)| (canonical_engine_id(&module.id), module.name.clone()))
            .collect()
    }

    fn collect_module_ids(
        logs: &[LogEntry],
        module_labels: &BTreeMap<String, String>,
    ) -> BTreeSet<String> {
        let mut module_ids: BTreeSet<String> = module_labels.keys().cloned().collect();
        module_ids.extend(
            logs.iter()
                .filter_map(|entry| entry.module_id.as_ref())
                .filter(|module_id| module_labels.contains_key(*module_id))
                .cloned(),
        );
        module_ids
    }

    fn collect_engine_labels(
        state: &crate::domain::engine::types::EngineState,
    ) -> BTreeMap<String, String> {
        let mut labels = BTreeMap::new();

        if let crate::domain::engine::types::EngineState::Ready { slots } = state {
            labels.extend(slots.iter().map(|slot| {
                (
                    canonical_engine_id(&slot.engine.id),
                    slot.engine.name.clone(),
                )
            }));
        }

        labels
    }

    fn collect_logged_engine_labels(
        logs: &[LogEntry],
        registry_engine_labels: &BTreeMap<String, String>,
    ) -> BTreeMap<String, String> {
        logs.iter()
            .filter(|entry| entry.module_id.is_none() && !entry.source.starts_with("module:"))
            .filter_map(|entry| {
                let engine_id = canonical_engine_id(&entry.source);
                let label = registry_engine_labels.get(&engine_id)?;
                Some((engine_id, label.clone()))
            })
            .collect()
    }

    fn build_views(
        engine_labels: &BTreeMap<String, String>,
        module_labels: &BTreeMap<String, String>,
        module_ids: &BTreeSet<String>,
    ) -> Vec<ConsoleLogView> {
        let mut views = Vec::with_capacity(engine_labels.len() + module_ids.len() + 1);
        let mut view_ids = BTreeSet::new();
        let mut view_labels = BTreeSet::new();
        views.push(ConsoleLogView {
            id: "general".to_string(),
            label: "Platform".to_string(),
        });
        view_ids.insert("general".to_string());
        view_labels.insert(Self::normalize_view_label("Platform"));

        for (id, label) in engine_labels {
            Self::push_unique_view(
                &mut views,
                &mut view_ids,
                &mut view_labels,
                ConsoleLogView {
                    id: format!("engine:{id}"),
                    label: label.clone(),
                },
            );
        }

        for module_id in module_ids {
            Self::push_unique_view(
                &mut views,
                &mut view_ids,
                &mut view_labels,
                ConsoleLogView {
                    id: format!("module:{module_id}"),
                    label: module_labels
                        .get(module_id)
                        .cloned()
                        .unwrap_or_else(|| ConsoleLabelFormatter::format_module_label(module_id)),
                },
            );
        }

        views
    }

    fn push_unique_view(
        views: &mut Vec<ConsoleLogView>,
        view_ids: &mut BTreeSet<String>,
        view_labels: &mut BTreeSet<String>,
        view: ConsoleLogView,
    ) {
        let normalized_label = Self::normalize_view_label(&view.label);
        if view_ids.insert(view.id.clone()) && view_labels.insert(normalized_label) {
            views.push(view);
        }
    }

    fn normalize_view_label(label: &str) -> String {
        label
            .trim()
            .to_ascii_lowercase()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    async fn build_status_items(
        engine_state: &crate::domain::engine::types::EngineState,
        registry_engine_labels: &BTreeMap<String, String>,
        engine_labels: &BTreeMap<String, String>,
        module_labels: &BTreeMap<String, String>,
        module_ids: &BTreeSet<String>,
    ) -> Vec<ConsoleStatusItem> {
        let mut status_items =
            Self::build_engine_status_items(engine_state, registry_engine_labels);
        let known_status_ids = status_items
            .iter()
            .map(|item| item.id.clone())
            .collect::<BTreeSet<_>>();
        for (engine_id, label) in engine_labels {
            let status_id = format!("engine:{engine_id}");
            if !known_status_ids.contains(&status_id) {
                status_items.push(ConsoleStatusItem {
                    id: status_id,
                    label: label.clone(),
                    kind: "engine".to_string(),
                    status: ConsoleRuntimeStatus::Stopped,
                    detail: describe_status(ConsoleRuntimeStatus::Stopped).to_string(),
                });
            }
        }
        for module_id in module_ids {
            status_items.push(
                Self::build_module_status_item(module_id, engine_labels, module_labels).await,
            );
        }
        status_items
    }

    async fn build_module_status_item(
        module_id: &str,
        engine_labels: &BTreeMap<String, String>,
        module_labels: &BTreeMap<String, String>,
    ) -> ConsoleStatusItem {
        let status_text = crate::domain::modules::controller::get_module_status(module_id).await;
        let status = if status_text == "running" {
            ConsoleRuntimeStatus::Running
        } else {
            ConsoleRuntimeStatus::Stopped
        };

        ConsoleStatusItem {
            id: format!("module:{module_id}"),
            label: module_labels
                .get(module_id)
                .cloned()
                .or_else(|| engine_labels.get(module_id).cloned())
                .unwrap_or_else(|| ConsoleLabelFormatter::format_module_label(module_id)),
            kind: "module".to_string(),
            status,
            detail: describe_status(status).to_string(),
        }
    }

    fn build_engine_status_items(
        state: &crate::domain::engine::types::EngineState,
        registry_engine_labels: &BTreeMap<String, String>,
    ) -> Vec<ConsoleStatusItem> {
        use crate::domain::engine::types::EngineState;

        match state {
            EngineState::Idle => vec![ConsoleStatusItem {
                id: "engine:idle".to_string(),
                label: "AI Engines".to_string(),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Stopped,
                detail: "No active engines".to_string(),
            }],
            EngineState::Starting { engine_id } => vec![ConsoleStatusItem {
                id: format!("engine:{}", canonical_engine_id(engine_id)),
                label: Self::engine_label_for_id(engine_id, registry_engine_labels),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Starting,
                detail: "Starting…".to_string(),
            }],
            EngineState::Swapping { from, to } => vec![ConsoleStatusItem {
                id: format!("engine:{}", canonical_engine_id(to)),
                label: Self::engine_label_for_id(to, registry_engine_labels),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Starting,
                detail: format!("Switching from {from}"),
            }],
            EngineState::Error { engine_id, message } => vec![ConsoleStatusItem {
                id: format!("engine:{}", canonical_engine_id(engine_id)),
                label: Self::engine_label_for_id(engine_id, registry_engine_labels),
                kind: "engine".to_string(),
                status: ConsoleRuntimeStatus::Failed,
                detail: message.clone(),
            }],
            EngineState::Ready { slots } => {
                let mut items: BTreeMap<String, ConsoleStatusItem> = BTreeMap::new();
                let mut label_to_id: BTreeMap<String, String> = BTreeMap::new();
                for slot in slots {
                    let label_key = Self::normalize_view_label(&slot.engine.name);
                    let id = label_to_id
                        .entry(label_key)
                        .or_insert_with(|| canonical_engine_id(&slot.engine.id))
                        .clone();
                    let detail = ConsoleLabelFormatter::format_capability(slot.capability);
                    items
                        .entry(id.clone())
                        .and_modify(|item| {
                            if !item.detail.split(", ").any(|part| part == detail) {
                                item.detail.push_str(", ");
                                item.detail.push_str(&detail);
                            }
                        })
                        .or_insert_with(|| ConsoleStatusItem {
                            id: format!("engine:{id}"),
                            label: slot.engine.name.clone(),
                            kind: "engine".to_string(),
                            status: ConsoleRuntimeStatus::Running,
                            detail,
                        });
                }
                items.into_values().collect()
            }
        }
    }

    fn engine_label_for_id(
        engine_id: &str,
        registry_engine_labels: &BTreeMap<String, String>,
    ) -> String {
        registry_engine_labels
            .get(&canonical_engine_id(engine_id))
            .cloned()
            .unwrap_or_else(|| ConsoleLabelFormatter::format_module_label(engine_id))
    }
}

fn open_folder(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(path).spawn().map(|_| ())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn().map(|_| ())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn().map(|_| ())
    }
}

impl ConsoleLabelFormatter {
    fn format_module_label(module_id: &str) -> String {
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::{
        ConsoleLabelFormatter, ConsoleOverviewBuilder, ConsoleRuntimeStatus,
        canonical_console_view_id, canonical_engine_id, clear_all_console_log_files,
        clear_console_log_target, resolve_console_log_target,
    };
    use crate::domain::engine::types::EngineDefinition;
    use crate::domain::engine::types::{Capability, EngineState, EngineStatus, SlotStatus};
    use crate::infrastructure::logging::LogEntry;
    use crate::models::{SelectedModule, UIState};
    use std::collections::HashMap;
    use std::fs;

    fn selected_module(id: &str, name: &str, type_: &str) -> SelectedModule {
        SelectedModule {
            id: id.to_string(),
            name: name.to_string(),
            name_key: None,
            icon: "box".to_string(),
            type_: type_.to_string(),
            desc_key: None,
            desc: String::new(),
        }
    }

    fn log_entry(module_id: Option<&str>) -> LogEntry {
        LogEntry {
            timestamp: 1.0,
            source: "test".to_string(),
            level: "info".to_string(),
            message: "message".to_string(),
            module_id: module_id.map(str::to_string),
            display_time: None,
            normalized_level: None,
            scope: None,
            summary_message: None,
            source_label: None,
            source_class: None,
            page: None,
            action: None,
            expected: None,
        }
    }

    fn engine_log_entry(source: &str) -> LogEntry {
        LogEntry {
            source: source.to_string(),
            ..log_entry(None)
        }
    }

    fn engine_definition(id: &str, name: &str) -> EngineDefinition {
        EngineDefinition {
            id: id.to_string(),
            name: name.to_string(),
            desc: String::new(),
            icon: String::new(),
            capabilities: vec![Capability::Text],
            binary: None,
            repo_url: None,
            version: "1.0.0".to_string(),
            default_port: 8081,
            default_context_size: 4096,
            config_schema: None,
            installed: false,
            installed_compute_modes: Vec::new(),
            managed_externally: false,
        }
    }

    #[test]
    fn canonicalizes_engine_ids_and_console_view_ids() {
        assert_eq!(canonical_engine_id(" sdcpp "), "sdcpp");
        assert_eq!(canonical_engine_id("llama cpp"), "llama-cpp");
        assert_eq!(canonical_engine_id("llama.cpp"), "llama-cpp");
        assert_eq!(canonical_engine_id("llama_cpp"), "llama-cpp");
        assert_eq!(canonical_console_view_id("engine:sdcpp"), "engine:sdcpp");
        assert_eq!(
            canonical_console_view_id(" module:example "),
            "module:example"
        );
    }

    #[test]
    fn formats_console_labels_and_capabilities() {
        assert_eq!(
            ConsoleLabelFormatter::format_module_label("axelate-open-webui"),
            "Open Webui"
        );
        assert_eq!(ConsoleLabelFormatter::format_module_label("--"), "");
        assert_eq!(
            ConsoleLabelFormatter::format_capability(Capability::Text),
            "text"
        );
        assert_eq!(
            ConsoleLabelFormatter::format_capability(Capability::Image),
            "image"
        );
        assert_eq!(
            ConsoleLabelFormatter::format_capability(Capability::Vision),
            "vision"
        );
    }

    #[test]
    fn resolves_console_log_targets_by_view_kind() {
        let engine_target = resolve_console_log_target("engine:sdcpp").unwrap();
        let module_target = resolve_console_log_target("module:comfyui").unwrap();
        let general_target = resolve_console_log_target("general").unwrap();

        assert!(engine_target.ends_with("sdcpp"));
        assert!(module_target.ends_with("comfyui"));
        assert_ne!(general_target, module_target);
    }

    #[test]
    fn rejects_invalid_module_console_log_targets() {
        let error = resolve_console_log_target("module:..\\..").unwrap_err();

        assert!(error.to_string().contains("invalid characters"));
    }

    #[test]
    fn rejects_invalid_engine_console_log_targets() {
        let error = resolve_console_log_target("engine:..\\..").unwrap_err();

        assert!(error.to_string().contains("invalid characters"));
    }

    #[test]
    fn rejects_unknown_console_log_targets() {
        let error = resolve_console_log_target("unknown").unwrap_err();

        assert!(error.to_string().contains("invalid console view id"));
    }

    #[test]
    fn clears_general_and_nested_console_logs_only() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let general = root.join("axelate.log");
        let nested_dir = root.join("nested");
        let nested_log = nested_dir.join("module.log");
        let nested_txt = nested_dir.join("keep.txt");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(&general, "general").unwrap();
        fs::write(&nested_log, "module").unwrap();
        fs::write(&nested_txt, "text").unwrap();

        clear_console_log_target("general", root).unwrap();
        assert_eq!(fs::read_to_string(&general).unwrap(), "");
        assert_eq!(fs::read_to_string(&nested_log).unwrap(), "module");

        clear_all_console_log_files(root).unwrap();
        assert_eq!(fs::read_to_string(&nested_log).unwrap(), "");
        assert_eq!(fs::read_to_string(&nested_txt).unwrap(), "text");
    }

    #[test]
    fn clear_console_log_target_ignores_missing_targets_and_non_log_files() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");
        let target = temp.path().join("target");
        let text_file = target.join("keep.txt");
        fs::create_dir_all(&target).unwrap();
        fs::write(&text_file, "keep").unwrap();

        clear_console_log_target("module:missing", &missing).unwrap();
        clear_console_log_target("module:target", &target).unwrap();

        assert_eq!(fs::read_to_string(text_file).unwrap(), "keep");
    }

    #[cfg(unix)]
    #[test]
    fn clear_console_log_files_skips_symlinked_entries() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let external = temp.path().join("external.log");
        let linked_log = root.join("linked.log");
        let regular_log = root.join("regular.log");
        fs::create_dir_all(&root).unwrap();
        fs::write(&external, "external").unwrap();
        fs::write(&regular_log, "regular").unwrap();
        std::os::unix::fs::symlink(&external, &linked_log).unwrap();

        clear_all_console_log_files(&root).unwrap();

        assert_eq!(fs::read_to_string(external).unwrap(), "external");
        assert_eq!(fs::read_to_string(regular_log).unwrap(), "");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_console_log_roots() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let symlink_root = temp.path().join("linked-root");
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&root, &symlink_root).unwrap();

        let error = clear_all_console_log_files(&symlink_root).unwrap_err();

        assert!(error.to_string().contains("cannot be a symlink"));
    }

    #[tokio::test]
    async fn console_overview_deduplicates_views_and_reports_engine_states() {
        let mut ui_state = UIState::default();
        ui_state.selected_modules.insert(
            "services".to_string(),
            selected_module("comfyui", "ComfyUI", "service"),
        );
        ui_state.selected_modules.insert(
            "ai_text".to_string(),
            selected_module("sdcpp", "Stable Diffusion.cpp", "local"),
        );
        ui_state.selected_modules.insert(
            "ai_image".to_string(),
            selected_module("cloud", "Cloud", "api"),
        );
        let logs = vec![log_entry(Some("comfyui")), log_entry(Some("unknown"))];
        let engine = EngineStatus {
            id: "sdcpp".to_string(),
            name: "Stable Diffusion.cpp".to_string(),
            capabilities: vec![Capability::Image],
            endpoint: "http://127.0.0.1:7860".to_string(),
            healthy: true,
        };
        let state = EngineState::Ready {
            slots: vec![
                SlotStatus {
                    capability: Capability::Image,
                    engine: engine.clone(),
                },
                SlotStatus {
                    capability: Capability::Vision,
                    engine,
                },
            ],
        };

        let engine_definitions = vec![engine_definition("sdcpp", "Stable Diffusion.cpp")];
        let overview =
            ConsoleOverviewBuilder::build(&state, &engine_definitions, &ui_state, &logs).await;
        let views = overview
            .views
            .iter()
            .map(|view| view.id.as_str())
            .collect::<Vec<_>>();
        let engine_status = overview
            .status_items
            .iter()
            .find(|item| item.id == "engine:sdcpp")
            .unwrap();

        assert_eq!(views, vec!["general", "engine:sdcpp", "module:comfyui"]);
        assert!(matches!(
            engine_status.status,
            ConsoleRuntimeStatus::Running
        ));
        assert_eq!(engine_status.detail, "image, vision");
    }

    #[tokio::test]
    async fn console_overview_names_logged_engines_from_registry_definitions() {
        let logs = vec![engine_log_entry("custom_engine")];
        let engine_definitions = vec![engine_definition("custom-engine", "Custom Engine")];

        let overview = ConsoleOverviewBuilder::build(
            &EngineState::Idle,
            &engine_definitions,
            &UIState::default(),
            &logs,
        )
        .await;

        let view = overview
            .views
            .iter()
            .find(|view| view.id == "engine:custom-engine");
        assert!(
            view.is_some(),
            "logged custom engine should create a console view"
        );
        let view = view.unwrap();

        assert_eq!(view.label, "Custom Engine");
    }

    #[tokio::test]
    async fn console_overview_builds_status_rows_for_non_ready_states() {
        let cases = [
            (
                EngineState::Idle,
                "engine:idle",
                ConsoleRuntimeStatus::Stopped,
                "No active engines",
            ),
            (
                EngineState::Starting {
                    engine_id: "llama-cpp".to_string(),
                },
                "engine:llama-cpp",
                ConsoleRuntimeStatus::Starting,
                "Starting…",
            ),
            (
                EngineState::Swapping {
                    from: "old".to_string(),
                    to: "new".to_string(),
                },
                "engine:new",
                ConsoleRuntimeStatus::Starting,
                "Switching from old",
            ),
            (
                EngineState::Error {
                    engine_id: "bad".to_string(),
                    message: "boom".to_string(),
                },
                "engine:bad",
                ConsoleRuntimeStatus::Failed,
                "boom",
            ),
        ];

        for (state, expected_id, expected_status, expected_detail) in cases {
            let overview = ConsoleOverviewBuilder::build(
                &state,
                &[engine_definition("new", "New Engine")],
                &UIState::default(),
                &Vec::<LogEntry>::new(),
            )
            .await;
            let item = overview.status_items.first().unwrap();
            assert_eq!(item.id, expected_id);
            assert!(
                std::mem::discriminant(&item.status) == std::mem::discriminant(&expected_status)
            );
            assert_eq!(item.detail, expected_detail);
        }
    }

    #[test]
    fn module_label_collection_excludes_api_modules() {
        let mut modules = HashMap::new();
        modules.insert(
            "services".to_string(),
            selected_module("service-module", "Service Module", "service"),
        );
        modules.insert(
            "ai_text".to_string(),
            selected_module("local-engine", "Local Engine", "local"),
        );
        modules.insert(
            "ai_image".to_string(),
            selected_module("api-engine", "API Engine", "api"),
        );

        let module_labels = ConsoleOverviewBuilder::collect_module_labels(&modules);
        let engine_labels = ConsoleOverviewBuilder::collect_selected_engine_labels(&modules);

        assert!(module_labels.contains_key("service-module"));
        assert!(engine_labels.contains_key("local-engine"));
        assert!(!engine_labels.contains_key("api-engine"));
    }
}
