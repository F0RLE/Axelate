//! Chat session management
//!
//! Provides persistent, concurrent chat session storage using DashMap with
//! atomic disk I/O and a background debounced saver.

use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::Notify;

use super::session_context::{
    build_local_context_messages, extract_message_text, find_history_overlap,
};
use super::types::{ChatMessage, ChatReply, ChatSession};

use super::session_persistence::SessionPersistence;

/// Manages persistence and retrieval of chat sessions.
///
/// Designed for DI via `app.manage(Arc::new(ChatSessionManager::new()))`.
/// No global statics — each instance owns its state.
#[derive(Debug, Clone)]
pub struct ChatSessionManager {
    sessions: Arc<DashMap<String, ChatSession>>,
    dirty: Arc<AtomicBool>,
    persistence_available: Arc<AtomicBool>,
    save_lock: Arc<Mutex<()>>,
    save_notify: Arc<Notify>,
}

impl ChatSessionManager {
    /// Creates a new manager and loads existing sessions from disk.
    /// Call [`start_saver`] after the Tokio runtime is ready.
    pub fn new() -> Self {
        let (sessions, persistence_available) = match Self::load_from_disk() {
            Ok(sessions) => (sessions, true),
            Err(error) => {
                tracing::error!("Failed to load chat history; persistence disabled: {error}");
                (DashMap::new(), false)
            }
        };

        Self {
            sessions: Arc::new(sessions),
            dirty: Arc::new(AtomicBool::new(false)),
            persistence_available: Arc::new(AtomicBool::new(persistence_available)),
            save_lock: Arc::new(Mutex::new(())),
            save_notify: Arc::new(Notify::new()),
        }
    }

    // ── Disk I/O ──────────────────────────────────────────────────────────────

    fn load_from_disk() -> Result<DashMap<String, ChatSession>, crate::errors::AppError> {
        SessionPersistence::load_sessions()
    }

    fn flush_snapshot(
        snapshot: &HashMap<String, ChatSession>,
    ) -> Result<(), crate::errors::AppError> {
        SessionPersistence::flush_snapshot(snapshot)
    }

    fn mark_dirty(&self) {
        if !self.persistence_available.load(Ordering::Relaxed) {
            tracing::warn!("Chat history changed while persistence is disabled; skipping save");
            return;
        }

        self.dirty.store(true, Ordering::Relaxed);
        self.save_notify.notify_one();
    }

    // ── Background saver ──────────────────────────────────────────────────────

    /// Starts the background debounced saver.
    /// Must be called after the Tokio runtime has been initialized (e.g. inside Tauri `setup`).
    pub fn start_saver(&self) {
        let sessions = Arc::clone(&self.sessions);
        let dirty = Arc::clone(&self.dirty);
        let persistence_available = Arc::clone(&self.persistence_available);
        let save_lock = Arc::clone(&self.save_lock);
        let save_notify = Arc::clone(&self.save_notify);

        tauri::async_runtime::spawn(async move {
            tracing::debug!("Background chat session saver started.");
            loop {
                save_notify.notified().await;
                if !persistence_available.load(Ordering::Relaxed) {
                    tracing::warn!("Chat session saver skipped because persistence is disabled");
                    continue;
                }

                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if dirty.swap(false, Ordering::AcqRel) {
                    let save_lock = Arc::clone(&save_lock);
                    let sessions = Arc::clone(&sessions);

                    match tokio::task::spawn_blocking(move || {
                        Self::flush_sessions_locked(&save_lock, &sessions)
                    })
                    .await
                    {
                        Ok(Ok(())) => {
                            tracing::debug!("Chat history saved to disk.");
                        }
                        Ok(Err(error)) => {
                            dirty.store(true, Ordering::Release);
                            save_notify.notify_one();
                            tracing::error!("Failed to save chat history: {}", error);
                        }
                        Err(error) => {
                            dirty.store(true, Ordering::Release);
                            save_notify.notify_one();
                            tracing::error!("Saver task join error: {}", error);
                        }
                    }
                }
            }
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Immediately saves all sessions to disk, bypassing the debounce timer.
    pub async fn force_save(&self) -> Result<(), crate::errors::AppError> {
        self.ensure_persistence_available()?;
        let save_lock = Arc::clone(&self.save_lock);
        let sessions = Arc::clone(&self.sessions);
        self.dirty.store(false, Ordering::Release);

        match tokio::task::spawn_blocking(move || {
            Self::flush_sessions_locked(&save_lock, &sessions)
        })
        .await
        {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                self.dirty.store(true, Ordering::Release);
                Err(error)
            }
            Err(error) => {
                self.dirty.store(true, Ordering::Release);
                Err(crate::errors::AppError::Internal {
                    request_id: None,
                    message: format!("Blocking task failed: {error}"),
                })
            }
        }
    }

    /// Synchronous save — intended for use in Tauri shutdown hooks (called from a blocking context).
    pub fn save_to_disk(&self) -> Result<(), crate::errors::AppError> {
        self.ensure_persistence_available()?;
        Self::flush_sessions_locked(&self.save_lock, &self.sessions)
    }

    fn ensure_persistence_available(&self) -> Result<(), crate::errors::AppError> {
        if self.persistence_available.load(Ordering::Relaxed) {
            return Ok(());
        }

        Err(crate::errors::AppError::Internal {
            request_id: None,
            message: "Chat history persistence is disabled after a load failure".to_string(),
        })
    }

    /// Merges the latest frontend-provided request messages into persistent history
    /// without duplicating already known turns. Returns the incoming messages as the
    /// runtime context that should be sent to the provider.
    pub fn merge_request_messages(
        &self,
        session_id: &str,
        incoming_messages: &[ChatMessage],
    ) -> Vec<ChatMessage> {
        if incoming_messages.is_empty() {
            return self.get_chat_history(session_id);
        }

        let mut entry = self
            .sessions
            .entry(session_id.to_string())
            .or_insert_with(|| ChatSession {
                history: Vec::new(),
                summary: None,
                summary_message_count: 0,
                last_updated: Self::current_timestamp(),
            });

        let overlap = find_history_overlap(&entry.history, incoming_messages);
        let mut appended_messages = false;
        if let Some(new_messages) = incoming_messages.get(overlap..)
            && !new_messages.is_empty()
        {
            entry.history.extend_from_slice(new_messages);
            entry.last_updated = Self::current_timestamp();
            appended_messages = true;
        }
        drop(entry);
        if appended_messages {
            self.mark_dirty();
        }

        incoming_messages.to_vec()
    }

    /// Appends an assistant reply to an existing session.
    pub fn append_response(
        &self,
        session_id: &str,
        message_id: String,
        reply: &ChatReply,
        signature: Option<String>,
    ) {
        self.append_response_with_content(
            session_id,
            message_id,
            serde_json::Value::String(reply.text.clone()),
            &reply.role,
            signature,
        );
    }

    /// Appends an assistant reply with custom multimodal content to an existing session.
    pub fn append_response_with_content(
        &self,
        session_id: &str,
        message_id: String,
        content: serde_json::Value,
        role: &str,
        signature: Option<String>,
    ) {
        if let Some(mut session) = self.sessions.get_mut(session_id) {
            session.history.push(ChatMessage {
                id: message_id,
                role: role.to_string(),
                content,
                thought_signature: signature,
            });
            session.last_updated = Self::current_timestamp();
            drop(session);
            self.mark_dirty();
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
            self.mark_dirty();
        }
    }

    /// Removes the last user turn and any following assistant messages.
    /// Returns the removed user text so the frontend can preload it for editing.
    pub fn rewind_last_turn(&self, session_id: &str) -> Option<String> {
        let mut session = self.sessions.get_mut(session_id)?;
        let user_index = session.history.iter().rposition(|msg| msg.role == "user")?;

        let removed_text = extract_message_text(&session.history.get(user_index)?.content)?;

        session.history.truncate(user_index);
        session.summary = None;
        session.summary_message_count = 0;
        session.last_updated = Self::current_timestamp();
        drop(session);
        self.mark_dirty();

        Some(removed_text)
    }

    /// Builds a compact, provider-facing context for local engines using a persisted
    /// recap of older turns plus a verbatim sliding window of recent turns.
    pub fn build_local_context(
        &self,
        session_id: &str,
        context_size: usize,
        model: &str,
    ) -> Vec<ChatMessage> {
        let Some(mut session) = self.sessions.get_mut(session_id) else {
            return Vec::new();
        };

        if session.history.is_empty() {
            return Vec::new();
        }

        let (context, summary_changed) =
            build_local_context_messages(&mut session, context_size, model);
        if summary_changed {
            drop(session);
            self.mark_dirty();
        }

        context
    }

    /// Returns the current UNIX timestamp in seconds (used for `last_updated` fields).
    pub fn current_timestamp() -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
    }
}

impl ChatSessionManager {
    fn flush_sessions_locked(
        save_lock: &Mutex<()>,
        sessions: &DashMap<String, ChatSession>,
    ) -> Result<(), crate::errors::AppError> {
        let _guard = save_lock
            .lock()
            .map_err(|_| crate::errors::AppError::Internal {
                request_id: None,
                message: "Chat history save lock is poisoned".to_string(),
            })?;
        let snapshot: HashMap<String, ChatSession> = sessions
            .iter()
            .map(|e| (e.key().clone(), e.value().clone()))
            .collect();
        Self::flush_snapshot(&snapshot)
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

    static TEST_CHAT_HISTORY_LOCK: std::sync::LazyLock<std::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

    fn test_manager() -> ChatSessionManager {
        ChatSessionManager {
            sessions: Arc::new(DashMap::new()),
            dirty: Arc::new(AtomicBool::new(false)),
            persistence_available: Arc::new(AtomicBool::new(true)),
            save_lock: Arc::new(Mutex::new(())),
            save_notify: Arc::new(Notify::new()),
        }
    }

    #[test]
    fn test_chat_session_default_timestamp_is_nonzero() {
        let ts = ChatSessionManager::current_timestamp();
        assert!(ts > 0.0, "Timestamp should be a positive UNIX epoch value");
    }

    #[test]
    fn test_merge_request_messages_in_memory() {
        let manager = test_manager();

        let msg = ChatMessage {
            id: "msg-1".to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String("hello".to_string()),
            thought_signature: None,
        };

        let history = manager.merge_request_messages("session-1", std::slice::from_ref(&msg));
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "msg-1");
        assert!(manager.dirty.load(Ordering::Relaxed));
    }

    #[test]
    fn test_clear_chat_history_in_memory() {
        let manager = test_manager();

        let msg = ChatMessage {
            id: "msg-1".to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String("hello".to_string()),
            thought_signature: None,
        };
        manager.merge_request_messages("session-1", &[msg]);
        manager.dirty.store(false, Ordering::Relaxed);

        manager.clear_chat_history("session-1");
        assert!(manager.get_chat_history("session-1").is_empty());
        assert!(manager.dirty.load(Ordering::Relaxed));
    }

    #[test]
    fn test_disabled_persistence_does_not_mark_dirty() {
        let manager = ChatSessionManager {
            sessions: Arc::new(DashMap::new()),
            dirty: Arc::new(AtomicBool::new(false)),
            persistence_available: Arc::new(AtomicBool::new(false)),
            save_lock: Arc::new(Mutex::new(())),
            save_notify: Arc::new(Notify::new()),
        };

        manager.merge_request_messages(
            "session-1",
            &[ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("hello".to_string()),
                thought_signature: None,
            }],
        );

        assert!(!manager.dirty.load(Ordering::Relaxed));
        assert!(manager.save_to_disk().is_err());
    }

    #[test]
    fn test_rewind_last_turn_in_memory() {
        let manager = test_manager();

        manager.merge_request_messages(
            "session-1",
            &[ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("first".to_string()),
                thought_signature: None,
            }],
        );
        manager.append_response(
            "session-1",
            "msg-2".to_string(),
            &ChatReply {
                text: "reply".to_string(),
                role: "assistant".to_string(),
            },
            None,
        );
        manager.merge_request_messages(
            "session-1",
            &[ChatMessage {
                id: "msg-3".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("second".to_string()),
                thought_signature: None,
            }],
        );
        manager.append_response(
            "session-1",
            "msg-4".to_string(),
            &ChatReply {
                text: "second reply".to_string(),
                role: "assistant".to_string(),
            },
            None,
        );
        manager.dirty.store(false, Ordering::Relaxed);

        let removed = manager.rewind_last_turn("session-1");
        let history = manager.get_chat_history("session-1");

        assert_eq!(removed.as_deref(), Some("second"));
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, "user");
        assert_eq!(history[1].role, "assistant");
        assert!(manager.dirty.load(Ordering::Relaxed));
    }

    #[test]
    fn test_rewind_last_turn_extracts_text_from_multimodal_content() {
        let manager = test_manager();

        manager.merge_request_messages(
            "session-1",
            &[ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: serde_json::json!([
                    { "type": "text", "text": "look here" },
                    {
                        "type": "image_url",
                        "image_url": { "url": "data:image/png;base64,ZmFrZQ==" }
                    }
                ]),
                thought_signature: None,
            }],
        );

        let removed = manager.rewind_last_turn("session-1");

        assert_eq!(removed.as_deref(), Some("look here"));
    }

    #[test]
    fn test_merge_request_messages_deduplicates_overlap() {
        let manager = test_manager();

        let existing = vec![
            ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("hello".to_string()),
                thought_signature: None,
            },
            ChatMessage {
                id: "msg-2".to_string(),
                role: "assistant".to_string(),
                content: serde_json::Value::String("hi".to_string()),
                thought_signature: None,
            },
        ];

        let incoming = vec![
            ChatMessage {
                id: "new-msg-1".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("hello".to_string()),
                thought_signature: None,
            },
            ChatMessage {
                id: "new-msg-2".to_string(),
                role: "assistant".to_string(),
                content: serde_json::Value::String("hi".to_string()),
                thought_signature: None,
            },
            ChatMessage {
                id: "new-msg-3".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("next".to_string()),
                thought_signature: None,
            },
        ];

        manager.merge_request_messages("session-1", &existing);
        let runtime_context = manager.merge_request_messages("session-1", &incoming);
        let persisted = manager.get_chat_history("session-1");

        assert_eq!(runtime_context.len(), 3);
        assert_eq!(persisted.len(), 3);
        assert_eq!(
            persisted[2].content,
            serde_json::Value::String("next".to_string())
        );
    }

    #[test]
    fn test_merge_request_messages_does_not_mark_dirty_for_full_overlap() {
        let manager = test_manager();

        let existing = vec![
            ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("hello".to_string()),
                thought_signature: None,
            },
            ChatMessage {
                id: "msg-2".to_string(),
                role: "assistant".to_string(),
                content: serde_json::Value::String("hi".to_string()),
                thought_signature: None,
            },
        ];

        manager.merge_request_messages("session-1", &existing);
        manager.dirty.store(false, Ordering::Relaxed);

        let runtime_context = manager.merge_request_messages("session-1", &existing);
        let persisted = manager.get_chat_history("session-1");

        assert_eq!(runtime_context.len(), 2);
        assert_eq!(persisted.len(), 2);
        assert!(
            !manager.dirty.load(Ordering::Relaxed),
            "fully overlapped request should not schedule a redundant save"
        );
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
            summary: Some("- U: Hello".to_string()),
            summary_message_count: 1,
            last_updated: 1_700_000_000.0,
        };

        let json = serde_json::to_string(&session).expect("Failed to serialize ChatSession");
        assert!(json.contains("test-id"));
        assert!(json.contains("Hello"));
        assert!(json.contains("summary_message_count"));
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
        assert_eq!(session.summary, None);
        assert_eq!(session.summary_message_count, 0);
        let msg = &session.history[0];
        assert_eq!(msg.id, "abc-123");
        assert_eq!(msg.role, "assistant");
        assert!((session.last_updated - 1_234_567_890.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_corrupt_history_is_backed_up_before_starting_empty() {
        let _guard = TEST_CHAT_HISTORY_LOCK
            .lock()
            .expect("chat history test lock");
        let history_path = SessionPersistence::history_path();
        let chat_dir = history_path
            .parent()
            .expect("history path should have a parent");
        let _ = std::fs::remove_dir_all(chat_dir);
        std::fs::create_dir_all(chat_dir).expect("chat dir should be created");
        std::fs::write(history_path, "{not valid json").expect("history fixture should be written");

        let sessions = SessionPersistence::load_sessions().expect("corrupt history should recover");

        assert!(sessions.is_empty());
        assert!(!history_path.exists());
        let backups = std::fs::read_dir(chat_dir)
            .expect("chat dir should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("history.corrupt-")
            })
            .count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn test_force_save_survives_manager_restart() {
        let _guard = TEST_CHAT_HISTORY_LOCK
            .lock()
            .expect("chat history test lock");
        let history_path = SessionPersistence::history_path();
        let chat_dir = history_path
            .parent()
            .expect("history path should have a parent");
        let _ = std::fs::remove_dir_all(chat_dir);
        std::fs::create_dir_all(chat_dir).expect("chat dir should be created");

        let manager = test_manager();
        manager.merge_request_messages(
            "session-restart",
            &[ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: serde_json::Value::String("persist me".to_string()),
                thought_signature: None,
            }],
        );
        tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(manager.force_save())
            .expect("force save should persist history");

        let restarted = ChatSessionManager {
            sessions: Arc::new(
                SessionPersistence::load_sessions().expect("saved history should reload"),
            ),
            dirty: Arc::new(AtomicBool::new(false)),
            persistence_available: Arc::new(AtomicBool::new(true)),
            save_lock: Arc::new(Mutex::new(())),
            save_notify: Arc::new(Notify::new()),
        };
        let history = restarted.get_chat_history("session-restart");

        assert_eq!(history.len(), 1);
        assert_eq!(
            history[0].content,
            serde_json::Value::String("persist me".to_string())
        );
    }

    #[test]
    fn test_interrupted_newer_tmp_history_is_recovered_on_restart() {
        let _guard = TEST_CHAT_HISTORY_LOCK
            .lock()
            .expect("chat history test lock");
        let history_path = SessionPersistence::history_path();
        let tmp_path = SessionPersistence::temp_history_path();
        let chat_dir = history_path
            .parent()
            .expect("history path should have a parent");
        let _ = std::fs::remove_dir_all(chat_dir);
        std::fs::create_dir_all(chat_dir).expect("chat dir should be created");

        std::fs::write(
            history_path,
            serde_json::json!({
                "session-restart": {
                    "history": [{
                        "id": "old",
                        "role": "user",
                        "content": "old",
                        "thought_signature": null
                    }],
                    "summary": null,
                    "summary_message_count": 0,
                    "last_updated": 1.0
                }
            })
            .to_string(),
        )
        .expect("old history should be written");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(
            &tmp_path,
            serde_json::json!({
                "session-restart": {
                    "history": [{
                        "id": "new",
                        "role": "user",
                        "content": "new",
                        "thought_signature": null
                    }],
                    "summary": null,
                    "summary_message_count": 0,
                    "last_updated": 2.0
                }
            })
            .to_string(),
        )
        .expect("tmp history should be written");

        let sessions = SessionPersistence::load_sessions().expect("tmp history should recover");
        let restored = sessions
            .get("session-restart")
            .expect("session should be restored");

        assert_eq!(restored.history[0].id, "new");
        assert!(!tmp_path.exists());
    }

    #[test]
    fn test_build_local_context_uses_persisted_summary_and_recent_turns() {
        let manager = test_manager();

        let session = ChatSession {
            history: vec![
                ChatMessage {
                    id: "1".to_string(),
                    role: "user".to_string(),
                    content: serde_json::Value::String("minus one".to_string()),
                    thought_signature: None,
                },
                ChatMessage {
                    id: "2".to_string(),
                    role: "assistant".to_string(),
                    content: serde_json::Value::String("reply minus one".to_string()),
                    thought_signature: None,
                },
                ChatMessage {
                    id: "3".to_string(),
                    role: "user".to_string(),
                    content: serde_json::Value::String("zero".to_string()),
                    thought_signature: None,
                },
                ChatMessage {
                    id: "4".to_string(),
                    role: "assistant".to_string(),
                    content: serde_json::Value::String("reply zero".to_string()),
                    thought_signature: None,
                },
                ChatMessage {
                    id: "5".to_string(),
                    role: "user".to_string(),
                    content: serde_json::Value::String("one".to_string()),
                    thought_signature: None,
                },
                ChatMessage {
                    id: "6".to_string(),
                    role: "assistant".to_string(),
                    content: serde_json::Value::String("reply one".to_string()),
                    thought_signature: None,
                },
                ChatMessage {
                    id: "7".to_string(),
                    role: "user".to_string(),
                    content: serde_json::Value::String("two".to_string()),
                    thought_signature: None,
                },
                ChatMessage {
                    id: "8".to_string(),
                    role: "assistant".to_string(),
                    content: serde_json::Value::String("reply two".to_string()),
                    thought_signature: None,
                },
            ],
            summary: None,
            summary_message_count: 0,
            last_updated: 0.0,
        };
        manager.sessions.insert("session-1".to_string(), session);

        let context = manager.build_local_context("session-1", 4096, "gpt-4");

        assert_eq!(context.len(), 7);
        assert_eq!(context[0].role, "system");
        assert!(
            context[0]
                .content
                .as_str()
                .unwrap_or_default()
                .contains("Internal conversation summary for continuity.")
        );

        let stored = manager
            .sessions
            .get("session-1")
            .expect("session should exist");
        assert!(stored.summary.is_some());
        assert_eq!(stored.summary_message_count, 2);
        assert_eq!(
            context[1].content,
            serde_json::Value::String("zero".to_string())
        );
    }

    #[test]
    fn test_rewind_last_turn_resets_persisted_summary_state() {
        let manager = test_manager();

        manager.sessions.insert(
            "session-1".to_string(),
            ChatSession {
                history: vec![
                    ChatMessage {
                        id: "1".to_string(),
                        role: "user".to_string(),
                        content: serde_json::Value::String("first".to_string()),
                        thought_signature: None,
                    },
                    ChatMessage {
                        id: "2".to_string(),
                        role: "assistant".to_string(),
                        content: serde_json::Value::String("reply".to_string()),
                        thought_signature: None,
                    },
                    ChatMessage {
                        id: "3".to_string(),
                        role: "user".to_string(),
                        content: serde_json::Value::String("second".to_string()),
                        thought_signature: None,
                    },
                ],
                summary: Some("- U: first".to_string()),
                summary_message_count: 2,
                last_updated: 0.0,
            },
        );

        let removed = manager.rewind_last_turn("session-1");
        let stored = manager
            .sessions
            .get("session-1")
            .expect("session should exist");

        assert_eq!(removed.as_deref(), Some("second"));
        assert_eq!(stored.summary, None);
        assert_eq!(stored.summary_message_count, 0);
    }
}
