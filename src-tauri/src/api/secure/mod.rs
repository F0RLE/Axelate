use crate::errors::AppError;
use crate::infrastructure::crypto::secure_storage::SecureStorage;

#[tauri::command]
#[specta::specta]
/// Saves anAPI key securely to system credential storage
pub async fn save_secure_key(service: String, key: String) -> Result<(), AppError> {
    SecureStorage::save_key(service, key)
}

#[tauri::command]
#[specta::specta]
/// Retrieves an API key from system credential storage
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn get_secure_key(service: String) -> Result<Option<String>, AppError> {
    SecureStorage::get_key(&service)
}
