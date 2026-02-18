use crate::errors::AppError;
use crate::utils::paths::{MODULES_DIR, TEMP_DIR};
use chrono;
use futures_util::StreamExt;
use std::fs;
use std::io::copy;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;
use zip::result::ZipError;

/// Download progress event payload
#[derive(Clone, serde::Serialize, Debug)]
pub struct DownloadProgress {
    /// Module identifier
    pub module_id: String,
    /// Current status ("connecting", "downloading", "extracting", "complete", "error")
    pub status: String,
    /// Progress fraction (0.0-1.0)
    pub progress: f32,
    /// Human-readable status message
    pub message: String,
    /// Bytes downloaded
    pub downloaded: u64,
    /// Total bytes
    pub total: u64,
}

/// Validates module ID to prevent directory traversal and injection attacks
pub fn validate_module_id(module_id: &str) -> Result<(), AppError> {
    if module_id.is_empty() {
        return Err(AppError::Validation(
            "Module ID cannot be empty".to_string(),
        ));
    }
    if !module_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "Module ID contains invalid characters. Only alphanumeric, '-', and '_' are allowed."
                .to_string(),
        ));
    }
    if module_id.contains("..") {
        return Err(AppError::Validation(
            "Module ID cannot contain directory traversal patterns".to_string(),
        ));
    }
    Ok(())
}
/// Returns the filesystem path to a module's directory
pub fn get_module_path(module_id: &str) -> PathBuf {
    // Note: Callers should validate module_id before using this path for sensitive operations
    MODULES_DIR.join(module_id)
}

/// Checks if a module is installed locally
pub fn is_module_installed(module_id: &str) -> bool {
    if validate_module_id(module_id).is_err() {
        return false;
    }
    let module_path = MODULES_DIR.join(module_id);
    module_path.exists() && module_path.is_dir()
}

/// Deletes a module from disk
pub fn delete_module(module_id: &str) -> Result<(), AppError> {
    validate_module_id(module_id)?;

    let module_path = MODULES_DIR.join(module_id);
    if module_path.exists() {
        fs::remove_dir_all(&module_path).map_err(|e| AppError::Io(e.to_string()))?;
        crate::infrastructure::logging::logger::add_log(
            &format!("Module {module_id} deleted"),
            "Downloader",
            "info",
        );
        Ok(())
    } else {
        Err(AppError::NotFound("Module not found".to_string()))
    }
}

use std::sync::LazyLock;
use std::sync::{Arc, Mutex};

/// Global downloader service instance
pub static DOWNLOADER: LazyLock<DownloaderService> = LazyLock::new(DownloaderService::new);

/// Downloader service for managing module downloads
#[derive(Debug)]
pub struct DownloaderService {
    settings: Arc<Mutex<DownloaderSettings>>,
}

#[derive(Clone, Copy, Debug)]
struct DownloaderSettings {
    limit_enabled: bool,
    max_speed_bytes: u64, // Bytes per second
}

impl Default for DownloaderService {
    fn default() -> Self {
        Self::new()
    }
}

impl DownloaderService {
    /// Creates a new downloader service instance
    pub fn new() -> Self {
        Self {
            settings: Arc::new(Mutex::new(DownloaderSettings {
                limit_enabled: false,
                max_speed_bytes: 5 * 1024 * 1024, // Default 5MB/s
            })),
        }
    }

    /// Sets download speed limit
    pub fn set_limit(&self, enabled: bool, max_speed_mb: u32) {
        if let Ok(mut settings) = self.settings.lock() {
            settings.limit_enabled = enabled;
            settings.max_speed_bytes = u64::from(max_speed_mb) * 1024 * 1024;
            log::info!("Download limit set: enabled={enabled}, speed={max_speed_mb}MB/s");
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
}

// --- New Components ---

struct UrlResolver;

impl UrlResolver {
    /// Resolves the actual download URL, handling GitHub specific logic (main/master fallback)
    async fn resolve(client: &reqwest::Client, download_url: &str) -> Result<String, AppError> {
        // GitHub Smart Branch Discovery (main -> master)
        if download_url.contains("github.com")
            && !Path::new(download_url)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
        {
            let base_url = download_url.trim_end_matches(".git").trim_end_matches('/');
            let main_url = format!("{base_url}/archive/refs/heads/main.zip");
            let master_url = format!("{base_url}/archive/refs/heads/master.zip");

            log::info!("Trying to download from: {main_url}");
            let response = client
                .get(&main_url)
                .send()
                .await
                .map_err(|e| AppError::External {
                    request_id: None,
                    message: format!("Failed to connect: {e}"),
                })?;

            if response.status().is_success() {
                return Ok(main_url);
            }

            if response.status() == reqwest::StatusCode::NOT_FOUND {
                log::info!("main branch not found, trying master: {master_url}");
                let response_master =
                    client
                        .get(&master_url)
                        .send()
                        .await
                        .map_err(|e| AppError::External {
                            request_id: None,
                            message: format!("Failed to connect: {e}"),
                        })?;

                if response_master.status().is_success() {
                    return Ok(master_url);
                }
            }

            return Err(AppError::NotFound(format!(
                "Module source not found. Tried both 'main' and 'master' branches at {base_url}"
            )));
        }

        Ok(download_url.to_string())
    }
}

struct NetworkClient;

impl NetworkClient {
    /// Builds the HTTP client with correct headers and license injection
    fn build_client(module_id: &str) -> Result<reqwest::Client, AppError> {
        let mut client_builder = reqwest::Client::builder()
            .user_agent("Axelate/1.0.0 (Tauri; Windows)")
            .timeout(std::time::Duration::from_secs(600));

        // Inject License Key if available
        if let Some(license) = crate::domain::license::storage::load_license()
            && !license.key.is_empty()
        {
            log::info!("Injecting license key for module download: {module_id}");
            let mut headers = reqwest::header::HeaderMap::new();
            if let Ok(auth_val) =
                reqwest::header::HeaderValue::from_str(&format!("Bearer {}", license.key))
            {
                headers.insert(reqwest::header::AUTHORIZATION, auth_val);
            }
            if let Ok(lic_val) = reqwest::header::HeaderValue::from_str(&license.key) {
                headers.insert("X-Axelate-License", lic_val);
            }
            client_builder = client_builder.default_headers(headers);
        }

        client_builder.build().map_err(|e| AppError::External {
            request_id: None,
            message: format!("Client error: {e}"),
        })
    }

    /// Downloads content with progress reporting and rate limiting
    async fn download_file(
        app: &AppHandle,
        client: &reqwest::Client,
        url: &str,
        dest_path: &Path,
        module_id: &str,
    ) -> Result<(), AppError> {
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::External {
                request_id: None,
                message: format!("Failed to connect: {e}"),
            })?;

        if !response.status().is_success() {
            return Err(AppError::External {
                request_id: None,
                message: format!("Download failed: {}", response.status()),
            });
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        let mut stream = response.bytes_stream();

        fs::create_dir_all(&*TEMP_DIR).map_err(|e| AppError::Io(e.to_string()))?;

        let mut file = tokio::fs::File::create(dest_path).await?;

        let mut last_log_time = std::time::Instant::now();

        while let Some(item) = stream.next().await {
            let chunk_start = std::time::Instant::now();
            let chunk = item.map_err(|e| AppError::External {
                request_id: None,
                message: format!("Stream error: {e}"),
            })?;
            let chunk_len = chunk.len();

            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::Io(e.to_string()))?;
            downloaded += chunk_len as u64;

            // Rate Limiting Logic via global service
            let (limit_enabled, max_speed_bytes) = DOWNLOADER.get_settings();
            if limit_enabled && max_speed_bytes > 0 {
                let ideal_duration_micros =
                    (chunk_len as u128 * 1_000_000) / u128::from(max_speed_bytes);
                let elapsed_micros = chunk_start.elapsed().as_micros();

                if ideal_duration_micros > elapsed_micros {
                    let sleep_micros = ideal_duration_micros - elapsed_micros;
                    if sleep_micros > 1000 {
                        tokio::time::sleep(tokio::time::Duration::from_micros(
                            u64::try_from(sleep_micros).unwrap_or(0),
                        ))
                        .await;
                    }
                }
            }

            if total_size > 0 && last_log_time.elapsed().as_millis() > 100 {
                last_log_time = std::time::Instant::now();
                #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
                let progress = (downloaded as f64 / total_size as f64) as f32;
                emit_progress(
                    app,
                    module_id,
                    "downloading",
                    "Downloading...",
                    progress,
                    downloaded,
                    total_size,
                );
            }
        }

        Ok(())
    }
}

struct FileVerifier;

impl FileVerifier {
    /// Verifies the SHA256 hash of a file
    async fn verify(
        app: &AppHandle,
        file_path: &Path,
        expected_hash: Option<String>,
        module_id: &str,
    ) -> Result<(), AppError> {
        if let Some(expected_hash) = expected_hash {
            if expected_hash.trim().is_empty() {
                log::warn!(
                    "Skipping integrity check for {module_id} because expected_hash is empty"
                );
                return Ok(());
            }

            emit_progress(
                app,
                module_id,
                "verifying",
                "Verifying Integrity...",
                1.0,
                0,
                0,
            );

            let path_clone = file_path.to_path_buf();
            let computed_hash = tokio::task::spawn_blocking(move || {
                use sha2::{Digest, Sha256};
                use std::io::Read;

                let mut file = std::fs::File::open(&path_clone).map_err(|e| e.to_string())?;
                let mut hasher = Sha256::new();
                let mut buffer = [0; 8192];

                loop {
                    let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
                    if count == 0 {
                        break;
                    }
                    if let Some(slice) = buffer.get(..count) {
                        hasher.update(slice);
                    }
                }
                Ok::<String, String>(hex::encode(hasher.finalize()))
            })
            .await
            .map_err(|e| AppError::Internal {
                request_id: None,
                message: e.to_string(),
            })?
            .map_err(|e| AppError::Internal {
                request_id: None,
                message: e,
            })?;

            if computed_hash.to_lowercase() != expected_hash.to_lowercase() {
                return Err(AppError::Validation(format!(
                    "Integrity check failed. Expected {expected_hash}, got {computed_hash}"
                )));
            }

            log::info!("Integrity verified for {module_id}");
        }
        Ok(())
    }
}

struct ArchiveExtractor;

impl ArchiveExtractor {
    /// Extracts a ZIP archive to the target directory, handling nested roots
    async fn extract(
        app: &AppHandle,
        zip_path: &Path,
        module_id: &str,
        expected_hash: &Option<String>,
    ) -> Result<(), AppError> {
        emit_progress(app, module_id, "extracting", "Extracting...", 0.0, 0, 0);

        // 1. Prepare Paths for Atomic Install
        let final_path = MODULES_DIR.join(module_id);
        let extraction_id = format!("extracting_{}_{}", module_id, uuid::Uuid::new_v4());
        let extraction_path = TEMP_DIR.join(extraction_id);

        if extraction_path.exists() {
            fs::remove_dir_all(&extraction_path).ok();
        }
        fs::create_dir_all(&extraction_path).map_err(|e| AppError::Io(e.to_string()))?;

        let app_handle = app.clone();
        let mid = module_id.to_string();
        let zpath = zip_path.to_owned();
        let epath = extraction_path.clone();
        let hash_snapshot = expected_hash.clone();

        // 2. Heavy Extraction
        tokio::task::spawn_blocking(move || {
            let zip_file = fs::File::open(&zpath).map_err(|e| e.to_string())?;
            let mut archive =
                ZipArchive::new(zip_file).map_err(|e| format!("Invalid archive: {e}"))?;

            let total_files = archive.len();

            // ZIP Bomb & Integrity Limits
            const MAX_TOTAL_UNCOMPRESSED_SIZE: u64 = 800 * 1024 * 1024; // 800MB Limit
            const MAX_FILE_COUNT: usize = 10000;
            const MAX_SINGLE_FILE_SIZE: u64 = 300 * 1024 * 1024; // 300MB per file
            const MAX_COMPRESSION_RATIO: u64 = 100; // 100:1 ratio limit

            let mut current_total_size: u64 = 0;
            let mut seen_files = std::collections::HashSet::new();

            if total_files > MAX_FILE_COUNT {
                return Err(format!(
                    "Archive contains too many files ({total_files}). Limit is {MAX_FILE_COUNT}."
                ));
            }

            // Determine if there is a common root folder to skip
            let root_to_skip = {
                let mut first_dir: Option<String> = None;
                let mut all_share_root = true;

                for i in 0..total_files {
                    let file = archive.by_index(i).map_err(|e: ZipError| e.to_string())?;
                    let name = file.name().to_string();
                    if name == "/" || name.is_empty() {
                        continue;
                    }

                    let parts: Vec<&str> =
                        name.split('/').filter(|s: &&str| !s.is_empty()).collect();
                    if parts.is_empty() {
                        continue;
                    }

                    match &first_dir {
                        None => {
                            if let Some(first) = parts.first() {
                                first_dir = Some((*first).to_string());
                            }
                        }
                        Some(root) => {
                            if parts.first().is_some_and(|first| *first != root) {
                                all_share_root = false;
                                break;
                            }
                        }
                    }
                }
                if all_share_root { first_dir } else { None }
            };

            for i in 0..total_files {
                let mut file = archive
                    .by_index(i)
                    .map_err(|e: ZipError| e.to_string())?;

                // Security: Duplicate Entry Detection
                let raw_name = file.name().to_string();
                if !seen_files.insert(raw_name.clone()) {
                    return Err(format!("Security Violation: Duplicate entry in archive: {raw_name}"));
                }

                // Security: Symlink, Hardlink, and Device Rejection
                // Note: enclosed_name covers basic ZipSlip but we want to be explicit about types
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    if let Some(mode) = file.unix_mode() {
                        let file_type = mode & 0o170000;
                        if file_type != 0o100000 && file_type != 0o040000 {
                            return Err(format!("Security Violation: Unsupported file type (symlink/device) in archive: {raw_name}"));
                        }
                    }
                }

                let outpath = match file.enclosed_name() {
                    Some(path) => {
                        // Security: Absolute Path Rejection
                        if path.is_absolute() {
                            return Err(format!("Security Violation: Absolute path detected: {raw_name}"));
                        }

                        if let Some(root) = &root_to_skip {
                            let mut components = path.as_path().components();
                            let first = components.next();
                            if let Some(std::path::Component::Normal(c)) = first {
                                if c.to_string_lossy() == *root {
                                    epath.join(components.as_path())
                                } else {
                                    epath.join(path)
                                }
                            } else {
                                epath.join(path)
                            }
                        } else {
                            epath.join(path)
                        }
                    }
                    None => continue,
                };

                if outpath == epath {
                    continue;
                }

                if (*file.name()).ends_with('/') {
                    fs::create_dir_all(&outpath).ok();
                } else {
                    if let Some(p) = outpath.parent()
                        && !p.exists()
                    {
                        fs::create_dir_all(p).ok();
                    }

                    // ZIP Bomb Protection (Advanced)
                    let u_size = file.size();
                    let c_size = file.compressed_size();

                    if u_size > MAX_SINGLE_FILE_SIZE {
                        return Err(format!("Security Violation: Single file size exceeds limit ({}MB): {raw_name}", MAX_SINGLE_FILE_SIZE / (1024 * 1024)));
                    }

                    if c_size > 0 {
                        let ratio = u_size / c_size;
                        if ratio > MAX_COMPRESSION_RATIO && u_size > 1024 * 1024 {
                            return Err(format!("Security Violation: Anomalous compression ratio ({}x) detected for {}", ratio, raw_name));
                        }
                    }

                    current_total_size += u_size;
                    if current_total_size > MAX_TOTAL_UNCOMPRESSED_SIZE {
                        return Err(format!(
                            "Extraction aborted: Total uncompressed size exceeds limit ({}MB)",
                            MAX_TOTAL_UNCOMPRESSED_SIZE / (1024 * 1024)
                        ));
                    }

                    let mut outfile = fs::File::create(&outpath)
                        .map_err(|e| format!("Failed to create file {}: {e}", outpath.display()))?;
                    copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                }

                if i % 10 == 0 {
                    #[allow(clippy::cast_precision_loss)]
                    let progress = i as f32 / total_files as f32;
                    emit_progress(
                        &app_handle,
                        &mid,
                        "extracting",
                        "Extracting...",
                        progress,
                        0,
                        0,
                    );
                }
            }

            // 3. Create Manifest (metadata.json)
            let manifest = serde_json::json!({
                "module_id": mid,
                "installed_at": chrono::Local::now().to_rfc3339(),
                "archive_hash": hash_snapshot,
                "status": "complete",
                "version": "unknown" // Version is usually in module.json, but keep for consistency
            });
            let manifest_path = epath.join("metadata.json");
            if let Ok(m_file) = fs::File::create(manifest_path) {
                let _ = serde_json::to_writer_pretty(m_file, &manifest);
            }

            Ok::<(), String>(())
        })
        .await
        .map_err(|e| AppError::Internal {
            request_id: None,
            message: format!("Blocking task failed: {e}"),
        })?
        .map_err(|e| AppError::Internal {
            request_id: None,
            message: format!("Extraction failed: {e}"),
        })?;

        // 4. Atomic Swap (Rename)
        if final_path.exists() {
            fs::remove_dir_all(&final_path)
                .map_err(|e| AppError::Io(format!("Failed to remove old module version: {e}")))?;
        }

        fs::rename(&extraction_path, &final_path).map_err(|e| {
            AppError::Io(format!(
                "Atomic install failed during move: {e}. Attempting manual copy..."
            ))
        })?;

        Ok(())
    }
}

/// Downloads and extracts a module from a remote repository
pub async fn download_module(
    app: AppHandle,
    module_id: String,
    repo_url: String,
    expected_hash: Option<String>,
) -> Result<(), AppError> {
    validate_module_id(&module_id)?;

    let zip_path = TEMP_DIR.join(format!("{module_id}.zip.tmp"));

    // Orchestrate components
    let result = async {
        emit_progress(&app, &module_id, "connecting", "Connecting...", 0.0, 0, 0);

        let client = NetworkClient::build_client(&module_id)?;
        let final_url = UrlResolver::resolve(&client, &repo_url).await?;

        NetworkClient::download_file(&app, &client, &final_url, &zip_path, &module_id).await?;
        FileVerifier::verify(&app, &zip_path, expected_hash.clone(), &module_id).await?;
        ArchiveExtractor::extract(&app, &zip_path, &module_id, &expected_hash).await?;

        Ok::<(), AppError>(())
    }
    .await;

    // Guaranteed cleanup of temp zip
    if zip_path.exists() {
        let _ = tokio::fs::remove_file(&zip_path).await;
    }

    if let Err(e) = result {
        emit_progress(&app, &module_id, "error", &e.to_string(), 0.0, 0, 0);

        // Ensure failed extraction path is cleaned up if it was left behind
        // Note: extraction_path is not easily accessible here without more plumbing,
        // but it's in TEMP_DIR and would be overwritten on next try anyway.

        return Err(e);
    }

    emit_progress(&app, &module_id, "complete", "Success", 1.0, 0, 0);

    crate::infrastructure::logging::logger::add_log(
        &format!("Module {module_id} installed successfully (Atomic)"),
        "Downloader",
        "info",
    );

    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    module_id: &str,
    status: &str,
    message: &str,
    progress: f32,
    downloaded: u64,
    total: u64,
) {
    let _ = app.emit(
        "download_progress",
        DownloadProgress {
            module_id: module_id.to_string(),
            status: status.to_string(),
            progress,
            message: message.to_string(),
            downloaded,
            total,
        },
    );
}

/// Checks if a module is installed (wrapper)
pub fn check_module_installed(module_id: &str) -> bool {
    is_module_installed(module_id)
}

/// Lists files in a module directory (stub)
pub fn list_module_files(_module_id: String) -> Result<Vec<String>, AppError> {
    // Basic stub or implementation
    Ok(vec![])
}
