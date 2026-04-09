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
    normalize_service_name(service) == "ai_session_id"
}

fn ensure_frontend_managed_secret(service: &str) -> Result<String, AppError> {
    let normalized = normalize_service_name(service);
    if !is_frontend_managed_secret(&normalized) {
        return Err(AppError::Validation(format!(
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
    SecureStorage::save_key_async(service, key).await
}

#[tauri::command]
#[specta::specta]
/// Retrieves an API key from system credential storage
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

    #[tokio::test]
    async fn get_secure_key_rejects_api_key_reads() {
        let err = get_secure_key("openrouter_api_key".to_string())
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation(message) if message.contains("not allowed")
        ));
    }

    #[test]
    fn frontend_secret_policy_allows_only_expected_service_names() {
        assert!(is_frontend_managed_secret("openrouter_api_key"));
        assert!(is_frontend_managed_secret("ai_session_id"));
        assert!(!is_frontend_managed_secret("license_data"));
        assert!(is_frontend_readable_secret("ai_session_id"));
        assert!(!is_frontend_readable_secret("openrouter_api_key"));
    }

    #[tokio::test]
    async fn get_secure_key_rejects_non_frontend_secret_reads() {
        let err = get_secure_key("license_data".to_string())
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation(message) if message.contains("not allowed")
        ));
    }

    #[tokio::test]
    async fn has_secure_key_rejects_non_frontend_secret_names() {
        let err = has_secure_key("license_data".to_string())
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation(message) if message.contains("frontend secure API")
        ));
    }
}
