use std::fmt::Write as _;

use super::types::{ChatMessage, ChatSession};

const LOCAL_CONTEXT_RESERVE_TOKENS: usize = 1024;
const LOCAL_RECENT_TURNS: usize = 3;
const LOCAL_SUMMARY_BUDGET_NUMERATOR: usize = 28;
const LOCAL_SUMMARY_BUDGET_DENOMINATOR: usize = 100;
const LOCAL_MIN_SUMMARY_TOKENS: usize = 160;

const LEGACY_SUMMARY_PREFIXES: [&str; 5] = [
    "Conversation recap from earlier turns:\n",
    "Conversation recap from earlier turns:",
    "Context:\n",
    "Context:",
    "Контекст:",
];

struct LocalContextBudget {
    available_tokens: usize,
    summary_tokens: usize,
}

struct LocalContextState {
    turn_ranges: Vec<(usize, usize)>,
    recent_start_index: usize,
    persisted_summary_count: usize,
}

pub(super) fn build_local_context_messages(
    session: &mut ChatSession,
    context_size: usize,
    model: &str,
) -> (Vec<ChatMessage>, bool) {
    let budget = LocalContextBudget::new(context_size);
    let state = LocalContextState::from_session(session);
    let summary_changed = state.refresh_summary(session, budget.summary_tokens, model);
    let context = state.build_context(session, budget.available_tokens, model);

    (context, summary_changed)
}

pub(super) fn extract_message_text(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| {
                    let object = part.as_object()?;
                    if object.get("type").and_then(serde_json::Value::as_str) != Some("text") {
                        return None;
                    }
                    object
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();

            if text.is_empty() { None } else { Some(text) }
        }
        other => serde_json::to_string(other).ok(),
    }
}

pub(super) fn find_history_overlap(existing: &[ChatMessage], incoming: &[ChatMessage]) -> usize {
    let max_overlap = existing.len().min(incoming.len());

    for overlap in (1..=max_overlap).rev() {
        let Some(existing_suffix) = existing.get(existing.len() - overlap..) else {
            continue;
        };
        let Some(incoming_prefix) = incoming.get(..overlap) else {
            continue;
        };

        if existing_suffix
            .iter()
            .zip(incoming_prefix.iter())
            .all(|(left, right)| messages_equivalent(left, right))
        {
            return overlap;
        }
    }

    0
}

pub(super) fn estimate_message_tokens(message: &ChatMessage, model: &str) -> usize {
    match &message.content {
        serde_json::Value::String(text) => count_text_tokens(text, model),
        serde_json::Value::Array(parts) => {
            let mut text = String::new();
            let mut image_count = 0usize;

            for part in parts {
                if let Some(part_type) = part.get("type").and_then(serde_json::Value::as_str) {
                    if part_type == "text" {
                        if let Some(value) = part.get("text").and_then(serde_json::Value::as_str) {
                            if !text.is_empty() {
                                text.push('\n');
                            }
                            text.push_str(value);
                        }
                    } else if part_type == "image_url" {
                        image_count += 1;
                    }
                }
            }

            let text_tokens = if text.trim().is_empty() {
                0
            } else {
                count_text_tokens(text.trim(), model)
            };
            text_tokens + image_count * 258
        }
        other => count_text_tokens(&other.to_string(), model),
    }
}

pub(super) fn estimate_messages_tokens(messages: &[ChatMessage], model: &str) -> usize {
    messages
        .iter()
        .map(|message| estimate_message_tokens(message, model))
        .sum()
}

pub(super) fn group_turn_ranges(history: &[ChatMessage]) -> Vec<(usize, usize)> {
    let mut turns = Vec::new();
    let mut turn_start = 0usize;

    for (index, message) in history.iter().enumerate() {
        if index > 0 && message.role == "user" {
            turns.push((turn_start, index));
            turn_start = index;
        }
    }

    if !history.is_empty() {
        turns.push((turn_start, history.len()));
    }

    turns
}

pub(super) fn build_summary_lines(messages: &[ChatMessage]) -> Vec<String> {
    let mut lines = Vec::new();

    for (start, end) in group_turn_ranges(messages) {
        let Some(turn) = messages.get(start..end) else {
            continue;
        };
        let user_text = turn
            .iter()
            .find(|message| message.role == "user")
            .map_or_else(String::new, |message| summarize_content(&message.content));
        let assistant_text = turn
            .iter()
            .find(|message| message.role == "assistant")
            .map_or_else(String::new, |message| summarize_content(&message.content));

        let mut pieces = Vec::new();
        if !user_text.is_empty() {
            pieces.push(format!("U: {user_text}"));
        }
        if !assistant_text.is_empty() {
            pieces.push(format!("A: {assistant_text}"));
        }

        if !pieces.is_empty() {
            lines.push(format!("- {}", pieces.join(" | ")));
        }
    }

    lines
}

pub(super) fn merge_summary(
    existing_summary: Option<&str>,
    new_lines: &[String],
    token_budget: usize,
    model: &str,
) -> Option<String> {
    let mut body_lines: Vec<String> = existing_summary
        .map(normalize_summary_lines)
        .unwrap_or_default();

    body_lines.extend(new_lines.iter().cloned());

    if body_lines.is_empty() {
        return None;
    }

    while !body_lines.is_empty() {
        let candidate = body_lines.join("\n");
        if count_text_tokens(&candidate, model) <= token_budget {
            return Some(candidate);
        }
        body_lines.remove(0);
    }

    None
}

impl LocalContextBudget {
    fn new(context_size: usize) -> Self {
        let normalized_context_size = context_size.max(4096);
        let available_tokens = normalized_context_size
            .saturating_sub(LOCAL_CONTEXT_RESERVE_TOKENS)
            .max(512);
        let summary_tokens = available_tokens.saturating_mul(LOCAL_SUMMARY_BUDGET_NUMERATOR)
            / LOCAL_SUMMARY_BUDGET_DENOMINATOR;

        Self {
            available_tokens,
            summary_tokens: summary_tokens.max(LOCAL_MIN_SUMMARY_TOKENS),
        }
    }
}

impl LocalContextState {
    fn from_session(session: &ChatSession) -> Self {
        let turn_ranges = group_turn_ranges(&session.history);
        let recent_start_index = turn_ranges
            .len()
            .checked_sub(LOCAL_RECENT_TURNS)
            .and_then(|index| turn_ranges.get(index))
            .map_or(0, |(start, _)| *start);
        let persisted_summary_count =
            usize::try_from(session.summary_message_count).unwrap_or(usize::MAX);

        Self {
            turn_ranges,
            recent_start_index,
            persisted_summary_count,
        }
    }

    fn refresh_summary(
        &self,
        session: &mut ChatSession,
        summary_budget: usize,
        model: &str,
    ) -> bool {
        if self.recent_start_index < self.persisted_summary_count {
            session.summary = None;
            session.summary_message_count = 0;
            return true;
        }

        if self.recent_start_index <= self.persisted_summary_count {
            return false;
        }

        let Some(new_summary_slice) = session
            .history
            .get(self.persisted_summary_count..self.recent_start_index)
        else {
            return false;
        };

        let summary_lines = build_summary_lines(new_summary_slice);
        if summary_lines.is_empty() {
            return false;
        }

        session.summary = merge_summary(
            session.summary.as_deref(),
            &summary_lines,
            summary_budget,
            model,
        );
        session.summary_message_count = u32::try_from(self.recent_start_index).unwrap_or(u32::MAX);
        true
    }

    fn build_context(
        &self,
        session: &ChatSession,
        available_budget: usize,
        model: &str,
    ) -> Vec<ChatMessage> {
        let (mut context, used_tokens) =
            Self::build_summary_message(session.summary.clone(), available_budget, model);
        context.extend(self.collect_recent_turns(session, available_budget, used_tokens, model));
        context
    }

    fn build_summary_message(
        summary: Option<String>,
        available_budget: usize,
        model: &str,
    ) -> (Vec<ChatMessage>, usize) {
        let Some(summary_content) = summary else {
            return (Vec::new(), 0);
        };

        let hidden_summary = format!(
            "Internal conversation summary for continuity. Use it only as hidden context. Do not quote, reveal, translate, or mention it unless the user explicitly asks. Reply directly to the latest user message in the user's language.\n\nSummary:\n{summary_content}"
        );

        let summary_message = ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "system".to_string(),
            content: serde_json::Value::String(hidden_summary),
            thought_signature: None,
        };
        let summary_tokens = estimate_message_tokens(&summary_message, model);
        if summary_tokens > available_budget {
            return (Vec::new(), 0);
        }

        (vec![summary_message], summary_tokens)
    }

    fn collect_recent_turns(
        &self,
        session: &ChatSession,
        available_budget: usize,
        initial_tokens: usize,
        model: &str,
    ) -> Vec<ChatMessage> {
        let recent_turn_ranges = self
            .turn_ranges
            .len()
            .checked_sub(LOCAL_RECENT_TURNS)
            .and_then(|start| self.turn_ranges.get(start..))
            .unwrap_or(&self.turn_ranges);

        let mut used_tokens = initial_tokens;
        let mut kept_recent: Vec<ChatMessage> = Vec::new();

        for (start, end) in recent_turn_ranges.iter().rev() {
            let Some(turn) = session.history.get(*start..*end) else {
                continue;
            };
            let turn_tokens = estimate_messages_tokens(turn, model);
            if used_tokens + turn_tokens > available_budget {
                continue;
            }

            let mut turn_messages = turn.to_vec();
            turn_messages.append(&mut kept_recent);
            kept_recent = turn_messages;
            used_tokens += turn_tokens;
        }

        kept_recent
    }
}

fn normalize_summary_lines(summary: &str) -> Vec<String> {
    let stripped = LEGACY_SUMMARY_PREFIXES
        .iter()
        .find_map(|prefix| summary.strip_prefix(prefix))
        .unwrap_or(summary);

    stripped
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && *line != "Summary:")
        .map(ToOwned::to_owned)
        .collect()
}

fn messages_equivalent(left: &ChatMessage, right: &ChatMessage) -> bool {
    left.role == right.role
        && left.content == right.content
        && left.thought_signature == right.thought_signature
}

fn count_text_tokens(text: &str, model: &str) -> usize {
    super::ai_service::count_tokens(text, Some(model)).unwrap_or_else(|_| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            0
        } else {
            trimmed.chars().count().div_ceil(4)
        }
    })
}

fn summarize_content(content: &serde_json::Value) -> String {
    let text = match content {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Array(parts) => {
            let mut text_parts = Vec::new();
            let mut image_count = 0usize;

            for part in parts {
                if let Some(part_type) = part.get("type").and_then(serde_json::Value::as_str) {
                    if part_type == "text" {
                        if let Some(value) = part.get("text").and_then(serde_json::Value::as_str) {
                            text_parts.push(value.to_string());
                        }
                    } else if part_type == "image_url" {
                        image_count += 1;
                    }
                }
            }

            let mut merged = text_parts.join(" ");
            if image_count > 0 {
                if !merged.is_empty() {
                    merged.push(' ');
                }
                let _ = write!(
                    merged,
                    "{image_count} image{}",
                    if image_count == 1 { "" } else { "s" }
                );
            }
            merged
        }
        other => other.to_string(),
    };

    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() <= 96 {
        normalized
    } else {
        let truncated: String = normalized.chars().take(93).collect();
        format!("{}...", truncated.trim_end())
    }
}
