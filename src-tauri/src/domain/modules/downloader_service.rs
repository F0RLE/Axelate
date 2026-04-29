use super::downloader_support::{is_engine_package, package_install_dir};
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
    pub release_selection: Option<super::github_releases::ReleaseDownloadSelection>,
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
    if path.exists() && path.is_dir() {
        return Some(path.canonicalize().unwrap_or(path));
    }

    resolve_existing_module_path_case_insensitive(module_id)
}

fn resolve_existing_module_path_case_insensitive(module_id: &str) -> Option<PathBuf> {
    let root = if is_engine_package(module_id) {
        &*crate::utils::paths::ENGINES_DIR
    } else {
        &*crate::utils::paths::INTEGRATIONS_DIR
    };
    let requested = module_id.to_ascii_lowercase();

    std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .find_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }

            let folder_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if folder_name == requested {
                return Some(entry.path());
            }

            let manifest_path = entry.path().join("axelate-module.toml");
            let manifest_id = std::fs::read_to_string(manifest_path)
                .ok()
                .and_then(|content| toml::from_str::<toml::Value>(&content).ok())
                .and_then(|manifest| {
                    manifest
                        .get("id")
                        .and_then(toml::Value::as_str)
                        .map(str::to_ascii_lowercase)
                })?;

            (manifest_id == requested).then_some(entry.path())
        })
}

#[cfg(test)]
mod tests {
    use super::DownloaderService;
    use std::time::{SystemTime, UNIX_EPOCH};

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
                release_selection: None,
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

    #[test]
    fn resolves_existing_integration_path_by_manifest_id_when_folder_case_differs()
    -> Result<(), Box<dyn std::error::Error>> {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("time: {error}"))?
            .as_nanos();
        let folder_name = format!("Demo-Integration-{unique}");
        let manifest_id = format!("demo-integration-{unique}");
        let module_dir = crate::utils::paths::INTEGRATIONS_DIR.join(&folder_name);
        std::fs::create_dir_all(&module_dir)?;
        std::fs::write(
            module_dir.join("axelate-module.toml"),
            format!("id = \"{manifest_id}\"\n"),
        )?;

        let resolved = super::resolve_existing_module_path(&manifest_id)
            .ok_or_else(|| "resolve by manifest id".to_string())?;
        assert_eq!(resolved, module_dir.canonicalize()?);
        Ok(())
    }

    #[test]
    fn resolves_existing_integration_path_case_insensitively()
    -> Result<(), Box<dyn std::error::Error>> {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("time: {error}"))?
            .as_nanos();
        let folder_name = format!("Case-Integration-{unique}");
        let module_dir = crate::utils::paths::INTEGRATIONS_DIR.join(&folder_name);
        std::fs::create_dir_all(&module_dir)?;

        let resolved = super::resolve_existing_module_path(&folder_name.to_ascii_lowercase())
            .ok_or_else(|| "resolve by folder name".to_string())?;
        assert_eq!(resolved, module_dir.canonicalize()?);
        Ok(())
    }
}
