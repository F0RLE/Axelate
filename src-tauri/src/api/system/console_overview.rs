use crate::domain::engine::manager::canonical_engine_id;
use crate::domain::engine::types::EngineDefinition;
use crate::infrastructure::logging::LogEntry;
use crate::models::{SelectedModule, UIState};
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct ConsoleOverviewBuilder;

pub(super) struct ConsoleLabelFormatter;

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

const fn describe_status(status: ConsoleRuntimeStatus) -> &'static str {
    match status {
        ConsoleRuntimeStatus::Running => "Running",
        ConsoleRuntimeStatus::Starting => "Starting…",
        ConsoleRuntimeStatus::Failed => "Failed",
        ConsoleRuntimeStatus::Stopped => "Stopped",
    }
}

impl ConsoleOverviewBuilder {
    pub(super) async fn build(
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

    pub(super) fn collect_module_labels(
        modules: &std::collections::HashMap<String, SelectedModule>,
    ) -> BTreeMap<String, String> {
        modules
            .iter()
            .filter(|(category, module)| category.as_str() == "services" && module.type_ != "api")
            .map(|(_, module)| (module.id.clone(), module.name.clone()))
            .collect()
    }

    pub(super) fn collect_selected_engine_labels(
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

impl ConsoleLabelFormatter {
    pub(super) fn format_module_label(module_id: &str) -> String {
        module_id
            .trim_start_matches("axelate-")
            .split('-')
            .filter(|part| !part.is_empty())
            .map(Self::format_label_part)
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub(super) fn format_capability(
        capability: crate::domain::engine::types::Capability,
    ) -> String {
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
