use crate::errors::AppError;
use crate::services::secure_storage::SecureStorage;

#[tauri::command]
pub async fn save_secure_key(service: String, key: String) -> Result<(), AppError> {
    SecureStorage::save_key(service, key)
}

#[tauri::command]
pub async fn get_secure_key(service: String) -> Result<Option<String>, AppError> {
    SecureStorage::get_key(service)
}
