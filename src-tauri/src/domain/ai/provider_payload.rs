//! Provider payload normalization.
//!
//! Axelate speaks an OpenAI-compatible chat shape internally. This module owns
//! the provider-specific request differences, similar to Open WebUI's payload
//! conversion layer.

use super::types::{ChatRequest, WebSearchOptions};

pub(super) fn is_local_base_url(base_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base_url.trim()) else {
        return false;
    };

    let Some(host) = url.host_str() else {
        return false;
    };

    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

pub(super) fn build_chat_completion_payload(
    req: &ChatRequest,
    stream: bool,
    is_local: bool,
) -> serde_json::Map<String, serde_json::Value> {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "model".to_string(),
        serde_json::Value::String(req.model.clone()),
    );

    let mapped_messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|message| {
            serde_json::json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect();
    payload.insert(
        "messages".to_string(),
        serde_json::Value::Array(mapped_messages),
    );
    payload.insert("stream".to_string(), serde_json::Value::Bool(stream));

    if stream && !is_local {
        payload.insert(
            "stream_options".to_string(),
            serde_json::json!({ "include_usage": true }),
        );
    }

    if let Some(level) = normalized_reasoning_effort(req.thinking_level.as_deref())
        && !is_local
    {
        payload.insert(
            "reasoning".to_string(),
            serde_json::json!({ "effort": level }),
        );
    }

    let max_tokens = serde_json::json!(req.max_tokens.unwrap_or(8192));
    if is_local {
        payload.insert("max_tokens".to_string(), max_tokens);
    } else {
        payload.insert("max_completion_tokens".to_string(), max_tokens);
    }

    if !is_local
        && let Some(session_id) = req.session_id.as_ref().map(|value| value.trim())
        && !session_id.is_empty()
    {
        payload.insert(
            "session_id".to_string(),
            serde_json::Value::String(session_id.to_string()),
        );
    }

    if !is_local
        && should_attach_web_search(req)
        && let Some(web_search) = req.web_search.as_ref()
    {
        payload.insert(
            "tools".to_string(),
            serde_json::Value::Array(vec![build_web_search_tool(web_search)]),
        );
        payload.insert(
            "tool_choice".to_string(),
            serde_json::Value::String("auto".to_string()),
        );
    }

    payload
}

fn normalized_reasoning_effort(level: Option<&str>) -> Option<String> {
    let level = level?.trim().to_ascii_lowercase();
    if level.is_empty() {
        return None;
    }

    Some(if level == "off" {
        "none".to_string()
    } else {
        level
    })
}

pub(super) fn should_attach_web_search(req: &ChatRequest) -> bool {
    if !req
        .web_search
        .as_ref()
        .is_some_and(|web_search| web_search.enabled)
    {
        return false;
    }

    let Some(last_user_message) = req
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
    else {
        return false;
    };
    let text = extract_message_text(&last_user_message.content).to_lowercase();
    let text = text.trim();
    if text.is_empty() {
        return false;
    }

    const WEB_SEARCH_TRIGGERS: &[&str] = &[
        "актуаль",
        "интернет",
        "найди",
        "новост",
        "погугли",
        "поиск",
        "посмотри в сети",
        "свеж",
        "сейчас",
        "сегодня",
        "ссылка",
        "site:",
        "today",
        "latest",
        "current",
        "recent",
        "news",
        "search",
        "browse",
        "web",
        "internet",
        "look up",
        "price",
        "weather",
    ];

    text.starts_with("http://")
        || text.starts_with("https://")
        || text.contains(" http://")
        || text.contains(" https://")
        || WEB_SEARCH_TRIGGERS
            .iter()
            .any(|trigger| text.contains(trigger))
}

pub(super) fn extract_message_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => {
            let mut text = String::with_capacity(multimodal_text_capacity_hint(parts));
            for part in parts {
                let Some(value) = multimodal_text_part(part) else {
                    continue;
                };
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(value);
            }
            text
        }
        _ => String::new(),
    }
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
    (part.get("type")?.as_str()? == "text")
        .then(|| part.get("text")?.as_str())
        .flatten()
}

pub(super) fn build_web_search_tool(options: &WebSearchOptions) -> serde_json::Value {
    let mut parameters = serde_json::Map::new();
    parameters.insert(
        "engine".to_string(),
        serde_json::Value::String(
            options
                .engine
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "auto".to_string()),
        ),
    );
    parameters.insert(
        "max_results".to_string(),
        serde_json::json!(options.max_results.unwrap_or(5).clamp(1, 25)),
    );
    parameters.insert(
        "max_total_results".to_string(),
        serde_json::json!(options.max_total_results.unwrap_or(10).max(1)),
    );
    parameters.insert(
        "search_context_size".to_string(),
        serde_json::Value::String(
            options
                .search_context_size
                .clone()
                .filter(|value| matches!(value.as_str(), "low" | "medium" | "high"))
                .unwrap_or_else(|| "medium".to_string()),
        ),
    );

    if !options.allowed_domains.is_empty() {
        parameters.insert(
            "allowed_domains".to_string(),
            serde_json::Value::Array(
                options
                    .allowed_domains
                    .iter()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| serde_json::Value::String(value.trim().to_string()))
                    .collect(),
            ),
        );
    }

    if !options.excluded_domains.is_empty() {
        parameters.insert(
            "excluded_domains".to_string(),
            serde_json::Value::Array(
                options
                    .excluded_domains
                    .iter()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| serde_json::Value::String(value.trim().to_string()))
                    .collect(),
            ),
        );
    }

    serde_json::json!({
        "type": "openrouter:web_search",
        "parameters": parameters,
    })
}
