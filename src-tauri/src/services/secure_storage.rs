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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SecureData {
    pub keys: HashMap<String, String>,
}

pub struct SecureStorage;

impl SecureStorage {
    fn get_store_path() -> Result<PathBuf, String> {
        let app_data =
            std::env::var("APPDATA").map_err(|_| "Could not find APPDATA directory".to_string())?;

        let mut path = PathBuf::from(app_data);
        path.push("AxelateData");
        path.push("User");
        path.push("Configs");

        if !path.exists() {
            fs::create_dir_all(&path)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        path.push("secure.enc");
        Ok(path)
    }

    /// Derives a 32-byte key from the machine UID and a static pepper.
    /// This binds the encryption to the current device.
    fn get_encryption_key() -> Result<[u8; 32], String> {
        let machine_id =
            machine_uid::get().map_err(|e| format!("Failed to get machine ID: {}", e))?;

        // "Pepper" to ensure the key isn't just the raw ID
        let input = format!("AXELATE_SECURE_SALT_{}", machine_id);

        // SHA-256 hash to get exactly 32 bytes
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        let result = hasher.finalize();

        let mut key = [0u8; 32];
        key.copy_from_slice(&result);
        Ok(key)
    }

    pub fn save_key(service: String, value: String) -> Result<(), String> {
        // 1. Load existing data
        let mut data = Self::load_data().unwrap_or(SecureData {
            keys: HashMap::new(),
        });

        // 2. Update map
        data.keys.insert(service, value);

        // 3. Serialize to JSON
        let json_bytes =
            serde_json::to_vec(&data).map_err(|e| format!("Serialization error: {}", e))?;

        // 4. Encrypt
        let key_bytes = Self::get_encryption_key()?;
        let cipher = Aes256Gcm::new(&key_bytes.into());

        // 96-bit nonce (random)
        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, json_bytes.as_ref())
            .map_err(|e| format!("Encryption failure: {}", e))?;

        // 5. Save [Nonce + Ciphertext]
        let mut final_payload = Vec::new();
        final_payload.extend_from_slice(&nonce_bytes);
        final_payload.extend_from_slice(&ciphertext);

        let path = Self::get_store_path()?;
        fs::write(&path, final_payload).map_err(|e| format!("File write error: {}", e))?;

        Ok(())
    }

    pub fn get_key(service: String) -> Result<Option<String>, String> {
        let data = Self::load_data()?;
        Ok(data.keys.get(&service).cloned())
    }

    fn load_data() -> Result<SecureData, String> {
        let path = Self::get_store_path()?;
        if !path.exists() {
            return Ok(SecureData {
                keys: HashMap::new(),
            });
        }

        let file_content = fs::read(&path).map_err(|e| format!("File read error: {}", e))?;

        if file_content.len() < 12 {
            return Err("File corrupted (too short)".to_string());
        }

        // Split Nonce and Ciphertext
        let (nonce_bytes, ciphertext) = file_content.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let key_bytes = Self::get_encryption_key()?;
        let cipher = Aes256Gcm::new(&key_bytes.into());

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| "Decryption failed (wrong machine or corrupted data)".to_string())?;

        let data: SecureData = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("JSON deserialization error: {}", e))?;

        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_secure_storage_lifecycle() {
        // Combined test to avoid race conditions on std::env::set_var("APPDATA")
        let temp_dir = tempdir().unwrap();
        let temp_path = temp_dir.path().to_path_buf();

        // Mock APPDATA locally for this thread (conceptually, though env is global)
        // Since we combined tests, we reduce risk.
        unsafe {
            std::env::set_var("APPDATA", &temp_path);
        }

        // Test Data
        let service = "openai_api_key".to_string();
        let secret = "sk-unique-secret-123".to_string();

        // 1. Save Key
        let result = SecureStorage::save_key(service.clone(), secret.clone());
        assert!(result.is_ok(), "Failed to save key: {:?}", result.err());

        // 2. Verify File Exists
        let mut expected_path = temp_path.clone();
        expected_path.push("AxelateData");
        expected_path.push("User");
        expected_path.push("Configs");
        expected_path.push("secure.enc");
        assert!(expected_path.exists(), "Encrypted file was not created");

        // 3. Verify Encryption Integrity (Read Raw)
        let content = std::fs::read(&expected_path).unwrap();
        let content_str = String::from_utf8(content.clone());
        if let Ok(s) = content_str {
            assert!(!s.contains(&secret), "Plaintext secret found in file!");
        }

        // 4. Get Key (Decrypt)
        let loaded = SecureStorage::get_key(service.clone()).unwrap();
        assert_eq!(
            loaded,
            Some(secret),
            "Decrypted value does not match original"
        );

        // 5. Test Missing Key
        let missing = SecureStorage::get_key("non_existent".to_string()).unwrap();
        assert_eq!(missing, None, "Found key that shouldn't exist");
    }
}
