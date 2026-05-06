use crate::errors::AppError;
use crate::infrastructure::crypto::secure_storage::SecureStorage;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Clone, Serialize, Type)]
/// Non-sensitive metadata for a securely stored key.
pub struct SecureKeyMeta {
    /// Whether a non-empty key exists for the requested service.
    pub exists: bool,
    /// Character length of the stored key, if present.
    pub length: u32,
}

fn normalize_service_name(service: &str) -> String {
    service.trim().to_ascii_lowercase()
}

fn is_frontend_managed_secret(service: &str) -> bool {
    let normalized = normalize_service_name(service);
    normalized == "ai_session_id" || normalized.ends_with("_api_key")
}

fn is_frontend_readable_secret(service: &str) -> bool {
    is_frontend_managed_secret(service)
}

fn ensure_frontend_managed_secret(service: &str) -> Result<String, AppError> {
    let normalized = normalize_service_name(service);
    if !is_frontend_managed_secret(&normalized) {
        return Err(AppError::FrontendSecretForbidden(format!(
            "Secret is not allowed through the frontend secure API: {normalized}"
        )));
    }

    Ok(normalized)
}

#[tauri::command]
#[specta::specta]
/// Saves anAPI key securely to system credential storage
pub async fn save_secure_key(service: String, key: String) -> Result<(), AppError> {
    let service = ensure_frontend_managed_secret(&service)?;
    if key.trim().is_empty() {
        return SecureStorage::remove_key_async(service).await;
    }

    SecureStorage::save_key_async(service, key).await
}

#[tauri::command]
#[specta::specta]
/// Removes a frontend-managed secret from system credential storage
pub async fn remove_secure_key(service: String) -> Result<(), AppError> {
    let service = ensure_frontend_managed_secret(&service)?;
    SecureStorage::remove_key_async(service).await
}

#[tauri::command]
#[specta::specta]
/// Retrieves a frontend-managed secret from system credential storage
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn get_secure_key(service: String) -> Result<Option<String>, AppError> {
    let service = normalize_service_name(&service);
    if !is_frontend_readable_secret(&service) {
        return Err(AppError::Validation(
            "Direct secret retrieval from frontend is not allowed".to_string(),
        ));
    }

    SecureStorage::get_key_async(service).await
}

#[tauri::command]
#[specta::specta]
/// Checks whether a non-empty API key exists in secure storage
pub async fn has_secure_key(service: String) -> Result<bool, AppError> {
    let service = ensure_frontend_managed_secret(&service)?;
    let value = SecureStorage::get_key_async(service).await?;
    Ok(value.is_some_and(|key| !key.trim().is_empty()))
}

#[tauri::command]
#[specta::specta]
/// Returns non-sensitive metadata for a stored key without exposing the secret.
pub async fn get_secure_key_meta(service: String) -> Result<SecureKeyMeta, AppError> {
    let service = ensure_frontend_managed_secret(&service)?;
    let value = SecureStorage::get_key_async(service).await?;
    let normalized = value
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());

    let length = normalized.as_ref().map_or(0_u32, |key| {
        u32::try_from(key.chars().count()).unwrap_or(u32::MAX)
    });

    Ok(SecureKeyMeta {
        exists: normalized.is_some(),
        length,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn frontend_secret_policy_allows_only_expected_service_names() {
        assert!(is_frontend_managed_secret("openrouter_api_key"));
        assert!(is_frontend_managed_secret("ai_session_id"));
        assert!(!is_frontend_managed_secret("internal_service_token"));
        assert!(is_frontend_readable_secret("ai_session_id"));
        assert!(is_frontend_readable_secret("openrouter_api_key"));
    }

    #[tokio::test]
    async fn get_secure_key_rejects_non_frontend_secret_reads() {
        let err = get_secure_key("internal_service_token".to_string())
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation(message) if message.contains("not allowed")
        ));
    }

    #[tokio::test]
    async fn has_secure_key_rejects_non_frontend_secret_names() {
        let err = has_secure_key("internal_service_token".to_string())
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            AppError::FrontendSecretForbidden(message) if message.contains("frontend secure API")
        ));
    }

    #[tokio::test]
    async fn remove_secure_key_rejects_non_frontend_secret_names() {
        let err = remove_secure_key("internal_service_token".to_string())
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            AppError::FrontendSecretForbidden(message) if message.contains("frontend secure API")
        ));
    }
}
