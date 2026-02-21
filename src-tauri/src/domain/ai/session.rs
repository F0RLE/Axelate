//! Chat session management
//!
//! Provides persistent, concurrent chat session storage using DashMap with
//! atomic disk I/O and a background debounced saver.

use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use super::types::{ChatMessage, ChatReply, ChatSession};

/// Manages persistence and retrieval of chat sessions.
///
/// Designed for DI via `app.manage(Arc::new(ChatSessionManager::new()))`.
/// No global statics — each instance owns its state.
#[derive(Debug, Clone)]
pub struct ChatSessionManager {
    sessions: Arc<DashMap<String, ChatSession>>,
    dirty: Arc<AtomicBool>,
}

impl ChatSessionManager {
    /// Creates a new manager and loads existing sessions from disk.
    /// Call [`start_saver`] after the Tokio runtime is ready.
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Self::load_from_disk().unwrap_or_default()),
            dirty: Arc::new(AtomicBool::new(false)),
        }
    }

    // ── Disk I/O ──────────────────────────────────────────────────────────────

    fn load_from_disk() -> Result<DashMap<String, ChatSession>, crate::errors::AppError> {
        let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
        let tmp_path = path.with_extension("tmp");

        // Crash recovery: if .tmp exists but the real file doesn't, we crashed mid-rename
        if tmp_path.exists() && !path.exists() {
            tracing::warn!("Detected crash during last save. Recovering from .tmp...");
            if let Err(e) = std::fs::rename(&tmp_path, path) {
                tracing::error!("Crash recovery failed: {e}");
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

        let map = DashMap::new();
        for (k, mut session) in temp_map {
            // Migration: ensure every message has a UUID
            for msg in &mut session.history {
                if msg.id.is_empty() || msg.id == "00000000-0000-0000-0000-000000000000" {
                    msg.id = uuid::Uuid::new_v4().to_string();
                }
            }
            map.insert(k, session);
        }
        Ok(map)
    }

    fn flush_snapshot(
        snapshot: HashMap<String, ChatSession>,
    ) -> Result<(), crate::errors::AppError> {
        let path = &*crate::utils::paths::FILE_CHAT_HISTORY;
        let tmp_path = path.with_extension("tmp");

        let content = serde_json::to_string_pretty(&snapshot).map_err(|e| {
            crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Failed to serialize chat history: {e}"),
            }
        })?;

        let mut file = std::fs::File::create(&tmp_path)?;
        use std::io::Write;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);

        if let Err(e) = std::fs::rename(&tmp_path, path) {
            tracing::warn!("Rename failed ({e}), using fallback for Windows locks...");
            let _ = std::fs::remove_file(path);
            std::fs::rename(&tmp_path, path)?;
        }

        Ok(())
    }

    fn take_snapshot(&self) -> HashMap<String, ChatSession> {
        self.sessions
            .iter()
            .map(|e| (e.key().clone(), e.value().clone()))
            .collect()
    }

    // ── Background saver ──────────────────────────────────────────────────────

    /// Starts the background debounced saver.
    /// Must be called after the Tokio runtime has been initialized (e.g. inside Tauri `setup`).
    pub fn start_saver(&self) {
        let sessions = Arc::clone(&self.sessions);
        let dirty = Arc::clone(&self.dirty);

        tauri::async_runtime::spawn(async move {
            tracing::info!("Background chat session saver started.");
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if dirty.load(Ordering::Relaxed) {
                    let snapshot: HashMap<String, ChatSession> = sessions
                        .iter()
                        .map(|e| (e.key().clone(), e.value().clone()))
                        .collect();

                    match tokio::task::spawn_blocking(|| Self::flush_snapshot(snapshot)).await {
                        Ok(Ok(())) => {
                            dirty.store(false, Ordering::Relaxed);
                            tracing::debug!("Chat history saved to disk.");
                        }
                        Ok(Err(e)) => tracing::error!("Failed to save chat history: {e}"),
                        Err(e) => tracing::error!("Saver task join error: {e}"),
                    }
                }
            }
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Immediately saves all sessions to disk, bypassing the debounce timer.
    pub async fn force_save(&self) -> Result<(), crate::errors::AppError> {
        let snapshot = self.take_snapshot();
        tokio::task::spawn_blocking(|| Self::flush_snapshot(snapshot))
            .await
            .map_err(|e| crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Blocking task failed: {e}"),
            })??;
        self.dirty.store(false, Ordering::Relaxed);
        Ok(())
    }

    /// Synchronous save — intended for use in Tauri shutdown hooks (called from a blocking context).
    pub fn save_to_disk(&self) -> Result<(), crate::errors::AppError> {
        Self::flush_snapshot(self.take_snapshot())
    }

    /// Returns the full history for a session, creating it if necessary.
    pub fn get_or_create_session(
        &self,
        session_id: &str,
        new_messages: &[ChatMessage],
    ) -> Vec<ChatMessage> {
        let mut entry = self
            .sessions
            .entry(session_id.to_string())
            .or_insert_with(|| ChatSession {
                history: Vec::new(),
                last_updated: Self::current_timestamp(),
            });

        entry.history.extend_from_slice(new_messages);
        entry.last_updated = Self::current_timestamp();
        self.dirty.store(true, Ordering::Relaxed);
        entry.history.clone()
    }

    /// Appends an assistant reply to an existing session.
    pub fn append_response(
        &self,
        session_id: &str,
        message_id: String,
        reply: &ChatReply,
        signature: Option<String>,
    ) {
        if let Some(mut session) = self.sessions.get_mut(session_id) {
            session.history.push(ChatMessage {
                id: message_id,
                role: reply.role.clone(),
                content: serde_json::Value::String(reply.text.clone()),
                thought_signature: signature,
            });
            session.last_updated = Self::current_timestamp();
            self.dirty.store(true, Ordering::Relaxed);
        }
    }

    /// Returns the history for a session, or an empty Vec if it doesn't exist.
    pub fn get_chat_history(&self, session_id: &str) -> Vec<ChatMessage> {
        self.sessions
            .get(session_id)
            .map(|s| s.history.clone())
            .unwrap_or_default()
    }

    /// Removes a session and marks dirty.
    pub fn clear_chat_history(&self, session_id: &str) {
        if self.sessions.remove(session_id).is_some() {
            self.dirty.store(true, Ordering::Relaxed);
        }
    }

    /// Returns the current UNIX timestamp in seconds (used for `last_updated` fields).
    pub fn current_timestamp() -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
    }
}

impl Default for ChatSessionManager {
    fn default() -> Self {
        Self::new()
    }
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
    fn test_get_or_create_session_in_memory() {
        let manager = ChatSessionManager {
            sessions: Arc::new(DashMap::new()),
            dirty: Arc::new(AtomicBool::new(false)),
        };

        let msg = ChatMessage {
            id: "msg-1".to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String("hello".to_string()),
            thought_signature: None,
        };

        let history = manager.get_or_create_session("session-1", &[msg.clone()]);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "msg-1");
        assert!(manager.dirty.load(Ordering::Relaxed));
    }

    #[test]
    fn test_clear_chat_history_in_memory() {
        let manager = ChatSessionManager {
            sessions: Arc::new(DashMap::new()),
            dirty: Arc::new(AtomicBool::new(false)),
        };

        let msg = ChatMessage {
            id: "msg-1".to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String("hello".to_string()),
            thought_signature: None,
        };
        manager.get_or_create_session("session-1", &[msg]);
        manager.dirty.store(false, Ordering::Relaxed);

        manager.clear_chat_history("session-1");
        assert!(manager.get_chat_history("session-1").is_empty());
        assert!(manager.dirty.load(Ordering::Relaxed));
    }

    #[test]
    fn test_chat_session_serialization() {
        use super::super::types::ChatSession;

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
        use super::super::types::ChatSession;

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
