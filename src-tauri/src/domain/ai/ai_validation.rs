//! API key validation helpers for cloud AI providers.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Builds the outbound validation request without leaking secrets into the URL.
fn build_validation_request(
    client: &reqwest::Client,
    provider: &str,
    key: &str,
    base_url: Option<&str>,
) -> Result<reqwest::Request, crate::errors::AppError> {
    let request = if provider == "gemini" && key.starts_with("AIza") {
        client
            .get("https://generativelanguage.googleapis.com/v1beta/models")
            .header("x-goog-api-key", key)
    } else {
        let base_url = base_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("https://openrouter.ai/api/v1")
            .trim_end_matches('/');
        validate_openai_compatible_base_url(base_url)?;
        let models_url = format!("{base_url}/models");

        // OpenAI-compatible providers expose model listing behind the same
        // base URL used for chat completions.
        client
            .get(models_url)
            .header("Authorization", format!("Bearer {key}"))
    };

    request
        .build()
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })
}

fn validate_openai_compatible_base_url(base_url: &str) -> Result<(), crate::errors::AppError> {
    let parsed = reqwest::Url::parse(base_url).map_err(|_| {
        crate::errors::AppError::Validation("Unsupported validation base URL".to_string())
    })?;

    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(crate::errors::AppError::Validation(
            "Unsupported validation base URL".to_string(),
        ));
    }

    let Some(host) = parsed.host_str() else {
        return Err(crate::errors::AppError::Validation(
            "Unsupported validation base URL".to_string(),
        ));
    };

    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized_host == "localhost" {
        return Err(crate::errors::AppError::Validation(
            "Unsupported validation base URL".to_string(),
        ));
    }

    let normalized_ip_host = normalized_host
        .trim_start_matches('[')
        .trim_end_matches(']');
    if let Ok(ip) = normalized_ip_host.parse::<IpAddr>()
        && is_restricted_ip(ip)
    {
        return Err(crate::errors::AppError::Validation(
            "Unsupported validation base URL".to_string(),
        ));
    }

    Ok(())
}

fn is_restricted_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_restricted_ipv4(ip),
        IpAddr::V6(ip) => is_restricted_ipv6(ip),
    }
}

const fn is_restricted_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
}

fn is_restricted_ipv6(ip: Ipv6Addr) -> bool {
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_unique_local()
        || ip.is_unicast_link_local()
        || ip.to_ipv4_mapped().is_some_and(is_restricted_ipv4)
}

/// Validates an API key against OpenRouter (or generic OpenAI endpoint).
pub async fn validate_api_key(
    provider: String,
    key: String,
    base_url: Option<String>,
) -> Result<bool, crate::errors::AppError> {
    let key = key.trim().to_string();
    if key.is_empty()
        || key.chars().any(char::is_whitespace)
        || key.contains("://")
        || key.contains('/')
        || key.contains('?')
        || key.contains('&')
    {
        return Ok(false);
    }

    // Gemini native keys must start with AIza (unless routed via OpenAI-compatible proxy).
    if provider == "gemini" && key.starts_with("AIza") {
        // Validate directly against Google AI Studio.
    } else if key.len() < 8 {
        // Any reasonable API key should be at least 8 chars.
        return Ok(false);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    let request = build_validation_request(&client, &provider, &key, base_url.as_deref())?;

    // Explicitly drop key after building request.
    std::mem::drop(key);

    let res = client
        .execute(request)
        .await
        .map_err(|e| crate::errors::AppError::External {
            request_id: None,
            message: e.to_string(),
        })?;

    if !res.status().is_success() {
        return Ok(false);
    }

    let body = res.json::<serde_json::Value>().await.map_err(|e| {
        tracing::error!("[Validation] Failed to parse response JSON: {e}");
        crate::errors::AppError::External {
            request_id: None,
            message: "Malformed API response during validation".to_string(),
        }
    })?;

    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        return Ok(!data.is_empty());
    }

    if body.get("models").is_some() {
        return Ok(true);
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{build_validation_request, validate_api_key};

    #[tokio::test]
    async fn validate_api_key_rejects_obvious_non_keys() {
        assert!(
            !validate_api_key("openrouter".to_string(), String::new(), None)
                .await
                .expect("empty key should not error")
        );
        assert!(
            !validate_api_key(
                "openrouter".to_string(),
                "https://reddit.com/r/not-a-key".to_string(),
                None
            )
            .await
            .expect("url-like key should not error")
        );
        assert!(
            !validate_api_key("openrouter".to_string(), "not a real key".to_string(), None)
                .await
                .expect("whitespace key should not error")
        );
    }

    #[test]
    fn build_validation_request_keeps_gemini_key_out_of_url() {
        let client = reqwest::Client::new();
        let request = build_validation_request(&client, "gemini", "AIza-test-key", None)
            .expect("gemini request should build");

        assert_eq!(
            request.url().as_str(),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(
            request
                .headers()
                .get("x-goog-api-key")
                .expect("gemini header should exist"),
            "AIza-test-key"
        );
    }

    #[test]
    fn build_validation_request_uses_bearer_for_openrouter_keys() {
        let client = reqwest::Client::new();
        let request = build_validation_request(&client, "openrouter", "sk-or-test", None)
            .expect("openrouter request should build");

        assert_eq!(
            request.url().as_str(),
            "https://openrouter.ai/api/v1/models"
        );
        assert_eq!(
            request
                .headers()
                .get("Authorization")
                .expect("authorization header should exist"),
            "Bearer sk-or-test"
        );
    }

    #[test]
    fn build_validation_request_uses_configured_openai_compatible_base_url() {
        let client = reqwest::Client::new();
        let request = build_validation_request(
            &client,
            "groq",
            "gsk-test",
            Some("https://api.groq.com/openai/v1/"),
        )
        .expect("groq request should build");

        assert_eq!(
            request.url().as_str(),
            "https://api.groq.com/openai/v1/models"
        );
        assert_eq!(
            request
                .headers()
                .get("Authorization")
                .expect("authorization header should exist"),
            "Bearer gsk-test"
        );
    }

    #[test]
    fn build_validation_request_rejects_unsafe_base_urls() {
        let client = reqwest::Client::new();
        for base_url in [
            "http://api.groq.com/openai/v1",
            "https://localhost/v1",
            "https://127.0.0.1/v1",
            "https://[::ffff:127.0.0.1]/v1",
            "https://[::ffff:10.0.0.1]/v1",
            "https://10.0.0.2/v1",
            "file:///tmp/models",
            "not-a-url",
        ] {
            let error =
                build_validation_request(&client, "custom-text", "sk-test-key", Some(base_url))
                    .expect_err("unsafe validation URL should be rejected");
            assert!(
                error
                    .to_string()
                    .contains("Unsupported validation base URL")
            );
        }
    }
}
