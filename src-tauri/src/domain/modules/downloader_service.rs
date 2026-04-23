use crate::utils::paths::MODULES_DIR;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Default)]
pub(super) struct DownloadControl {
    cancel_requested: AtomicBool,
    pause_requested: AtomicBool,
}

impl DownloadControl {
    pub(super) fn request_cancel(&self) {
        self.cancel_requested.store(true, Ordering::Relaxed);
    }

    pub(super) fn request_pause(&self) {
        self.pause_requested.store(true, Ordering::Relaxed);
    }

    pub(super) fn is_cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::Relaxed)
    }

    pub(super) fn is_pause_requested(&self) -> bool {
        self.pause_requested.load(Ordering::Relaxed)
    }
}

/// Downloader service for managing module downloads
#[derive(Debug)]
pub struct DownloaderService {
    settings: Arc<Mutex<DownloaderSettings>>,
    controls: Arc<Mutex<HashMap<String, Arc<DownloadControl>>>>,
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
            controls: Arc::new(Mutex::new(HashMap::new())),
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

    /// Creates a control handle for a module download and returns it
    pub(super) fn request_control(&self, module_id: &str) -> Arc<DownloadControl> {
        let control = Arc::new(DownloadControl::default());
        if let Ok(mut controls) = self.controls.lock() {
            controls.insert(module_id.to_string(), Arc::clone(&control));
        }
        control
    }

    /// Signals cancellation for a specific module download
    pub fn cancel(&self, module_id: &str) -> bool {
        if let Ok(controls) = self.controls.lock()
            && let Some(control) = controls.get(module_id)
        {
            control.request_cancel();
            tracing::info!("Cancellation requested for module: {module_id}");
            return true;
        }

        false
    }

    /// Signals pause for a specific module download
    pub fn pause(&self, module_id: &str) -> bool {
        if let Ok(controls) = self.controls.lock()
            && let Some(control) = controls.get(module_id)
        {
            control.request_pause();
            tracing::info!("Pause requested for module: {module_id}");
            return true;
        }

        false
    }

    /// Removes a control handle after download finishes
    pub fn remove_control(&self, module_id: &str) {
        if let Ok(mut controls) = self.controls.lock() {
            controls.remove(module_id);
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

#[cfg(test)]
mod tests {
    use super::DownloaderService;

    #[test]
    fn pause_and_cancel_toggle_active_control_flags() {
        let service = DownloaderService::new();
        let control = service.request_control("demo");

        assert!(service.pause("demo"));
        assert!(service.cancel("demo"));
        assert!(control.is_pause_requested());
        assert!(control.is_cancel_requested());
    }

    #[test]
    fn pause_and_cancel_ignore_unknown_module() {
        let service = DownloaderService::new();

        assert!(!service.pause("missing"));
        assert!(!service.cancel("missing"));
    }
}
