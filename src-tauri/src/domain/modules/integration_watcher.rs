//! Filesystem watcher for externally changed integration folders.

use crate::utils::paths::INTEGRATIONS_DIR;
use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::Emitter;

const INTEGRATIONS_CHANGED_EVENT: &str = "integrations_changed";
const EVENT_DEBOUNCE: Duration = Duration::from_millis(350);

/// Payload emitted when the integrations folder changes on disk.
#[derive(Debug, Clone, Serialize)]
pub struct IntegrationsChangedPayload {
    /// Absolute path of the watched integrations directory.
    pub path: String,
}

/// Starts a background watcher for integration folder changes.
pub fn start(app: tauri::AppHandle) {
    let path = INTEGRATIONS_DIR.clone();

    if let Err(error) = std::fs::create_dir_all(&path) {
        tracing::warn!(
            path = %path.display(),
            "Failed to create integrations directory for watcher: {error}"
        );
        return;
    }

    std::thread::Builder::new()
        .name("integration-folder-watcher".to_string())
        .spawn(move || {
            let (tx, rx) = mpsc::channel();
            let mut watcher = match notify::recommended_watcher(tx) {
                Ok(watcher) => watcher,
                Err(error) => {
                    tracing::warn!("Failed to start integrations watcher: {error}");
                    return;
                }
            };

            if let Err(error) = watcher.watch(&path, RecursiveMode::Recursive) {
                tracing::warn!(
                    path = %path.display(),
                    "Failed to watch integrations directory: {error}"
                );
                return;
            }

            let mut debounce_deadline: Option<Instant> = None;
            loop {
                let event = match debounce_deadline {
                    Some(deadline) => {
                        let now = Instant::now();
                        if now >= deadline {
                            emit_integrations_changed(&app, &path);
                            debounce_deadline = None;
                            continue;
                        }
                        rx.recv_timeout(deadline.saturating_duration_since(now))
                    }
                    None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
                };

                match event {
                    Ok(Ok(event)) if is_integration_change(event.kind) => {
                        debounce_deadline = Some(Instant::now() + EVENT_DEBOUNCE);
                    }
                    Ok(Ok(_)) => {}
                    Ok(Err(error)) => {
                        tracing::warn!("Integrations watcher error: {error}");
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        emit_integrations_changed(&app, &path);
                        debounce_deadline = None;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .map_err(|error| {
            tracing::warn!("Failed to spawn integrations watcher thread: {error}");
        })
        .ok();
}

fn emit_integrations_changed(app: &tauri::AppHandle, path: &std::path::Path) {
    if let Err(error) = app.emit(
        INTEGRATIONS_CHANGED_EVENT,
        IntegrationsChangedPayload {
            path: path.to_string_lossy().to_string(),
        },
    ) {
        tracing::warn!("Failed to emit integrations change event: {error}");
    }
}

const fn is_integration_change(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}
