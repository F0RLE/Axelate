//! Provider response normalization.
//!
//! Converts OpenAI-compatible, Ollama-like, and llama.cpp-like response shapes
//! into Axelate's chat DTOs.

use reqwest::StatusCode;

use super::provider_payload::extract_message_text;
use super::types::{ChatReply, ChatResponse, TokenUsage};

pub(super) fn parse_non_stream_response(
    body: &serde_json::Value,
    message_id: String,
    model: String,
) -> ChatResponse {
    let usage = extract_token_usage(body);

    let reply_text = body
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .map(extract_message_text)
        .unwrap_or_default();

    if reply_text.trim().is_empty() {
        return ChatResponse {
            id: message_id,
            ok: false,
            reply: None,
            error: Some("Empty response body from AI provider".to_string()),
            model: Some(model),
            thought_signature: None,
            usage,
        };
    }

    ChatResponse {
        id: message_id,
        ok: true,
        reply: Some(ChatReply {
            text: reply_text,
            role: "assistant".to_string(),
        }),
        error: None,
        model: Some(model),
        thought_signature: None,
        usage,
    }
}

pub(super) fn build_api_error_response(
    message_id: String,
    model: String,
    status: StatusCode,
    error_text: &str,
) -> ChatResponse {
    ChatResponse {
        id: message_id,
        ok: false,
        reply: None,
        error: Some(format!("API Error {status}: {error_text}")),
        model: Some(model),
        thought_signature: None,
        usage: None,
    }
}

pub(super) fn extract_stream_error_message(json: &serde_json::Value) -> Option<String> {
    json.get("error")
        .and_then(extract_error_message)
        .or_else(|| json.get("errors").and_then(extract_error_message))
}

pub(super) fn extract_error_message(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(message) => {
            let trimmed = message.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        serde_json::Value::Array(items) => items.iter().find_map(extract_error_message),
        serde_json::Value::Object(object) => ["message", "detail", "error"]
            .iter()
            .find_map(|key| object.get(*key).and_then(extract_error_message)),
        _ => None,
    }
}

pub(super) fn extract_stream_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(|candidate| candidate.as_str())
                        .or_else(|| part.get("content").and_then(|candidate| candidate.as_str()))
                })
                .collect::<Vec<_>>()
                .join("");

            (!text.is_empty()).then_some(text)
        }
        serde_json::Value::Object(object) => object
            .get("text")
            .and_then(|candidate| candidate.as_str())
            .map(ToOwned::to_owned),
        _ => None,
    }
}

pub(super) fn extract_token_usage(json: &serde_json::Value) -> Option<TokenUsage> {
    let usage = json.get("usage").unwrap_or(json);
    let timings = json.get("timings");

    let prompt_tokens = read_usage_count(
        usage,
        timings,
        &[
            "prompt_tokens",
            "input_tokens",
            "prompt_eval_count",
            "prompt_n",
        ],
    );
    let completion_tokens = read_usage_count(
        usage,
        timings,
        &[
            "completion_tokens",
            "output_tokens",
            "eval_count",
            "predicted_n",
        ],
    );
    let total_tokens = read_usage_count(usage, timings, &["total_tokens"])
        .or_else(|| (prompt_tokens.is_some() || completion_tokens.is_some()).then_some(0))
        .map(|total| {
            if total > 0 {
                total
            } else {
                prompt_tokens.unwrap_or(0) + completion_tokens.unwrap_or(0)
            }
        });

    match (prompt_tokens, completion_tokens, total_tokens) {
        (None, None, None) => None,
        (prompt_tokens, completion_tokens, total_tokens) => Some(TokenUsage {
            prompt_tokens: prompt_tokens.unwrap_or(0),
            completion_tokens: completion_tokens.unwrap_or(0),
            total_tokens: total_tokens.unwrap_or(0),
        }),
    }
}

fn read_usage_count(
    usage: &serde_json::Value,
    timings: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<u32> {
    keys.iter()
        .find_map(|key| usage.get(*key).and_then(json_number_to_u32))
        .or_else(|| {
            timings.and_then(|timings| {
                keys.iter()
                    .find_map(|key| timings.get(*key).and_then(json_number_to_u32))
            })
        })
}

fn json_number_to_u32(value: &serde_json::Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .or_else(|| {
            value.as_f64().and_then(|value| {
                let rounded = value.round();
                if rounded.is_finite() && rounded >= 0.0 && rounded <= f64::from(u32::MAX) {
                    rounded.to_string().parse::<u32>().ok()
                } else {
                    None
                }
            })
        })
}
