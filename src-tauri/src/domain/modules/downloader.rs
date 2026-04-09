use crate::errors::AppError;
use crate::utils::paths::{LEGACY_MODULES_DIR, MODULES_DIR, TEMP_DIR};
use chrono;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::fs;
use std::io::copy;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;
use zip::result::ZipError;

const MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE: u64 = 3 * 1024 * 1024 * 1024; // 3GB per archive
const MAX_ARCHIVE_FILE_COUNT: usize = 10000;
const MAX_ARCHIVE_SINGLE_FILE_SIZE: u64 = 1024 * 1024 * 1024; // 1GB per file, needed for CUDA DLLs

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
    /// Current transfer speed in bytes per second
    pub speed: u64,
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
    resolve_existing_module_path(module_id).unwrap_or_else(|| MODULES_DIR.join(module_id))
}

/// Checks if a module is installed locally
pub fn is_module_installed(module_id: &str) -> bool {
    if validate_module_id(module_id).is_err() {
        return false;
    }
    resolve_existing_module_path(module_id).is_some()
}

/// Deletes a module from disk
pub async fn delete_module(module_id: &str) -> Result<(), AppError> {
    validate_module_id(module_id)?;

    let module_path = get_module_path(module_id);
    if module_path.exists() {
        tokio::fs::remove_dir_all(&module_path)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
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

fn resolve_existing_module_path(module_id: &str) -> Option<PathBuf> {
    let candidates = [
        MODULES_DIR.join(module_id),
        LEGACY_MODULES_DIR.join(module_id),
    ];

    candidates
        .into_iter()
        .find(|path| path.exists() && path.is_dir())
}

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
    max_speed_bytes: u64, // Bytes per second
}

impl Default for DownloaderSettings {
    fn default() -> Self {
        Self {
            limit_enabled: false,
            max_speed_bytes: 5 * 1024 * 1024, // Default 5MB/s
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
}

impl Default for DownloaderService {
    fn default() -> Self {
        Self::new()
    }
}

impl DownloaderService {
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
        if let Ok(tokens) = self.cancel_tokens.lock() {
            if let Some(token) = tokens.get(module_id) {
                token.store(true, Ordering::Relaxed);
                tracing::info!("Cancellation requested for module: {module_id}");
                return true;
            }
        }
        false
    }

    /// Removes a cancellation token (cleanup after download finishes)
    pub fn remove_token(&self, module_id: &str) {
        if let Ok(mut tokens) = self.cancel_tokens.lock() {
            tokens.remove(module_id);
        }
    }
}

// --- New Components ---

struct UrlResolver;

type ReleaseDownloadAsset = (String, String, Option<String>, Option<u64>);

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

            tracing::info!("Trying to download from: {main_url}");
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
                tracing::info!("main branch not found, trying master: {master_url}");
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

#[derive(Clone, Copy, Debug, Default)]
struct ProgressSnapshot {
    downloaded: u64,
    total: u64,
}

#[derive(Clone, Copy, Debug)]
struct AggregateDownloadContext {
    completed_bytes_before: u64,
    total_bytes: u64,
}

struct DownloadTask<'a> {
    app: &'a AppHandle,
    downloader: &'a DownloaderService,
    client: &'a reqwest::Client,
    url: &'a str,
    dest_path: &'a Path,
    module_id: &'a str,
    cancel_token: &'a AtomicBool,
}

#[derive(Clone, Copy)]
struct ProgressEvent<'a> {
    app: &'a AppHandle,
    module_id: &'a str,
    status: &'a str,
    message: &'a str,
    progress: f32,
    downloaded: u64,
    total: u64,
    speed: u64,
}

#[derive(Clone, Copy, Debug, Default)]
struct DownloadResult {
    asset_downloaded: u64,
    snapshot: ProgressSnapshot,
}

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
            tracing::info!("Injecting license key for module download: {module_id}");
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

    /// Downloads content with progress reporting, rate limiting, and cancellation support
    async fn download_file(
        task: DownloadTask<'_>,
        aggregate_context: Option<AggregateDownloadContext>,
    ) -> Result<DownloadResult, AppError> {
        let response = task
            .client
            .get(task.url)
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
        let mut bytes_downloaded: u64 = 0;
        let mut stream = response.bytes_stream();
        let mut window_bytes: u64 = 0;

        fs::create_dir_all(&*TEMP_DIR).map_err(|e| AppError::Io(e.to_string()))?;

        let mut file = tokio::fs::File::create(task.dest_path).await?;

        let mut last_log_time = std::time::Instant::now();
        let mut last_speed_bytes_per_sec: u64 = 0;

        while let Some(item) = stream.next().await {
            // Check cancellation
            if task.cancel_token.load(Ordering::Relaxed) {
                tracing::info!("Download cancelled for module: {}", task.module_id);
                return Err(AppError::Validation("Download cancelled".to_string()));
            }

            let chunk_start = std::time::Instant::now();
            let chunk = item.map_err(|e| AppError::External {
                request_id: None,
                message: format!("Stream error: {e}"),
            })?;
            let chunk_len = chunk.len();

            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::Io(e.to_string()))?;
            bytes_downloaded += chunk_len as u64;
            window_bytes += chunk_len as u64;

            // Rate Limiting Logic via injected service
            let (limit_enabled, max_speed_bytes) = task.downloader.get_settings();
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

            if last_log_time.elapsed().as_millis() > 100 {
                let elapsed = last_log_time.elapsed().as_secs_f64();
                if elapsed > 0.0 {
                    last_speed_bytes_per_sec = calculate_speed(window_bytes, elapsed);
                }
                last_log_time = std::time::Instant::now();
                window_bytes = 0;
                let snapshot =
                    build_progress_snapshot(bytes_downloaded, total_size, aggregate_context);
                let progress = compute_progress(snapshot);
                emit_progress(ProgressEvent {
                    app: task.app,
                    module_id: task.module_id,
                    status: "downloading",
                    message: "Downloading...",
                    progress,
                    downloaded: snapshot.downloaded,
                    total: snapshot.total,
                    speed: last_speed_bytes_per_sec,
                });
            }
        }

        let snapshot = build_progress_snapshot(bytes_downloaded, total_size, aggregate_context);
        let progress = compute_progress(snapshot);

        emit_progress(ProgressEvent {
            app: task.app,
            module_id: task.module_id,
            status: "downloading",
            message: "Downloading...",
            progress,
            downloaded: snapshot.downloaded,
            total: snapshot.total,
            speed: last_speed_bytes_per_sec,
        });

        Ok(DownloadResult {
            asset_downloaded: bytes_downloaded,
            snapshot,
        })
    }
}

#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn calculate_speed(window_bytes: u64, elapsed_secs: f64) -> u64 {
    if !(elapsed_secs.is_finite()) || elapsed_secs <= 0.0 {
        return 0;
    }

    (window_bytes as f64 / elapsed_secs).round() as u64
}

fn build_progress_snapshot(
    asset_downloaded: u64,
    asset_total: u64,
    aggregate_context: Option<AggregateDownloadContext>,
) -> ProgressSnapshot {
    if let Some(context) = aggregate_context {
        return ProgressSnapshot {
            downloaded: context.completed_bytes_before + asset_downloaded,
            total: context.total_bytes,
        };
    }

    ProgressSnapshot {
        downloaded: asset_downloaded,
        total: asset_total.max(asset_downloaded),
    }
}

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
fn compute_progress(snapshot: ProgressSnapshot) -> f32 {
    if snapshot.total > 0 {
        (snapshot.downloaded as f64 / snapshot.total as f64) as f32
    } else {
        -1.0
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
        progress_snapshot: Option<ProgressSnapshot>,
    ) -> Result<(), AppError> {
        if let Some(expected_hash) = expected_hash {
            if expected_hash.trim().is_empty() {
                tracing::warn!(
                    "Skipping integrity check for {module_id} because expected_hash is empty"
                );
                return Ok(());
            }

            emit_progress(ProgressEvent {
                app,
                module_id,
                status: "verifying",
                message: "Verifying Integrity...",
                progress: 1.0,
                downloaded: progress_snapshot.map_or(0, |snapshot| snapshot.downloaded),
                total: progress_snapshot.map_or(0, |snapshot| snapshot.total),
                speed: 0,
            });

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

            tracing::info!("Integrity verified for {module_id}");
        }
        Ok(())
    }
}

struct ArchiveExtractor;

impl ArchiveExtractor {
    fn prepare_staging(module_id: &str) -> Result<PathBuf, AppError> {
        let extraction_id = format!("extracting_{}_{}", module_id, uuid::Uuid::new_v4());
        let extraction_path = TEMP_DIR.join(extraction_id);

        if extraction_path.exists() {
            fs::remove_dir_all(&extraction_path).ok();
        }
        fs::create_dir_all(&extraction_path).map_err(|e| AppError::Io(e.to_string()))?;

        Ok(extraction_path)
    }

    /// Extracts an archive into an existing staging directory.
    async fn extract_into(
        app: &AppHandle,
        archive_path: &Path,
        module_id: &str,
        extraction_path: &Path,
        progress_snapshot: Option<ProgressSnapshot>,
    ) -> Result<(), AppError> {
        emit_progress(ProgressEvent {
            app,
            module_id,
            status: "extracting",
            message: "Extracting...",
            progress: 0.0,
            downloaded: progress_snapshot.map_or(0, |snapshot| snapshot.downloaded),
            total: progress_snapshot.map_or(0, |snapshot| snapshot.total),
            speed: 0,
        });

        let app_handle = app.clone();
        let mid = module_id.to_string();
        let apath = archive_path.to_owned();
        let epath = extraction_path.to_path_buf();

        let is_tar_gz = archive_path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| {
                name.ends_with(".tar.gz")
                    || std::path::Path::new(name)
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("tgz"))
            });

        // 2. Heavy Extraction
        tokio::task::spawn_blocking(move || {
            let archive_file = fs::File::open(&apath).map_err(|e| e.to_string())?;

            if is_tar_gz {
                tracing::info!("Extracting .tar.gz archive for {}", mid);
                let tar = flate2::read::GzDecoder::new(archive_file);
                let mut archive = tar::Archive::new(tar);

                let mut current_total_size: u64 = 0;
                let mut file_count: usize = 0;

                for entry_result in archive.entries().map_err(|e| e.to_string())? {
                    let mut entry = entry_result.map_err(|e| e.to_string())?;
                    file_count += 1;

                    if file_count > MAX_ARCHIVE_FILE_COUNT {
                        return Err(format!(
                            "Archive contains too many files. Limit is {MAX_ARCHIVE_FILE_COUNT}."
                        ));
                    }

                    // Strict Security Filtering for Tar
                    let path = entry.path().map_err(|e| e.to_string())?.into_owned();
                    if path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                        return Err(format!("Security Violation: Invalid path {}", path.display()));
                    }

                    // Skip common single root folders (heuristic: skip first component if it's the same for all, though harder in streaming tar. Just dump flat or let next step handle it.)
                    // For simplicity in .tar.gz, we just extract it inside the epath.
                    let outpath = epath.join(&path);

                    if entry.header().entry_type().is_dir() {
                        fs::create_dir_all(&outpath).ok();
                        continue;
                    }

                    if let Some(p) = outpath.parent() {
                        fs::create_dir_all(p).ok();
                    }

                    let size = entry.header().size().unwrap_or(0);
                    if size > MAX_ARCHIVE_SINGLE_FILE_SIZE {
                        return Err(format!("Security Violation: File {} size exceeds limit", path.display()));
                    }

                    current_total_size += size;
                    if current_total_size > MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE {
                        return Err(format!(
                            "Extraction aborted: Total size exceeds limit ({}MB)",
                            MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE / (1024 * 1024)
                        ));
                    }

                    entry.unpack(&outpath).map_err(|e| format!("Unpack error for {}: {e}", path.display()))?;
                }
            } else {
                tracing::info!("Extracting .zip archive for {}", mid);
                let mut archive = ZipArchive::new(archive_file).map_err(|e| format!("Invalid archive: {e}"))?;

                let total_files = archive.len();

                let mut current_total_size: u64 = 0;
                let mut seen_files = std::collections::HashSet::new();

                if total_files > MAX_ARCHIVE_FILE_COUNT {
                    return Err(format!(
                        "Archive contains too many files ({total_files}). Limit is {MAX_ARCHIVE_FILE_COUNT}."
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

                        let u_size = file.size();
                        let c_size = file.compressed_size();

                        if u_size > MAX_ARCHIVE_SINGLE_FILE_SIZE {
                            return Err(format!(
                                "Security Violation: Single file size exceeds limit ({}MB): {raw_name}",
                                MAX_ARCHIVE_SINGLE_FILE_SIZE / (1024 * 1024)
                            ));
                        }

                        if c_size > 0 {
                            #[allow(clippy::cast_precision_loss)]
                            let ratio = (u_size as f64) / (c_size as f64);
                            if ratio > 1000.0 {
                                return Err(format!(
                                    "Security Violation: Anomalous compression ratio ({ratio}x) detected for {raw_name}"
                                ));
                            }
                        }

                        current_total_size += u_size;
                        if current_total_size > MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE {
                            return Err(format!(
                                "Extraction aborted: Total uncompressed size exceeds limit ({}MB)",
                                MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE / (1024 * 1024)
                            ));
                        }

                        let mut outfile = fs::File::create(&outpath)
                            .map_err(|e| format!("Failed to create file {}: {e}", outpath.display()))?;
                        copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                    }

                    if i % 10 == 0 {
                        #[allow(clippy::cast_precision_loss)]
                        let progress = i as f32 / total_files as f32;
                        emit_progress(ProgressEvent {
                            app: &app_handle,
                            module_id: &mid,
                            status: "extracting",
                            message: "Extracting...",
                            progress,
                            downloaded: progress_snapshot.map_or(0, |snapshot| snapshot.downloaded),
                            total: progress_snapshot.map_or(0, |snapshot| snapshot.total),
                            speed: 0,
                        });
                    }
                }
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
        })
    }

    fn finalize(
        module_id: &str,
        extraction_path: &Path,
        expected_hash: Option<&String>,
        release_tag: Option<&str>,
    ) -> Result<(), AppError> {
        let final_path = MODULES_DIR.join(module_id);

        let manifest = serde_json::json!({
            "module_id": module_id,
            "installed_at": chrono::Local::now().to_rfc3339(),
            "archive_hash": expected_hash.cloned(),
            "status": "complete",
            "version": release_tag.unwrap_or("unknown"),
        });
        let manifest_path = extraction_path.join("metadata.json");
        if let Ok(m_file) = fs::File::create(manifest_path) {
            let _ = serde_json::to_writer_pretty(m_file, &manifest);
        }

        let backup_path = TEMP_DIR.join(format!("{module_id}_backup_{}", uuid::Uuid::new_v4()));

        if final_path.exists() {
            fs::rename(&final_path, &backup_path).map_err(|e| {
                AppError::Io(format!("Failed to move old module version to backup: {e}"))
            })?;
        }

        if let Err(e) = fs::rename(extraction_path, &final_path) {
            if backup_path.exists() {
                let _ = fs::rename(&backup_path, &final_path);
            }

            return Err(AppError::Io(format!(
                "Atomic install failed during move: {e}"
            )));
        }

        if backup_path.exists() {
            fs::remove_dir_all(&backup_path)
                .map_err(|e| AppError::Io(format!("Failed to remove old module backup: {e}")))?;
        }

        Ok(())
    }
}

fn build_temp_archive_path(module_id: &str, asset_index: usize, asset_name: &str) -> PathBuf {
    let safe_name: String = asset_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    TEMP_DIR.join(format!("{module_id}_{asset_index}_{safe_name}"))
}

/// Downloads and extracts a module from a remote repository
pub async fn download_module(
    app: AppHandle,
    downloader: &DownloaderService,
    module_id: String,
    repo_url: String,
    expected_hash: Option<String>,
    dl_type: Option<String>,
) -> Result<(), AppError> {
    validate_module_id(&module_id)?;

    let cancel_token = downloader.request_token(&module_id);
    let mut temp_archives: Vec<PathBuf> = Vec::new();
    let mut staging_path: Option<PathBuf> = None;
    let mut final_progress_snapshot = ProgressSnapshot::default();

    // Orchestrate components
    let result = async {
        emit_progress(ProgressEvent {
            app: &app,
            module_id: &module_id,
            status: "connecting",
            message: "Connecting...",
            progress: 0.0,
            downloaded: 0,
            total: 0,
            speed: 0,
        });

        let client = NetworkClient::build_client(&module_id)?;
        let extraction_path = ArchiveExtractor::prepare_staging(&module_id)?;
        staging_path = Some(extraction_path.clone());
        let mut completed_downloaded_bytes: u64 = 0;
        let mut latest_progress_snapshot = ProgressSnapshot::default();

        let (release_tag, assets_to_download): (Option<String>, Vec<ReleaseDownloadAsset>) =
            if dl_type.as_deref() == Some("release") {
                let bundle = crate::domain::modules::github_releases::fetch_release_bundle(
                    &client, &repo_url, &module_id,
                )
                .await?;

                let assets = bundle
                    .assets
                    .into_iter()
                    .map(|asset| (asset.name, asset.download_url, None, Some(asset.size)))
                    .collect();

                (Some(bundle.tag_name), assets)
            } else {
                let final_url = UrlResolver::resolve(&client, &repo_url).await?;
                let fallback_name = Path::new(&final_url)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .filter(|name| !name.is_empty())
                    .unwrap_or("archive.zip")
                    .to_string();

                (
                    None,
                    vec![(fallback_name, final_url, expected_hash.clone(), None)],
                )
            };

        let aggregate_total_bytes = assets_to_download.iter().try_fold(0_u64, |acc, asset| {
            asset.3.and_then(|size| acc.checked_add(size))
        });

        for (asset_index, (asset_name, asset_url, asset_hash, _asset_size)) in
            assets_to_download.iter().enumerate()
        {
            let archive_path = build_temp_archive_path(&module_id, asset_index, asset_name);
            temp_archives.push(archive_path.clone());

            let download_result = NetworkClient::download_file(
                DownloadTask {
                    app: &app,
                    downloader,
                    client: &client,
                    url: asset_url,
                    dest_path: &archive_path,
                    module_id: &module_id,
                    cancel_token: &cancel_token,
                },
                aggregate_total_bytes.map(|total_bytes| AggregateDownloadContext {
                    completed_bytes_before: completed_downloaded_bytes,
                    total_bytes,
                }),
            )
            .await?;

            completed_downloaded_bytes =
                completed_downloaded_bytes.saturating_add(download_result.asset_downloaded);
            latest_progress_snapshot = download_result.snapshot;

            FileVerifier::verify(
                &app,
                &archive_path,
                asset_hash.clone(),
                &module_id,
                Some(latest_progress_snapshot),
            )
            .await?;
            ArchiveExtractor::extract_into(
                &app,
                &archive_path,
                &module_id,
                &extraction_path,
                Some(latest_progress_snapshot),
            )
            .await?;
        }

        final_progress_snapshot = latest_progress_snapshot;

        ArchiveExtractor::finalize(
            &module_id,
            &extraction_path,
            expected_hash.as_ref(),
            release_tag.as_deref(),
        )?;

        Ok::<(), AppError>(())
    }
    .await;

    // Always cleanup token
    downloader.remove_token(&module_id);

    for archive_path in &temp_archives {
        if archive_path.exists() {
            let _ = tokio::fs::remove_file(archive_path).await;
        }
    }

    if result.is_err()
        && let Some(path) = &staging_path
        && path.exists()
    {
        let _ = tokio::fs::remove_dir_all(path).await;
    }

    if let Err(e) = result {
        let status = if e.to_string().contains("cancelled") {
            "cancelled"
        } else {
            "error"
        };
        emit_progress(ProgressEvent {
            app: &app,
            module_id: &module_id,
            status,
            message: &e.to_string(),
            progress: 0.0,
            downloaded: final_progress_snapshot.downloaded,
            total: final_progress_snapshot.total,
            speed: 0,
        });
        return Err(e);
    }

    emit_progress(ProgressEvent {
        app: &app,
        module_id: &module_id,
        status: "complete",
        message: "Success",
        progress: 1.0,
        downloaded: final_progress_snapshot.downloaded,
        total: final_progress_snapshot.total,
        speed: 0,
    });

    crate::infrastructure::logging::logger::add_log(
        &format!("Module {module_id} installed successfully (Atomic)"),
        "Downloader",
        "info",
    );

    Ok(())
}

fn emit_progress(event: ProgressEvent<'_>) {
    let _ = event.app.emit(
        "download_progress",
        DownloadProgress {
            module_id: event.module_id.to_string(),
            status: event.status.to_string(),
            progress: event.progress,
            message: event.message.to_string(),
            downloaded: event.downloaded,
            total: event.total,
            speed: event.speed,
        },
    );
}

/// Checks if a module is installed (wrapper)
pub fn check_module_installed(module_id: &str) -> bool {
    is_module_installed(module_id)
}
