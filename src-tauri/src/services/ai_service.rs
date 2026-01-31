//! AI Service implementation for handling LLM provider communication.
//!
//! This module provides the backend logic for interacting with various AI API providers
//! (OpenAI, Gemini, etc.) and managing their lifecycle within the Axelate.

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: serde_json::Value,
    pub thought_signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub provider: String, // "openai", "gemini", "local"
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub api_key: Option<String>,
    pub thinking_level: Option<String>, // "low", "high", "minimal"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub ok: bool,
    pub reply: Option<ChatReply>,
    pub error: Option<String>,
    pub model: Option<String>,
    pub thought_signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatReply {
    pub text: String,
    pub role: String,
}

#[derive(Debug, serde::Deserialize)]
struct ApiProviderConfig {
    id: String,
    #[serde(rename = "type")]
    provider_type: String, // "openai", "gemini"
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
}

/// Dispatches a chat request to the appropriate AI provider (OpenAI or Gemini).
///
/// This command implements streaming behavior via Tauri events.
#[tauri::command]
pub async fn send_chat_message(
    window: tauri::Window,
    request: ChatRequest,
) -> Result<ChatResponse, crate::errors::AppError> {
    // 1. Resolve provider configuration and endpoint base URL.
    let mut base_url = "https://api.openai.com/v1".to_string();
    let mut provider_type = "openai".to_string();

    match request.provider.as_str() {
        "gemini" => provider_type = "gemini".to_string(),
        "gpt" => {
            provider_type = "openai".to_string();
            base_url = "https://api.openai.com/v1".to_string();
        }

        _ => {}
    }

    let providers_path = crate::utils::paths::RESOURCES_DIR.join("api_providers.json");
    if providers_path.exists()
        && let Ok(content) = std::fs::read_to_string(&providers_path)
        && let Ok(providers) = serde_json::from_str::<Vec<ApiProviderConfig>>(&content)
        && let Some(p) = providers.iter().find(|p| p.id == request.provider)
    {
        provider_type = p.provider_type.clone();
        if let Some(url) = &p.base_url {
            base_url = url.clone();
        }
    }

    match provider_type.as_str() {
        "openai" => handle_openai(window, request, &base_url)
            .await
            .map_err(crate::errors::AppError::Internal),
        "gemini" => handle_gemini(window, request).await,

        _ => Ok(ChatResponse {
            ok: false,
            reply: None,
            error: Some(format!("Unknown provider type: {}", provider_type)),
            model: Some(request.model),
            thought_signature: None,
        }),
    }
}

async fn handle_openai(
    window: tauri::Window,
    req: ChatRequest,
    base_url: &str,
) -> Result<ChatResponse, String> {
    let api_key = req.api_key.ok_or("No API key provided")?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let mut payload = serde_json::Map::new();
    payload.insert(
        "model".to_string(),
        serde_json::Value::String(req.model.clone()),
    );
    payload.insert("messages".to_string(), serde_json::json!(req.messages));
    payload.insert("stream".to_string(), serde_json::Value::Bool(true));

    // Universal Thinking Parameter Injection
    if let Some(level) = req.thinking_level {
        match level.as_str() {
            // Map 'low'/'high' to provider-specific reasoning params
            "low" | "high" => {
                // OpenAI (o1/o3) uses 'reasoning_effort'
                payload.insert(
                    "reasoning_effort".to_string(),
                    serde_json::Value::String(level.clone()),
                );

                // Anthropic/OpenRouter logic (Budget tokens)
                let budget = if level == "high" { 16384 } else { 4096 };
                payload.insert(
                    "thinking".to_string(),
                    serde_json::json!({
                        "type": "enabled",
                        "budget_tokens": budget
                    }),
                );
                // Ensure max_tokens supports the budget
                payload.insert("max_tokens".to_string(), serde_json::json!(budget + 8192));
            }
            _ => {}
        }
    } else {
        // Default generic max tokens
        payload.insert("max_tokens".to_string(), serde_json::json!(8192));
    }

    let payload = serde_json::Value::Object(payload);

    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let res = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_default();
        return Ok(ChatResponse {
            ok: false,
            reply: None,
            error: Some(format!("API Error {}: {}", status, error_text)),
            model: Some(req.model),
            thought_signature: None,
        });
    }

    let mut stream = res.bytes_stream();
    let mut full_content = String::new();
    let mut buffer = String::new();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            // Remove processed line including newline
            buffer.drain(..=pos);

            if line.starts_with("data: ") {
                let data = line.trim_start_matches("data: ");
                // Terminate processing if [DONE] signal is received.
                if data == "[DONE]" {
                    break;
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data)
                    && let Some(choices) = json["choices"].as_array()
                    && let Some(choice) = choices.first()
                {
                    let delta = &choice["delta"];

                    // Direct extraction of reasoning tokens (GPT-5.2 / DeepSeek-V4 protocol)
                    if let Some(reasoning) = delta["reasoning_content"]
                        .as_str()
                        .or(delta["reasoning"].as_str())
                    {
                        let _ = window.emit("ai:thought:chunk", reasoning);
                    }

                    // Direct extraction of content tokens
                    if let Some(content) = delta["content"].as_str() {
                        full_content.push_str(content);
                        let _ = window.emit("ai:chat:chunk", content);
                    }
                }
            }
        }
    }

    Ok(ChatResponse {
        ok: true,
        reply: Some(ChatReply {
            text: full_content,
            role: "assistant".to_string(),
        }),
        error: None,
        model: Some(req.model),
        thought_signature: None,
    })
}

async fn handle_gemini(
    window: tauri::Window,
    req: ChatRequest,
) -> Result<ChatResponse, crate::errors::AppError> {
    let api_key = req.api_key.ok_or(crate::errors::AppError::Config(
        "No API key provided for Gemini".to_string(),
    ))?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| crate::errors::AppError::External(e.to_string()))?;

    let contents: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|msg| {
            let role = if msg.role == "assistant" {
                "model"
            } else {
                "user"
            };

            // Aggregate message parts into Gemini-specific contents body.
            // Aggregate message parts into Gemini-specific contents body.
            let mut parts_array: Vec<serde_json::Value> = match &msg.content {
                serde_json::Value::String(text) => vec![serde_json::json!({ "text": text })],
                serde_json::Value::Array(items) => items
                    .iter()
                    .filter_map(|item| {
                        let type_str = item.get("type").and_then(|t| t.as_str())?;
                        match type_str {
                            "text" => {
                                let text = item.get("text").and_then(|t| t.as_str())?;
                                Some(serde_json::json!({ "text": text }))
                            }
                            "image_url" => {
                                let url = item.get("image_url")?.get("url")?.as_str()?;
                                if let Some((mime, data)) = parse_data_uri(url) {
                                    Some(serde_json::json!({
                                        "inline_data": {
                                            "mime_type": mime,
                                            "data": data
                                        }
                                    }))
                                } else {
                                    None
                                }
                            }
                            _ => None,
                        }
                    })
                    .collect(),
                _ => vec![serde_json::json!({ "text": "" })],
            };

            // Inject thought_signature if present (Gemini 3 Requirement)
            if let Some(sig) = &msg.thought_signature
                && let Some(first_part) = parts_array.get_mut(0)
                && let Some(obj) = first_part.as_object_mut()
            {
                obj.insert(
                    "thoughtSignature".to_string(),
                    serde_json::Value::String(sig.clone()),
                );
            }

            serde_json::json!({
                "role": role,
                "parts": parts_array
            })
        })
        .collect();

    let mut generation_config = serde_json::Map::new();
    if let Some(level) = &req.thinking_level {
        let mut thinking_config = serde_json::Map::new();
        thinking_config.insert(
            "thinkingLevel".to_string(),
            serde_json::Value::String(level.clone()),
        );
        // Enable thought summaries in the stream (2026 Spec)
        thinking_config.insert("includeThoughts".to_string(), serde_json::Value::Bool(true));
        generation_config.insert(
            "thinkingConfig".to_string(),
            serde_json::Value::Object(thinking_config),
        );
    }

    let payload = serde_json::json!({
        "contents": contents,
        "generationConfig": generation_config
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        req.model, api_key
    );

    let max_retries = 3;
    let mut retry_count = 0;

    loop {
        let res_result = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await;

        match res_result {
            Ok(res) => {
                if !res.status().is_success() {
                    let status = res.status();

                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        if retry_count < max_retries {
                            let wait_time =
                                std::time::Duration::from_secs(2u64.pow(retry_count + 1)); // 2s, 4s, 8s

                            // Send structured event for frontend localization
                            let payload = serde_json::json!({
                                "code": "GEMINI_QUOTA_RETRY",
                                "wait_seconds": wait_time.as_secs()
                            });
                            let _ = window.emit("ai:status:retry", payload.to_string());

                            tokio::time::sleep(wait_time).await;
                            retry_count += 1;
                            continue;
                        }

                        return Ok(ChatResponse {
                            ok: false,
                            reply: None,
                            error: Some("ui.gemini.error.quota".to_string()),
                            model: Some(req.model.clone()),
                            thought_signature: None,
                        });
                    }

                    let error_msg = if status == reqwest::StatusCode::FORBIDDEN
                        || status == reqwest::StatusCode::UNAUTHORIZED
                    {
                        "ui.gemini.error.auth".to_string()
                    } else if status == reqwest::StatusCode::SERVICE_UNAVAILABLE {
                        "ui.gemini.error.unavailable".to_string()
                    } else {
                        res.text()
                            .await
                            .unwrap_or_else(|_| "Unknown error".to_string())
                    };

                    return Ok(ChatResponse {
                        ok: false,
                        reply: None,
                        error: Some(error_msg),
                        model: Some(req.model),
                        thought_signature: None,
                    });
                }

                // Success - process stream
                let mut stream = res.bytes_stream();
                let mut full_content = String::new();
                let mut thought_signature: Option<String> = None;
                let mut buffer = String::new();

                while let Some(item) = stream.next().await {
                    let chunk =
                        item.map_err(|e| crate::errors::AppError::External(e.to_string()))?;
                    let chunk_str = String::from_utf8_lossy(&chunk);
                    buffer.push_str(&chunk_str);

                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer.drain(..=pos);

                        if line.starts_with("data: ") {
                            let data = line.trim_start_matches("data: ");
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data)
                                && let Some(parts) =
                                    json["candidates"][0]["content"]["parts"].as_array()
                            {
                                for part in parts {
                                    // Extract integrated reasoning trace (handles string or boolean flag per 2026 specs)
                                    let is_thought = part["thought"].as_bool().unwrap_or(false);
                                    if is_thought {
                                        if let Some(th) = part["text"].as_str() {
                                            let _ = window.emit("ai:thought:chunk", th);
                                        }
                                    } else if let Some(th) = part["thought"].as_str() {
                                        let _ = window.emit("ai:thought:chunk", th);
                                    } else if let Some(t) = part["text"].as_str() {
                                        // Extract primary text response
                                        full_content.push_str(t);
                                        let _ = window.emit("ai:chat:chunk", t);
                                    }

                                    // Retrieve thought signature for session verification
                                    if let Some(sig) =
                                        part.get("thoughtSignature").and_then(|s| s.as_str())
                                    {
                                        thought_signature = Some(sig.to_string());
                                    }
                                }
                            }
                        }
                    }
                }

                return Ok(ChatResponse {
                    ok: true,
                    reply: Some(ChatReply {
                        text: full_content,
                        role: "model".to_string(),
                    }),
                    error: None,
                    model: Some(req.model),
                    thought_signature,
                });
            }
            Err(e) => {
                return Ok(ChatResponse {
                    ok: false,
                    reply: None,
                    error: Some(format!("Request failed: {}", e)),
                    model: Some(req.model),
                    thought_signature: None,
                });
            }
        }
    }
}

fn parse_data_uri(uri: &str) -> Option<(String, String)> {
    if !uri.starts_with("data:") {
        return None;
    }
    let parts: Vec<&str> = uri.splitn(2, ',').collect();
    if parts.len() != 2 {
        return None;
    }

    let meta = parts[0];
    let data = parts[1];

    let mime_part = meta.strip_prefix("data:")?;
    let mime = mime_part.split(';').next()?.to_string();

    Some((mime, data.to_string()))
}
