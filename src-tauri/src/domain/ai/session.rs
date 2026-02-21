//! Chat session management
//!
//! Provides persistent, concurrent chat session storage using DashMap with
//! atomic disk I/O and a background debounced saver.

use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::{
    LazyLock, Once,
    atomic::{AtomicBool, Ordering},
};

use super::types::{ChatMessage, ChatReply, ChatSession};

/// Global storage for active sessions (DashMap for concurrency)
static SESSIONS: LazyLock<DashMap<String, ChatSession>> =
    LazyLock::new(|| ChatSessionManager::load_from_disk().unwrap_or_default());

/// Dirty flag for IO debounce
static DIRTY: AtomicBool = AtomicBool::new(false);
/// Ensure background saver is only spawned once
static SAVER_INIT: Once = Once::new();

/// Manages persistence and retrieval of chat sessions
#[derive(Debug)]
pub struct ChatSessionManager;

impl ChatSessionManager {
    /// Loads session history from disk
    fn load_from_disk() -> Result<DashMap<String, ChatSession>, crate::errors::AppError> {
        let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
        let tmp_path = path.with_extension("tmp");

        // Atomic Crash Recovery:
        // If tmp exists but real is missing, we crashed between remove and rename
        if tmp_path.exists() && !path.exists() {
            log::warn!(
                "Detected crash/interruption during last save. Recovering history from .tmp..."
            );
            if let Err(e) = std::fs::rename(&tmp_path, path) {
                log::error!("Crash recovery failed: {e}");
            }
        }

        if !path.exists() {
            return Ok(DashMap::new());
        }

        let content = std::fs::read_to_string(path)?;
        let temp_map: HashMap<String, ChatSession> =
            serde_json::from_str(&content).map_err(|e| crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Failed to parse chat history: {e}"),
            })?;

        let dash_map = DashMap::new();
        for (k, mut session) in temp_map {
            // Migration: Ensure every historical message has a UUID
            for msg in &mut session.history {
                if msg.id.is_empty() || msg.id == "00000000-0000-0000-0000-000000000000" {
                    msg.id = uuid::Uuid::new_v4().to_string();
                }
            }
            dash_map.insert(k, session);
        }

        Ok(dash_map)
    }

    /// Saves current sessions to disk (Atomic Write)
    pub fn save_to_disk() -> Result<(), crate::errors::AppError> {
        let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
        let tmp_path = path.with_extension("tmp");

        let snapshot: HashMap<String, ChatSession> = SESSIONS
            .iter()
            .map(|entry| (entry.key().clone(), entry.value().clone()))
            .collect();

        let content = serde_json::to_string_pretty(&snapshot).map_err(|e| {
            crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Failed to serialize chat history: {e}"),
            }
        })?;

        // 1. Write to temporary file
        let mut file = std::fs::File::create(&tmp_path)?;
        use std::io::Write;
        file.write_all(content.as_bytes())?;

        // 1.1 Persist buffers to physical disk
        file.sync_all()?;
        // Close file handle before rename
        drop(file);

        // 2. Atomic Rename (Windows-safe: remove then rename if rename errors)
        if let Err(e) = std::fs::rename(&tmp_path, path) {
            log::warn!("Standard rename failed ({e}), attempting fallback for Windows locks...");
            let _ = std::fs::remove_file(path);
            std::fs::rename(&tmp_path, path)?;
        }

        Ok(())
    }

    /// Ensures the background saver task is running
    pub(super) fn ensure_saver_running() {
        SAVER_INIT.call_once(|| {
            tokio::spawn(async move {
                log::info!("Starting background chat session saver...");
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    if DIRTY.load(Ordering::Relaxed) {
                        // Use spawn_blocking for IO to avoid blocking worker threads
                        let save_res = tokio::task::spawn_blocking(Self::save_to_disk).await;

                        match save_res {
                            Ok(Ok(())) => {
                                DIRTY.store(false, Ordering::Relaxed);
                                log::debug!("Chat history saved to disk (debounced)");
                            }
                            Ok(Err(e)) => {
                                log::error!("Failed to save chat history: {e}");
                            }
                            Err(e) => {
                                log::error!("Saver task join error: {e}");
                            }
                        }
                    }
                }
            });
        });
    }

    /// Manually triggers a save to disk, bypassing the debounce timer
    pub async fn force_save() -> Result<(), crate::errors::AppError> {
        tokio::task::spawn_blocking(Self::save_to_disk)
            .await
            .map_err(|e| crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Blocking task failed: {e}"),
            })??;

        DIRTY.store(false, Ordering::Relaxed);
        Ok(())
    }

    /// Retrieves or creates a session, updating it with new user messages
    pub(super) fn get_or_create_session(
        session_id: &str,
        new_messages: &[ChatMessage],
    ) -> Vec<ChatMessage> {
        // Ensure saver is running on first write-access
        Self::ensure_saver_running();

        let mut entry = SESSIONS
            .entry(session_id.to_string())
            .or_insert_with(|| ChatSession {
                history: Vec::new(),
                last_updated: Self::current_timestamp(),
            });

        entry.history.extend(new_messages.iter().cloned());
        entry.last_updated = Self::current_timestamp();

        // Mark dirty
        DIRTY.store(true, Ordering::Relaxed);

        entry.history.clone()
    }

    /// Appends an assistant response to the session
    pub(super) fn append_response(
        session_id: &str,
        message_id: String,
        reply: &ChatReply,
        signature: Option<String>,
    ) {
        Self::ensure_saver_running();

        if let Some(mut session) = SESSIONS.get_mut(session_id) {
            session.history.push(ChatMessage {
                id: message_id,
                role: reply.role.clone(),
                content: serde_json::Value::String(reply.text.clone()),
                thought_signature: signature,
            });
            session.last_updated = Self::current_timestamp();

            // Mark dirty
            DIRTY.store(true, Ordering::Relaxed);
        }
    }

    fn current_timestamp() -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
    }
}

/// Retrieves chat history for a session
pub fn get_chat_history(session_id: &str) -> Vec<ChatMessage> {
    if let Some(session) = SESSIONS.get(session_id) {
        return session.history.clone();
    }
    Vec::new()
}

/// Clears history for a session
pub fn clear_chat_history(session_id: &str) {
    if SESSIONS.remove(session_id).is_some() {
        ChatSessionManager::ensure_saver_running();
        DIRTY.store(true, Ordering::Relaxed);
    }
}

/// Force immediate save of all chat history to disk (for shutdown or completion)
pub async fn force_save_history() -> Result<(), crate::errors::AppError> {
    ChatSessionManager::force_save().await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used, clippy::indexing_slicing)]
    use super::*;

    #[test]
    fn test_chat_session_default_timestamp_is_nonzero() {
        let ts = ChatSessionManager::current_timestamp();
        assert!(ts > 0.0, "Timestamp should be a positive UNIX epoch value");
    }

    #[test]
    fn test_chat_session_serialization() {
        let session = ChatSession {
            history: vec![ChatMessage {
                id: "test-id".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("Hello".to_string()),
                thought_signature: None,
            }],
            last_updated: 1_700_000_000.0,
        };

        let json = serde_json::to_string(&session).expect("Failed to serialize ChatSession");
        assert!(json.contains("test-id"));
        assert!(json.contains("Hello"));
        assert!(json.contains("1700000000"));
    }

    #[test]
    fn test_chat_session_deserialization() {
        let json = r#"{
            "history": [{
                "id": "abc-123",
                "role": "assistant",
                "content": "Hi there",
                "thought_signature": null
            }],
            "last_updated": 1234567890.0
        }"#;

        let session: ChatSession =
            serde_json::from_str(json).expect("Failed to deserialize ChatSession");
        assert_eq!(session.history.len(), 1);
        let msg = &session.history[0];
        assert_eq!(msg.id, "abc-123");
        assert_eq!(msg.role, "assistant");
        assert!((session.last_updated - 1_234_567_890.0).abs() < f64::EPSILON);
    }
}
