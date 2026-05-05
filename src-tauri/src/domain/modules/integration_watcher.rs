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

            let mut last_emit = Instant::now()
                .checked_sub(EVENT_DEBOUNCE)
                .unwrap_or_else(Instant::now);
            while let Ok(event) = rx.recv() {
                match event {
                    Ok(event) if is_integration_change(event.kind) => {
                        if last_emit.elapsed() < EVENT_DEBOUNCE {
                            continue;
                        }
                        last_emit = Instant::now();
                        if let Err(error) = app.emit(
                            INTEGRATIONS_CHANGED_EVENT,
                            IntegrationsChangedPayload {
                                path: path.to_string_lossy().to_string(),
                            },
                        ) {
                            tracing::warn!("Failed to emit integrations change event: {error}");
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!("Integrations watcher error: {error}");
                    }
                }
            }
        })
        .map_err(|error| {
            tracing::warn!("Failed to spawn integrations watcher thread: {error}");
        })
        .ok();
}

const fn is_integration_change(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}
