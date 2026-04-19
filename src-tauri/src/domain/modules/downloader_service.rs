use crate::utils::paths::MODULES_DIR;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Downloader service for managing module downloads
#[derive(Debug)]
pub struct DownloaderService {
    settings: Arc<Mutex<DownloaderSettings>>,
    cancel_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Clone, Copy, Debug)]
struct DownloaderSettings {
    limit_enabled: bool,
    max_speed_bytes: u64,
}

impl Default for DownloaderSettings {
    fn default() -> Self {
        Self {
            limit_enabled: false,
            max_speed_bytes: 5 * 1024 * 1024,
        }
    }
}

impl DownloaderService {
    /// Creates a new downloader service instance
    pub fn new() -> Self {
        Self {
            settings: Arc::new(Mutex::new(DownloaderSettings::default())),
            cancel_tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Sets download speed limit
    pub fn set_limit(&self, enabled: bool, max_speed_mb: u32) {
        if let Ok(mut settings) = self.settings.lock() {
            settings.limit_enabled = enabled;
            settings.max_speed_bytes = u64::from(max_speed_mb) * 1024 * 1024;
            tracing::info!("Download limit set: enabled={enabled}, speed={max_speed_mb}MB/s");
        }
    }

    /// Gets current download settings
    pub fn get_settings(&self) -> (bool, u32) {
        self.settings.lock().map_or((false, 0), |settings| {
            let speed_mb = settings.max_speed_bytes / 1024 / 1024;
            (
                settings.limit_enabled,
                u32::try_from(speed_mb).unwrap_or(u32::MAX),
            )
        })
    }

    /// Creates a cancellation token for a module download and returns it
    pub fn request_token(&self, module_id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut tokens) = self.cancel_tokens.lock() {
            tokens.insert(module_id.to_string(), Arc::clone(&token));
        }
        token
    }

    /// Signals cancellation for a specific module download
    pub fn cancel(&self, module_id: &str) -> bool {
        if let Ok(tokens) = self.cancel_tokens.lock()
            && let Some(token) = tokens.get(module_id)
        {
            token.store(true, Ordering::Relaxed);
            tracing::info!("Cancellation requested for module: {module_id}");
            return true;
        }

        false
    }

    /// Removes a cancellation token after download finishes
    pub fn remove_token(&self, module_id: &str) {
        if let Ok(mut tokens) = self.cancel_tokens.lock() {
            tokens.remove(module_id);
        }
    }
}

impl Default for DownloaderService {
    fn default() -> Self {
        Self::new()
    }
}

pub(super) fn resolve_existing_module_path(module_id: &str) -> Option<PathBuf> {
    let path = MODULES_DIR.join(module_id);
    (path.exists() && path.is_dir()).then_some(path)
}
