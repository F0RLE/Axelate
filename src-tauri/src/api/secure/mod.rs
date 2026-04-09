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

#[tauri::command]
#[specta::specta]
/// Saves anAPI key securely to system credential storage
pub async fn save_secure_key(service: String, key: String) -> Result<(), AppError> {
    SecureStorage::save_key_async(service, key).await
}

#[tauri::command]
#[specta::specta]
/// Retrieves an API key from system credential storage
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn get_secure_key(service: String) -> Result<Option<String>, AppError> {
    SecureStorage::get_key_async(service).await
}

#[tauri::command]
#[specta::specta]
/// Checks whether a non-empty API key exists in secure storage
pub async fn has_secure_key(service: String) -> Result<bool, AppError> {
    let value = SecureStorage::get_key_async(service).await?;
    Ok(value.is_some_and(|key| !key.trim().is_empty()))
}

#[tauri::command]
#[specta::specta]
/// Returns non-sensitive metadata for a stored key without exposing the secret.
pub async fn get_secure_key_meta(service: String) -> Result<SecureKeyMeta, AppError> {
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
