use super::downloader_support::package_install_dir;
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
    requests: Arc<Mutex<HashMap<String, DownloadRequest>>>,
}

#[derive(Clone, Debug)]
pub struct DownloadRequest {
    pub repo_url: String,
    pub expected_hash: Option<String>,
    pub dl_type: Option<String>,
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
            requests: Arc::new(Mutex::new(HashMap::new())),
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

    /// Stores the last download request so a paused download can be resumed by the backend.
    pub fn remember_request(&self, module_id: &str, request: DownloadRequest) {
        if let Ok(mut requests) = self.requests.lock() {
            requests.insert(module_id.to_string(), request);
        }
    }

    /// Returns a previously stored download request for resume.
    pub fn get_request(&self, module_id: &str) -> Option<DownloadRequest> {
        self.requests
            .lock()
            .ok()
            .and_then(|requests| requests.get(module_id).cloned())
    }

    /// Removes stored download request metadata.
    pub fn remove_request(&self, module_id: &str) {
        if let Ok(mut requests) = self.requests.lock() {
            requests.remove(module_id);
        }
    }

    /// Signals cancellation for a specific module download
    pub fn cancel(&self, module_id: &str) -> bool {
        if let Ok(controls) = self.controls.lock()
            && let Some(control) = controls.get(module_id)
        {
            control.request_cancel();
            drop(controls);
            self.remove_request(module_id);
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
    let path = package_install_dir(module_id);
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

    #[test]
    fn remembers_and_removes_download_requests() -> Result<(), String> {
        let service = DownloaderService::new();
        service.remember_request(
            "demo",
            super::DownloadRequest {
                repo_url: "https://example.com/file.zip".to_string(),
                expected_hash: Some("hash".to_string()),
                dl_type: Some("release".to_string()),
            },
        );

        let request = service
            .get_request("demo")
            .ok_or_else(|| "request".to_string())?;
        assert_eq!(request.repo_url, "https://example.com/file.zip");

        service.remove_request("demo");
        assert!(service.get_request("demo").is_none());
        Ok(())
    }
}
