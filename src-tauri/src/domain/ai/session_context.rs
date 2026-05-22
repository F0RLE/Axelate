use std::fmt::Write as _;

use super::types::{ChatMessage, ChatSession};

const LOCAL_CONTEXT_RESERVE_TOKENS: usize = 1024;
const LOCAL_RECENT_TURNS: usize = 3;
const LOCAL_SUMMARY_BUDGET_NUMERATOR: usize = 28;
const LOCAL_SUMMARY_BUDGET_DENOMINATOR: usize = 100;
const LOCAL_MIN_SUMMARY_TOKENS: usize = 160;
const LOCAL_MEDIUM_CONTEXT_TOKENS: usize = 32_768;
const LOCAL_LARGE_CONTEXT_TOKENS: usize = 131_072;
const LOCAL_MAX_CONTEXT_RESERVE_TOKENS: usize = 8_192;
const LOCAL_MAX_MIN_SUMMARY_TOKENS: usize = 2_048;

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
    recent_turns: usize,
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
    let state = LocalContextState::from_session(session, budget.recent_turns);
    let summary_changed = state.refresh_summary(session, budget.summary_tokens, model);
    let context = state.build_context(session, &budget, model);

    (context, summary_changed)
}

pub(super) fn extract_message_text(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => {
            let mut text = String::with_capacity(multimodal_text_capacity_hint(parts));

            for part in parts {
                if let Some(value) = multimodal_text_part(part) {
                    push_joined_text(&mut text, value, '\n');
                }
            }

            let text = text.trim().to_string();

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
        let reserve_tokens = scaled_context_reserve_tokens(normalized_context_size);
        let available_tokens = normalized_context_size
            .saturating_sub(reserve_tokens)
            .max(512);
        let summary_tokens = available_tokens
            .saturating_mul(summary_budget_percent(normalized_context_size))
            / LOCAL_SUMMARY_BUDGET_DENOMINATOR;
        let min_summary_tokens = scaled_min_summary_tokens(normalized_context_size);

        Self {
            available_tokens,
            summary_tokens: summary_tokens.max(min_summary_tokens),
            recent_turns: recent_turn_count(normalized_context_size),
        }
    }
}

fn scaled_context_reserve_tokens(context_size: usize) -> usize {
    let scaled_reserve = context_size / 16;
    scaled_reserve.clamp(
        LOCAL_CONTEXT_RESERVE_TOKENS,
        LOCAL_MAX_CONTEXT_RESERVE_TOKENS,
    )
}

const fn summary_budget_percent(context_size: usize) -> usize {
    if context_size >= LOCAL_LARGE_CONTEXT_TOKENS {
        36
    } else if context_size >= LOCAL_MEDIUM_CONTEXT_TOKENS {
        32
    } else {
        LOCAL_SUMMARY_BUDGET_NUMERATOR
    }
}

fn scaled_min_summary_tokens(context_size: usize) -> usize {
    let scaled_minimum = context_size / 64;
    scaled_minimum.clamp(LOCAL_MIN_SUMMARY_TOKENS, LOCAL_MAX_MIN_SUMMARY_TOKENS)
}

const fn recent_turn_count(context_size: usize) -> usize {
    if context_size >= LOCAL_LARGE_CONTEXT_TOKENS {
        8
    } else if context_size >= LOCAL_MEDIUM_CONTEXT_TOKENS {
        5
    } else {
        LOCAL_RECENT_TURNS
    }
}

impl LocalContextState {
    fn from_session(session: &ChatSession, recent_turns: usize) -> Self {
        let turn_ranges = group_turn_ranges(&session.history);
        let recent_start_index = turn_ranges
            .len()
            .checked_sub(recent_turns)
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

        let merged_summary = merge_summary(
            session.summary.as_deref(),
            &summary_lines,
            summary_budget,
            model,
        );
        let Some(merged_summary) = merged_summary else {
            return false;
        };

        session.summary = Some(merged_summary);
        session.summary_message_count = u32::try_from(self.recent_start_index).unwrap_or(u32::MAX);
        true
    }

    fn build_context(
        &self,
        session: &ChatSession,
        budget: &LocalContextBudget,
        model: &str,
    ) -> Vec<ChatMessage> {
        let (mut context, used_tokens) =
            Self::build_summary_message(session.summary.clone(), budget.available_tokens, model);
        context.extend(self.collect_recent_turns(
            session,
            budget.available_tokens,
            used_tokens,
            model,
            budget.recent_turns,
        ));
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
        recent_turns: usize,
    ) -> Vec<ChatMessage> {
        let recent_turn_ranges = self
            .turn_ranges
            .len()
            .checked_sub(recent_turns)
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
                break;
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

fn multimodal_text_capacity_hint(parts: &[serde_json::Value]) -> usize {
    let text_bytes = parts
        .iter()
        .filter_map(multimodal_text_part)
        .map(str::len)
        .sum::<usize>();
    text_bytes.saturating_add(parts.len().saturating_sub(1))
}

fn multimodal_text_part(part: &serde_json::Value) -> Option<&str> {
    let object = part.as_object()?;
    (object.get("type").and_then(serde_json::Value::as_str) == Some("text"))
        .then(|| object.get("text").and_then(serde_json::Value::as_str))
        .flatten()
}

fn push_joined_text(target: &mut String, value: &str, separator: char) {
    if !target.is_empty() {
        target.push(separator);
    }
    target.push_str(value);
}

fn collapse_whitespace(text: &str) -> String {
    let mut normalized = String::with_capacity(text.len());
    for part in text.split_whitespace() {
        push_joined_text(&mut normalized, part, ' ');
    }
    normalized
}

fn summarize_content(content: &serde_json::Value) -> String {
    let text = match content {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Array(parts) => {
            let mut merged = String::with_capacity(multimodal_text_capacity_hint(parts));
            let mut image_count = 0usize;

            for part in parts {
                if let Some(part_type) = part.get("type").and_then(serde_json::Value::as_str) {
                    if part_type == "text" {
                        if let Some(value) = part.get("text").and_then(serde_json::Value::as_str) {
                            push_joined_text(&mut merged, value, ' ');
                        }
                    } else if part_type == "image_url" {
                        image_count += 1;
                    }
                }
            }

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

    let normalized = collapse_whitespace(&text);
    if normalized.len() <= 96 {
        normalized
    } else {
        let truncated: String = normalized.chars().take(93).collect();
        format!("{}...", truncated.trim_end())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message(role: &str, text: &str) -> ChatMessage {
        ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: role.to_string(),
            content: serde_json::Value::String(text.to_string()),
            thought_signature: None,
        }
    }

    fn session_with_turns(turn_count: usize) -> ChatSession {
        let mut history = Vec::new();
        for index in 0..turn_count {
            history.push(message("user", &format!("user {index}")));
            history.push(message("assistant", &format!("assistant {index}")));
        }

        ChatSession {
            history,
            summary: None,
            summary_message_count: 0,
            last_updated: 0.0,
        }
    }

    #[test]
    fn local_context_budget_keeps_small_context_conservative() {
        let budget = LocalContextBudget::new(4096);

        assert_eq!(budget.available_tokens, 3072);
        assert_eq!(budget.summary_tokens, 860);
        assert_eq!(budget.recent_turns, LOCAL_RECENT_TURNS);
    }

    #[test]
    fn local_context_budget_scales_for_large_contexts() {
        let small = LocalContextBudget::new(4096);
        let large = LocalContextBudget::new(131_072);

        assert_eq!(large.available_tokens, 122_880);
        assert_eq!(large.recent_turns, 8);
        assert!(large.summary_tokens > small.summary_tokens);
        assert!(large.available_tokens > small.available_tokens);
    }

    #[test]
    fn local_context_summary_boundary_uses_scaled_recent_turns() {
        let session = session_with_turns(10);

        let small_state =
            LocalContextState::from_session(&session, LocalContextBudget::new(4096).recent_turns);
        let large_state = LocalContextState::from_session(
            &session,
            LocalContextBudget::new(131_072).recent_turns,
        );

        assert_eq!(small_state.recent_start_index, 14);
        assert_eq!(large_state.recent_start_index, 4);
    }

    #[test]
    fn refresh_summary_keeps_existing_summary_when_merge_does_not_fit() {
        let mut session = session_with_turns(5);
        session.summary = Some("existing summary".to_string());
        session.summary_message_count = 0;
        let state = LocalContextState::from_session(&session, LOCAL_RECENT_TURNS);

        let changed = state.refresh_summary(&mut session, 0, "local-model");

        assert!(!changed);
        assert_eq!(session.summary.as_deref(), Some("existing summary"));
        assert_eq!(session.summary_message_count, 0);
    }

    #[test]
    fn collect_recent_turns_stops_at_first_over_budget_turn() {
        let session = ChatSession {
            history: vec![
                message("user", "older user"),
                message("assistant", "older assistant"),
                message("user", &"large ".repeat(400)),
                message("assistant", &"large ".repeat(400)),
                message("user", "latest user"),
                message("assistant", "latest assistant"),
            ],
            summary: None,
            summary_message_count: 0,
            last_updated: 0.0,
        };
        let state = LocalContextState::from_session(&session, LOCAL_RECENT_TURNS);

        let kept = state.collect_recent_turns(&session, 80, 0, "local-model", LOCAL_RECENT_TURNS);

        let kept_text = kept
            .iter()
            .filter_map(|message| message.content.as_str())
            .collect::<Vec<_>>();
        assert_eq!(kept_text, vec!["latest user", "latest assistant"]);
    }

    #[test]
    fn extract_message_text_joins_multimodal_text_without_media() {
        let content = json!([
            { "type": "text", "text": "first" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,abc" } },
            { "type": "text", "text": "second" }
        ]);

        assert_eq!(
            extract_message_text(&content).as_deref(),
            Some("first\nsecond")
        );
    }

    #[test]
    fn extract_message_text_returns_none_for_media_only_content() {
        let content = json!([{ "type": "image_url", "image_url": { "url": "image.png" } }]);

        assert_eq!(extract_message_text(&content), None);
    }

    #[test]
    fn summarize_content_collapses_multimodal_text_and_counts_images() {
        let content = json!([
            { "type": "text", "text": "hello\nworld" },
            { "type": "image_url", "image_url": { "url": "image-1.png" } },
            { "type": "image_url", "image_url": { "url": "image-2.png" } }
        ]);

        assert_eq!(summarize_content(&content), "hello world 2 images");
    }
}
