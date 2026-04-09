#![allow(unsafe_code)]
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};

/// Encrypted secure data container
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SecureData {
    /// Key-value store for secure keys
    pub keys: HashMap<String, String>,
}

/// Secure storage manager for encrypted keys
#[derive(Debug)]
pub struct SecureStorage;

use crate::errors::AppError;

static STORE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[cfg(test)]
static TEST_STORE_DIR: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

impl SecureStorage {
    fn lock_store() -> Result<MutexGuard<'static, ()>, AppError> {
        STORE_LOCK.lock().map_err(|_| AppError::External {
            request_id: None,
            message: "Secure storage lock is poisoned".to_string(),
        })
    }

    fn get_store_path() -> Result<PathBuf, AppError> {
        #[cfg(test)]
        let path_buf = {
            let override_dir = TEST_STORE_DIR.lock().map_err(|_| AppError::External {
                request_id: None,
                message: "Secure storage test path lock is poisoned".to_string(),
            })?;
            override_dir
                .clone()
                .unwrap_or_else(|| crate::utils::paths::CONFIG_DIR.as_path().to_path_buf())
        };

        #[cfg(not(test))]
        let path_buf = crate::utils::paths::CONFIG_DIR.as_path().to_path_buf();

        let path = path_buf.as_path();

        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| AppError::Io(e.to_string()))?;
        }

        Ok(path.join("secure.enc"))
    }

    /// Derives a 32-byte key from the machine UID and a static pepper.
    /// This binds the encryption to the current device.
    fn get_encryption_key() -> Result<[u8; 32], AppError> {
        let machine_id = machine_uid::get().map_err(|e| AppError::External {
            request_id: None,
            message: format!("Failed to get machine ID: {e}"),
        })?;

        // "Pepper" to ensure the key isn't just the raw ID
        let input = format!("AXELATE_SECURE_SALT_{machine_id}");

        // SHA-256 hash to get exactly 32 bytes
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        let result = hasher.finalize();

        let mut key = [0u8; 32];
        key.copy_from_slice(&result);
        Ok(key)
    }

    /// Encrypts `data` and atomically writes it to the store path.
    fn encrypt_and_save(data: &SecureData) -> Result<(), AppError> {
        let json_bytes =
            serde_json::to_vec(data).map_err(|e| AppError::Serialization(e.to_string()))?;

        let key_bytes = Self::get_encryption_key()?;
        let cipher = Aes256Gcm::new(&key_bytes.into());

        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext =
            cipher
                .encrypt(nonce, json_bytes.as_ref())
                .map_err(|e| AppError::External {
                    request_id: None,
                    message: format!("Encryption failure: {e}"),
                })?;

        let mut payload = Vec::with_capacity(12 + ciphertext.len());
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);

        let path = Self::get_store_path()?;
        let pending_path = path.with_extension("pending");
        let backup_path = path.with_extension("bak");

        let mut file = fs::File::create(&pending_path).map_err(|e| AppError::Io(e.to_string()))?;
        use std::io::Write;
        file.write_all(&payload)
            .map_err(|e| AppError::Io(e.to_string()))?;
        file.sync_all().map_err(|e| AppError::Io(e.to_string()))?;
        drop(file);

        if backup_path.exists() {
            fs::remove_file(&backup_path).map_err(|e| AppError::Io(e.to_string()))?;
        }

        if path.exists() {
            fs::rename(&path, &backup_path).map_err(|e| AppError::Io(e.to_string()))?;
        }

        if let Err(error) = fs::copy(&pending_path, &path) {
            if backup_path.exists() {
                let _ = fs::rename(&backup_path, &path);
            }
            let _ = fs::remove_file(&pending_path);
            return Err(AppError::Io(error.to_string()));
        }

        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .and_then(|file| file.sync_all())
            .map_err(|e| AppError::Io(e.to_string()))?;

        if pending_path.exists() {
            fs::remove_file(&pending_path).map_err(|e| AppError::Io(e.to_string()))?;
        }

        if backup_path.exists() {
            fs::remove_file(&backup_path).map_err(|e| AppError::Io(e.to_string()))?;
        }

        Ok(())
    }

    /// Saves an encrypted key to secure storage
    pub fn save_key(service: String, value: String) -> Result<(), AppError> {
        let _guard = Self::lock_store()?;
        let mut data = Self::load_data()?;
        data.keys.insert(service, value);
        Self::encrypt_and_save(&data)
    }

    /// Saves an encrypted key without blocking the async runtime.
    pub async fn save_key_async(service: String, value: String) -> Result<(), AppError> {
        tauri::async_runtime::spawn_blocking(move || Self::save_key(service, value))
            .await
            .map_err(|e| AppError::External {
                request_id: None,
                message: format!("Secure storage task join failure: {e}"),
            })?
    }

    /// Retrieves an encrypted key from secure storage
    pub fn get_key(service: &str) -> Result<Option<String>, AppError> {
        let _guard = Self::lock_store()?;
        let data = Self::load_data()?;
        Ok(data.keys.get(service).cloned())
    }

    /// Retrieves an encrypted key without blocking the async runtime.
    pub async fn get_key_async(service: String) -> Result<Option<String>, AppError> {
        tauri::async_runtime::spawn_blocking(move || Self::get_key(&service))
            .await
            .map_err(|e| AppError::External {
                request_id: None,
                message: format!("Secure storage task join failure: {e}"),
            })?
    }

    /// Removes an encrypted key from secure storage
    pub fn remove_key(service: &str) -> Result<(), AppError> {
        let _guard = Self::lock_store()?;
        let mut data = Self::load_data()?;
        if data.keys.remove(service).is_some() {
            Self::encrypt_and_save(&data)?;
        }
        Ok(())
    }

    /// Removes an encrypted key without blocking the async runtime.
    pub async fn remove_key_async(service: String) -> Result<(), AppError> {
        tauri::async_runtime::spawn_blocking(move || Self::remove_key(&service))
            .await
            .map_err(|e| AppError::External {
                request_id: None,
                message: format!("Secure storage task join failure: {e}"),
            })?
    }

    fn load_data() -> Result<SecureData, AppError> {
        let path = Self::get_store_path()?;
        let pending_path = path.with_extension("pending");
        let backup_path = path.with_extension("bak");

        if !path.exists() {
            if backup_path.exists() {
                tracing::warn!("Recovering secure storage from backup file");
                fs::rename(&backup_path, &path).map_err(|e| AppError::Io(e.to_string()))?;
            } else if pending_path.exists() {
                tracing::warn!("Recovering secure storage from pending file");
                fs::rename(&pending_path, &path).map_err(|e| AppError::Io(e.to_string()))?;
            }
        }

        if !path.exists() {
            return Ok(SecureData {
                keys: HashMap::new(),
            });
        }

        let file_content = fs::read(&path).map_err(|e| AppError::Io(e.to_string()))?;

        if file_content.len() < 12 {
            return Err(AppError::Validation(
                "File corrupted (too short)".to_string(),
            ));
        }

        // Split Nonce and Ciphertext
        let (nonce_bytes, ciphertext) = file_content.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let key_bytes = Self::get_encryption_key()?;
        let cipher = Aes256Gcm::new(&key_bytes.into());

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| AppError::External {
                request_id: None,
                message: "Decryption failed".to_string(),
            })?;

        let data: SecureData = serde_json::from_slice(&plaintext)
            .map_err(|e| AppError::Serialization(e.to_string()))?;

        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used, clippy::redundant_clone)]
    use super::*;
    use std::sync::{LazyLock, Mutex};

    static TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn set_test_store_dir(path: PathBuf) {
        *TEST_STORE_DIR.lock().unwrap() = Some(path);
    }

    fn clear_test_store_dir() {
        *TEST_STORE_DIR.lock().unwrap() = None;
    }

    #[test]
    fn test_secure_storage_lifecycle() {
        let _guard = TEST_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        set_test_store_dir(temp_dir.path().to_path_buf());
        // Test Data
        let service = "openai_api_key".to_string();
        let secret = "sk-unique-secret-123".to_string();
        let expected_path = SecureStorage::get_store_path().unwrap();

        if expected_path.exists() {
            std::fs::remove_file(&expected_path).unwrap();
        }

        // 1. Save Key
        let result = SecureStorage::save_key(service.clone(), secret.clone());
        assert!(result.is_ok(), "Failed to save key: {:?}", result.err());

        // 2. Verify File Exists
        assert!(expected_path.exists(), "Encrypted file was not created");

        // 3. Verify Encryption Integrity (Read Raw)
        let content = std::fs::read(&expected_path).unwrap();
        let content_str = String::from_utf8(content.clone());
        if let Ok(s) = content_str {
            assert!(!s.contains(&secret), "Plaintext secret found in file!");
        }

        // 4. Get Key (Decrypt)
        let loaded = SecureStorage::get_key(&service).unwrap();
        assert_eq!(
            loaded,
            Some(secret),
            "Decrypted value does not match original"
        );

        // 5. Test Missing Key
        let missing = SecureStorage::get_key("non_existent").unwrap();
        assert_eq!(missing, None, "Found key that shouldn't exist");

        std::fs::remove_file(&expected_path).unwrap();
        let backup_path = expected_path.with_extension("bak");
        let pending_path = expected_path.with_extension("pending");
        if backup_path.exists() {
            std::fs::remove_file(backup_path).unwrap();
        }
        if pending_path.exists() {
            std::fs::remove_file(pending_path).unwrap();
        }
        clear_test_store_dir();
    }

    #[test]
    fn test_secure_storage_recovers_backup_when_main_file_missing() {
        let _guard = TEST_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        set_test_store_dir(temp_dir.path().to_path_buf());
        let expected_path = SecureStorage::get_store_path().unwrap();
        let backup_path = expected_path.with_extension("bak");
        let pending_path = expected_path.with_extension("pending");

        if expected_path.exists() {
            std::fs::remove_file(&expected_path).unwrap();
        }
        if backup_path.exists() {
            std::fs::remove_file(&backup_path).unwrap();
        }
        if pending_path.exists() {
            std::fs::remove_file(&pending_path).unwrap();
        }

        let data = SecureData {
            keys: HashMap::from([("ai_session_id".to_string(), "session-123".to_string())]),
        };
        SecureStorage::encrypt_and_save(&data).unwrap();
        std::fs::rename(&expected_path, &backup_path).unwrap();

        let loaded = SecureStorage::get_key("ai_session_id").unwrap();
        assert_eq!(loaded, Some("session-123".to_string()));
        assert!(
            expected_path.exists(),
            "main file should be restored from backup"
        );

        std::fs::remove_file(&expected_path).unwrap();
        if backup_path.exists() {
            std::fs::remove_file(backup_path).unwrap();
        }
        if pending_path.exists() {
            std::fs::remove_file(pending_path).unwrap();
        }
        clear_test_store_dir();
    }
}
