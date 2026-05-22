//! Authorization and token management for the local integration API.

use crate::errors::AppError;
use std::collections::HashMap;
use std::sync::Mutex;

use super::types::AuthorizedClient;

/// Global module API token registry.
pub(super) static MODULE_API_TOKENS: std::sync::LazyLock<Mutex<HashMap<String, String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) fn issue_module_api_token(module_id: &str) -> Result<String, AppError> {
    let token = format!("{module_id}.{}", uuid::Uuid::new_v4().simple());
    let mut tokens = MODULE_API_TOKENS.lock().map_err(|_| AppError::Internal {
        request_id: None,
        message: format!("Failed to register module API token for {module_id}"),
    })?;
    tokens.insert(module_id.to_string(), token.clone());
    Ok(token)
}

/// Revokes the local API token for a module process.
pub fn revoke_module_api_token(module_id: &str) {
    match MODULE_API_TOKENS.lock() {
        Ok(mut tokens) => {
            tokens.remove(module_id);
        }
        Err(error) => {
            tracing::warn!("Failed to revoke module API token for {module_id}: {error}");
        }
    }
}

/// Revokes all module-scoped local API tokens.
pub fn revoke_all_module_api_tokens() {
    match MODULE_API_TOKENS.lock() {
        Ok(mut tokens) => {
            tokens.clear();
        }
        Err(error) => {
            tracing::warn!("Failed to revoke module API tokens: {error}");
        }
    }
}

pub(super) fn is_loopback_peer(peer_addr: Option<std::net::SocketAddr>) -> bool {
    peer_addr.is_some_and(|addr| addr.ip().is_loopback())
}

pub(super) fn is_authorized(headers: &HashMap<String, String>) -> bool {
    authorize_request(headers).is_some()
}

pub(super) fn authorize_request(headers: &HashMap<String, String>) -> Option<AuthorizedClient> {
    headers
        .get("authorization")
        .and_then(|value| authorized_bearer_client(value))
}

fn authorized_bearer_client(value: &str) -> Option<AuthorizedClient> {
    let mut parts = value.split_whitespace();
    let scheme = parts.next()?;
    let token = parts.next()?;
    if parts.next().is_some() || !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }

    authorized_token_client(token)
}

fn authorized_token_client(token: &str) -> Option<AuthorizedClient> {
    if token == super::api_token() || is_configured_agent_api_token(token) {
        return Some(AuthorizedClient::Launcher);
    }

    let (module_id, digest) = token.split_once('.')?;
    crate::domain::modules::downloader::validate_module_id(module_id).ok()?;
    if digest.is_empty() {
        return None;
    }
    MODULE_API_TOKENS
        .lock()
        .ok()
        .and_then(|tokens| tokens.get(module_id).cloned())
        .filter(|expected| expected == token)
        .map(|_| AuthorizedClient::Module(module_id.to_string()))
}

fn is_configured_agent_api_token(token: &str) -> bool {
    let Ok(configured) = std::env::var("AXELATE_AGENT_API_TOKEN") else {
        return false;
    };

    agent_api_token_matches(token, Some(configured.as_str()))
}

pub(super) fn agent_api_token_matches(token: &str, configured: Option<&str>) -> bool {
    let Some(configured) = configured.map(str::trim).filter(|value| value.len() >= 32) else {
        return false;
    };

    token == configured
}
