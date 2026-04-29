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
    build_summary_lines, estimate_message_tokens, estimate_messages_tokens, extract_message_text,
    find_history_overlap, group_turn_ranges, merge_summary,
};
use super::types::{ChatMessage, ChatReply, ChatSession};

const LOCAL_CONTEXT_RESERVE_TOKENS: usize = 1024;
const LOCAL_RECENT_TURNS: usize = 3;
const LOCAL_SUMMARY_BUDGET_NUMERATOR: usize = 28;
const LOCAL_SUMMARY_BUDGET_DENOMINATOR: usize = 100;
const LOCAL_MIN_SUMMARY_TOKENS: usize = 160;

struct SessionPersistence;

struct LocalContextBudget {
    available_tokens: usize,
    summary_tokens: usize,
}

struct LocalContextState {
    turn_ranges: Vec<(usize, usize)>,
    recent_start_index: usize,
    persisted_summary_count: usize,
}

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
                        Ok(Err(e)) => {
                            dirty.store(true, Ordering::Release);
                            save_notify.notify_one();
                            tracing::error!("Failed to save chat history: {e}");
                        }
                        Err(e) => {
                            dirty.store(true, Ordering::Release);
                            save_notify.notify_one();
                            tracing::error!("Saver task join error: {e}");
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
        tokio::task::spawn_blocking(move || Self::flush_sessions_locked(&save_lock, &sessions))
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
        if let Some(new_messages) = incoming_messages.get(overlap..) {
            entry.history.extend_from_slice(new_messages);
        }
        entry.last_updated = Self::current_timestamp();
        drop(entry);
        self.mark_dirty();

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

        let budget = LocalContextBudget::new(context_size);
        let state = LocalContextState::from_session(&session);
        let summary_changed = state.refresh_summary(&mut session, budget.summary_tokens, model);
        let context = state.build_context(&session, budget.available_tokens, model);
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

impl SessionPersistence {
    fn history_path() -> &'static std::path::Path {
        &crate::utils::paths::FILE_CHAT_HISTORY
    }

    fn temp_history_path() -> std::path::PathBuf {
        Self::history_path().with_extension("tmp")
    }

    fn load_sessions() -> Result<DashMap<String, ChatSession>, crate::errors::AppError> {
        Self::recover_from_interrupted_write()?;

        if !Self::history_path().exists() {
            return Ok(DashMap::new());
        }

        let content = std::fs::read_to_string(Self::history_path())?;
        let persisted = match Self::parse_sessions(&content) {
            Ok(persisted) => persisted,
            Err(error) => {
                let backup_path = Self::backup_corrupt_history()?;
                tracing::error!(
                    backup = %backup_path.display(),
                    "Failed to parse chat history. Moved corrupt file aside: {error}"
                );
                return Ok(DashMap::new());
            }
        };
        Ok(Self::normalize_sessions(persisted))
    }

    fn backup_corrupt_history() -> Result<std::path::PathBuf, crate::errors::AppError> {
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let backup_path =
            Self::history_path().with_extension(format!("corrupt-{timestamp_ms}.json"));
        std::fs::rename(Self::history_path(), &backup_path)?;
        Ok(backup_path)
    }

    fn recover_from_interrupted_write() -> Result<(), crate::errors::AppError> {
        let tmp_path = Self::temp_history_path();
        if !tmp_path.exists() {
            return Ok(());
        }

        if !Self::is_valid_history_file(&tmp_path) {
            tracing::warn!(
                tmp = %tmp_path.display(),
                "Discarding invalid interrupted chat history write"
            );
            Self::remove_recovered_tmp(&tmp_path)?;
            return Ok(());
        }

        if !Self::history_path().exists() || Self::tmp_history_is_newer(&tmp_path) {
            tracing::warn!("Detected interrupted chat history save. Recovering from .tmp...");
            std::fs::copy(&tmp_path, Self::history_path())?;
        }

        Self::remove_recovered_tmp(&tmp_path)?;
        Ok(())
    }

    fn remove_recovered_tmp(tmp_path: &std::path::Path) -> Result<(), crate::errors::AppError> {
        match std::fs::remove_file(tmp_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(crate::errors::AppError::Io(format!(
                "Failed to remove recovered chat history tmp file {}: {error}",
                tmp_path.display()
            ))),
        }
    }

    fn is_valid_history_file(path: &std::path::Path) -> bool {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|content| Self::parse_sessions(&content).ok())
            .is_some()
    }

    fn tmp_history_is_newer(tmp_path: &std::path::Path) -> bool {
        let tmp_modified = tmp_path.metadata().and_then(|metadata| metadata.modified());
        let history_modified = Self::history_path()
            .metadata()
            .and_then(|metadata| metadata.modified());

        matches!((tmp_modified, history_modified), (Ok(tmp), Ok(history)) if tmp > history)
    }

    fn parse_sessions(
        content: &str,
    ) -> Result<HashMap<String, ChatSession>, crate::errors::AppError> {
        serde_json::from_str(content).map_err(|error| crate::errors::AppError::Internal {
            request_id: None,
            message: format!("Failed to parse chat history: {error}"),
        })
    }

    fn normalize_sessions(persisted: HashMap<String, ChatSession>) -> DashMap<String, ChatSession> {
        let sessions = DashMap::new();
        for (session_id, mut session) in persisted {
            Self::ensure_message_ids(&mut session);
            sessions.insert(session_id, session);
        }
        sessions
    }

    fn ensure_message_ids(session: &mut ChatSession) {
        for message in &mut session.history {
            if message.id.is_empty() || message.id == "00000000-0000-0000-0000-000000000000" {
                message.id = uuid::Uuid::new_v4().to_string();
            }
        }
    }

    fn flush_snapshot(
        snapshot: &HashMap<String, ChatSession>,
    ) -> Result<(), crate::errors::AppError> {
        let serialized = serde_json::to_string_pretty(snapshot).map_err(|error| {
            crate::errors::AppError::Internal {
                request_id: None,
                message: format!("Failed to serialize chat history: {error}"),
            }
        })?;

        Self::write_atomic(&serialized)
    }

    fn write_atomic(content: &str) -> Result<(), crate::errors::AppError> {
        let tmp_path = Self::temp_history_path();
        let path = Self::history_path();

        let mut file = std::fs::File::create(&tmp_path)?;
        use std::io::Write;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);

        if let Err(error) = std::fs::rename(&tmp_path, path) {
            tracing::warn!("Rename failed ({error}), using fallback for Windows locks...");
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => {}
                Err(remove_error) => {
                    return Err(crate::errors::AppError::Io(format!(
                        "Failed to replace chat history '{}': rename failed: {error}; removing existing file failed: {remove_error}",
                        path.display()
                    )));
                }
            }
            std::fs::rename(&tmp_path, path).map_err(|second_error| {
                crate::errors::AppError::Io(format!(
                    "Failed to publish chat history '{}': first rename failed: {error}; second rename failed: {second_error}",
                    path.display()
                ))
            })?;
        }

        Ok(())
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

impl LocalContextBudget {
    fn new(context_size: usize) -> Self {
        let normalized_context_size = context_size.max(4096);
        let available_tokens = normalized_context_size
            .saturating_sub(LOCAL_CONTEXT_RESERVE_TOKENS)
            .max(512);
        let summary_tokens = available_tokens.saturating_mul(LOCAL_SUMMARY_BUDGET_NUMERATOR)
            / LOCAL_SUMMARY_BUDGET_DENOMINATOR;

        Self {
            available_tokens,
            summary_tokens: summary_tokens.max(LOCAL_MIN_SUMMARY_TOKENS),
        }
    }
}

impl LocalContextState {
    fn from_session(session: &ChatSession) -> Self {
        let turn_ranges = group_turn_ranges(&session.history);
        let recent_start_index = turn_ranges
            .len()
            .checked_sub(LOCAL_RECENT_TURNS)
            .and_then(|index| turn_ranges.get(index))
            .map_or(0, |(start, _)| *start);
        let persisted_summary_count =
            usize::try_from(session.summary_message_count).unwrap_or(usize::MAX);

        Self {
            turn_ranges,
            recent_start_index,
            persisted_summary_count,
        }
    }

    fn refresh_summary(
        &self,
        session: &mut ChatSession,
        summary_budget: usize,
        model: &str,
    ) -> bool {
        if self.recent_start_index < self.persisted_summary_count {
            session.summary = None;
            session.summary_message_count = 0;
            return true;
        }

        if self.recent_start_index <= self.persisted_summary_count {
            return false;
        }

        let Some(new_summary_slice) = session
            .history
            .get(self.persisted_summary_count..self.recent_start_index)
        else {
            return false;
        };

        let summary_lines = build_summary_lines(new_summary_slice);
        if summary_lines.is_empty() {
            return false;
        }

        session.summary = merge_summary(
            session.summary.as_deref(),
            &summary_lines,
            summary_budget,
            model,
        );
        session.summary_message_count = u32::try_from(self.recent_start_index).unwrap_or(u32::MAX);
        true
    }

    fn build_context(
        &self,
        session: &ChatSession,
        available_budget: usize,
        model: &str,
    ) -> Vec<ChatMessage> {
        let (mut context, used_tokens) =
            Self::build_summary_message(session.summary.clone(), available_budget, model);
        context.extend(self.collect_recent_turns(session, available_budget, used_tokens, model));
        context
    }

    fn build_summary_message(
        summary: Option<String>,
        available_budget: usize,
        model: &str,
    ) -> (Vec<ChatMessage>, usize) {
        let Some(summary_content) = summary else {
            return (Vec::new(), 0);
        };

        let hidden_summary = format!(
            "Internal conversation summary for continuity. Use it only as hidden context. Do not quote, reveal, translate, or mention it unless the user explicitly asks. Reply directly to the latest user message in the user's language.\n\nSummary:\n{summary_content}"
        );

        let summary_message = ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "system".to_string(),
            content: serde_json::Value::String(hidden_summary),
            thought_signature: None,
        };
        let summary_tokens = estimate_message_tokens(&summary_message, model);
        if summary_tokens > available_budget {
            return (Vec::new(), 0);
        }

        (vec![summary_message], summary_tokens)
    }

    fn collect_recent_turns(
        &self,
        session: &ChatSession,
        available_budget: usize,
        initial_tokens: usize,
        model: &str,
    ) -> Vec<ChatMessage> {
        let recent_turn_ranges = self
            .turn_ranges
            .len()
            .checked_sub(LOCAL_RECENT_TURNS)
            .and_then(|start| self.turn_ranges.get(start..))
            .unwrap_or(&self.turn_ranges);

        let mut used_tokens = initial_tokens;
        let mut kept_recent: Vec<ChatMessage> = Vec::new();

        for (start, end) in recent_turn_ranges.iter().rev() {
            let Some(turn) = session.history.get(*start..*end) else {
                continue;
            };
            let turn_tokens = estimate_messages_tokens(turn, model);
            if used_tokens + turn_tokens > available_budget {
                continue;
            }

            let mut turn_messages = turn.to_vec();
            turn_messages.append(&mut kept_recent);
            kept_recent = turn_messages;
            used_tokens += turn_tokens;
        }

        kept_recent
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
