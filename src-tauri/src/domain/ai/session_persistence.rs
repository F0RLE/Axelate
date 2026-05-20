//! Atomic disk persistence for chat session history.
//!
//! Handles crash-safe writes via temp-file + rename, recovery from
//! interrupted writes, and corrupt-file backup.

use dashmap::DashMap;
use std::collections::HashMap;

use super::types::ChatSession;

pub(super) struct SessionPersistence;

impl SessionPersistence {
    pub(super) fn history_path() -> &'static std::path::Path {
        &crate::utils::paths::FILE_CHAT_HISTORY
    }

    pub(crate) fn temp_history_path() -> std::path::PathBuf {
        Self::history_path().with_extension("tmp")
    }

    fn backup_history_path() -> std::path::PathBuf {
        Self::history_path().with_extension("bak")
    }

    pub(super) fn load_sessions() -> Result<DashMap<String, ChatSession>, crate::errors::AppError> {
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

    pub(super) fn flush_snapshot(
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
            tracing::warn!("Rename failed ({error}), using backup replace fallback...");
            let backup_path = Self::backup_history_path();
            match std::fs::remove_file(&backup_path) {
                Ok(()) => {}
                Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => {}
                Err(remove_error) => {
                    let _ = std::fs::remove_file(&tmp_path);
                    return Err(crate::errors::AppError::Io(format!(
                        "Failed to prepare chat history backup '{}': first rename failed: {error}; removing stale backup failed: {remove_error}",
                        backup_path.display()
                    )));
                }
            }

            let had_original = path.exists();
            if had_original {
                std::fs::rename(path, &backup_path).map_err(|backup_error| {
                    let _ = std::fs::remove_file(&tmp_path);
                    crate::errors::AppError::Io(format!(
                        "Failed to back up chat history '{}' to '{}': first rename failed: {error}; backup rename failed: {backup_error}",
                        path.display(),
                        backup_path.display()
                    ))
                })?;
            }

            if let Err(second_error) = std::fs::rename(&tmp_path, path) {
                let restore_message = if had_original {
                    match std::fs::rename(&backup_path, path) {
                        Ok(()) => "backup restore succeeded".to_string(),
                        Err(restore_error) => {
                            format!("backup restore failed: {restore_error}")
                        }
                    }
                } else {
                    "no original file to restore".to_string()
                };
                let _ = std::fs::remove_file(&tmp_path);
                return Err(crate::errors::AppError::Io(format!(
                    "Failed to publish chat history '{}': first rename failed: {error}; second rename failed: {second_error}; {restore_message}",
                    path.display()
                )));
            }

            if had_original {
                let _ = std::fs::remove_file(&backup_path);
            }
        }

        Ok(())
    }
}
