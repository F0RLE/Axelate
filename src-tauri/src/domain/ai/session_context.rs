use std::fmt::Write as _;

use super::types::ChatMessage;

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
        .map(|summary| {
            summary
                .strip_prefix("Conversation recap from earlier turns:\n")
                .unwrap_or(summary)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    body_lines.extend(new_lines.iter().cloned());

    if body_lines.is_empty() {
        return None;
    }

    while !body_lines.is_empty() {
        let candidate = format!(
            "Conversation recap from earlier turns:\n{}",
            body_lines.join("\n")
        );
        if count_text_tokens(&candidate, model) <= token_budget {
            return Some(candidate);
        }
        body_lines.remove(0);
    }

    None
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
