use crate::errors::AppError;
use crate::utils::paths::{LEGACY_MODULES_DIR, MODULES_DIR, TEMP_DIR};
use chrono;
use futures_util::StreamExt;
use sevenz_rust2::{ArchiveReader, Password};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufWriter, copy};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;
use zip::result::ZipError;

const MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE: u64 = 3 * 1024 * 1024 * 1024; // 3GB per archive
const MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE_LARGE_MODULE: u64 = 12 * 1024 * 1024 * 1024; // 12GB for portable runtimes like ComfyUI
const MAX_ARCHIVE_FILE_COUNT: usize = 10000;
const MAX_ARCHIVE_FILE_COUNT_LARGE_MODULE: usize = 100_000;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TarEntryAction {
    CopyFile,
    CreateDirectory,
    SkipMetadata,
}

fn normalize_archive_relative_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => normalized.push(part),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(format!(
                    "Security Violation: Invalid path {}",
                    path.display()
                ));
            }
        }
    }

    Ok(normalized)
}

fn classify_tar_entry_type(
    entry_type: tar::EntryType,
    path: &Path,
) -> Result<TarEntryAction, String> {
    if entry_type.is_dir() {
        return Ok(TarEntryAction::CreateDirectory);
    }

    if entry_type.is_file() || entry_type.is_contiguous() {
        return Ok(TarEntryAction::CopyFile);
    }

    if entry_type.is_gnu_longname()
        || entry_type.is_gnu_longlink()
        || entry_type.is_pax_global_extensions()
        || entry_type.is_pax_local_extensions()
    {
        return Ok(TarEntryAction::SkipMetadata);
    }

    Err(format!(
        "Security Violation: Unsupported tar entry type for {}",
        path.display()
    ))
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

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
struct PartialDownloadMetadata {
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
    total_bytes: Option<u64>,
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
        fs::create_dir_all(&*TEMP_DIR).map_err(|e| AppError::Io(e.to_string()))?;

        let resume_metadata = load_partial_metadata(task.dest_path)
            .await
            .filter(|metadata| metadata.url == task.url);
        let existing_bytes = tokio::fs::metadata(task.dest_path)
            .await
            .ok()
            .filter(std::fs::Metadata::is_file)
            .map_or(0, |metadata| metadata.len());

        let mut request = task.client.get(task.url);
        if existing_bytes > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing_bytes}-"));
            if let Some(validator) = resume_metadata.as_ref().and_then(if_range_validator) {
                request = request.header(reqwest::header::IF_RANGE, validator);
            }
        }

        let mut response = request.send().await.map_err(|e| AppError::External {
            request_id: None,
            message: format!("Failed to connect: {e}"),
        })?;

        if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing_bytes > 0 {
            if parse_content_range_total(response.headers())
                .is_some_and(|total| total == existing_bytes)
            {
                let snapshot =
                    build_progress_snapshot(existing_bytes, existing_bytes, aggregate_context);
                emit_progress(ProgressEvent {
                    app: task.app,
                    module_id: task.module_id,
                    status: "downloading",
                    message: "Downloading...",
                    progress: compute_progress(snapshot),
                    downloaded: snapshot.downloaded,
                    total: snapshot.total,
                    speed: 0,
                });

                return Ok(DownloadResult {
                    asset_downloaded: existing_bytes,
                    snapshot,
                });
            }

            remove_partial_metadata(task.dest_path).await;
            response = task
                .client
                .get(task.url)
                .send()
                .await
                .map_err(|e| AppError::External {
                    request_id: None,
                    message: format!("Failed to connect: {e}"),
                })?;
        }

        if !response.status().is_success() {
            return Err(AppError::External {
                request_id: None,
                message: format!("Download failed: {}", response.status()),
            });
        }

        let resumed =
            response.status() == reqwest::StatusCode::PARTIAL_CONTENT && existing_bytes > 0;
        let total_size = if resumed {
            parse_content_range_total(response.headers()).unwrap_or_else(|| {
                existing_bytes.saturating_add(response.content_length().unwrap_or(0))
            })
        } else {
            response.content_length().unwrap_or(0)
        };
        let response_metadata = PartialDownloadMetadata {
            url: task.url.to_string(),
            etag: extract_strong_etag(response.headers()),
            last_modified: extract_last_modified(response.headers()),
            total_bytes: if total_size > 0 {
                Some(total_size)
            } else {
                None
            },
        };
        store_partial_metadata(task.dest_path, &response_metadata).await?;
        let mut bytes_downloaded: u64 = if resumed { existing_bytes } else { 0 };
        let mut stream = response.bytes_stream();
        let mut window_bytes: u64 = 0;
        let mut file = if resumed {
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(task.dest_path)
                .await?
        } else {
            tokio::fs::File::create(task.dest_path).await?
        };

        let mut last_log_time = std::time::Instant::now();
        let mut last_speed_bytes_per_sec: u64 = 0;

        if resumed {
            let snapshot = build_progress_snapshot(bytes_downloaded, total_size, aggregate_context);
            emit_progress(ProgressEvent {
                app: task.app,
                module_id: task.module_id,
                status: "downloading",
                message: "Downloading...",
                progress: compute_progress(snapshot),
                downloaded: snapshot.downloaded,
                total: snapshot.total,
                speed: 0,
            });
        }

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

        file.flush()
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;

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

fn parse_content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let header_value = headers.get(reqwest::header::CONTENT_RANGE)?;
    let content_range = header_value.to_str().ok()?.trim();
    let total = content_range.rsplit('/').next()?.trim();
    if total == "*" {
        return None;
    }

    total.parse::<u64>().ok()
}

fn partial_metadata_path(dest_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.resume.json", dest_path.to_string_lossy()))
}

async fn load_partial_metadata(dest_path: &Path) -> Option<PartialDownloadMetadata> {
    let metadata_path = partial_metadata_path(dest_path);
    let raw = tokio::fs::read_to_string(metadata_path).await.ok()?;
    serde_json::from_str(&raw).ok()
}

async fn store_partial_metadata(
    dest_path: &Path,
    metadata: &PartialDownloadMetadata,
) -> Result<(), AppError> {
    let serialized = serde_json::to_vec_pretty(metadata).map_err(|e| {
        AppError::Serialization(format!(
            "Failed to serialize partial download metadata: {e}"
        ))
    })?;
    tokio::fs::write(partial_metadata_path(dest_path), serialized)
        .await
        .map_err(|e| AppError::Io(e.to_string()))
}

async fn remove_partial_metadata(dest_path: &Path) {
    let metadata_path = partial_metadata_path(dest_path);
    if tokio::fs::try_exists(&metadata_path).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(metadata_path).await;
    }
}

fn extract_strong_etag(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let raw = headers.get(reqwest::header::ETAG)?.to_str().ok()?.trim();
    if raw.starts_with("W/") || raw.is_empty() {
        return None;
    }

    Some(raw.to_string())
}

fn extract_last_modified(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn if_range_validator(metadata: &PartialDownloadMetadata) -> Option<&str> {
    metadata
        .etag
        .as_deref()
        .or(metadata.last_modified.as_deref())
}

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
fn compute_progress(snapshot: ProgressSnapshot) -> f32 {
    if snapshot.total > 0 {
        (snapshot.downloaded as f64 / snapshot.total as f64) as f32
    } else {
        -1.0
    }
}

fn format_archive_extraction_error(message: &str) -> String {
    if message.contains("Kind(OutOfMemory)") || message.contains("MaxMemLimited") {
        return "Not enough RAM to extract this archive with the current decoder".to_string();
    }

    message.to_string()
}

fn shared_archive_root<I>(entry_names: I) -> Option<String>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    let mut first_root: Option<String> = None;
    let mut saw_nested_entry = false;

    for name in entry_names {
        let parts: Vec<&str> = name
            .as_ref()
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        if parts.len() < 2 {
            continue;
        }

        saw_nested_entry = true;
        let root = parts.first()?.to_string();

        match &first_root {
            None => first_root = Some(root),
            Some(existing_root) if *existing_root == root => {}
            Some(_) => return None,
        }
    }

    if saw_nested_entry { first_root } else { None }
}

fn strip_archive_root(path: &Path, root_to_skip: Option<&str>) -> PathBuf {
    let Some(root) = root_to_skip else {
        return path.to_path_buf();
    };

    let mut components = path.components();
    let Some(std::path::Component::Normal(first)) = components.next() else {
        return path.to_path_buf();
    };

    if first.to_string_lossy() != root {
        return path.to_path_buf();
    }

    components.as_path().to_path_buf()
}

fn archive_file_count_limit(module_id: &str) -> usize {
    if module_id == "comfyui" {
        return MAX_ARCHIVE_FILE_COUNT_LARGE_MODULE;
    }

    MAX_ARCHIVE_FILE_COUNT
}

fn archive_total_uncompressed_size_limit(module_id: &str) -> u64 {
    if module_id == "comfyui" {
        return MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE_LARGE_MODULE;
    }

    MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE
}

fn combine_progress_phases(base: f32, span: f32, progress: f32) -> f32 {
    if progress.is_sign_negative() {
        return -1.0;
    }

    span.mul_add(progress, base).clamp(0.0, 1.0)
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
                progress: 0.0,
                downloaded: progress_snapshot.map_or(0, |snapshot| snapshot.downloaded),
                total: progress_snapshot.map_or(0, |snapshot| snapshot.total),
                speed: 0,
            });

            let path_clone = file_path.to_path_buf();
            let app_handle = app.clone();
            let verify_module_id = module_id.to_string();
            let snapshot = progress_snapshot;
            let computed_hash = tokio::task::spawn_blocking(move || {
                use sha2::{Digest, Sha256};
                use std::io::Read;

                let mut file = std::fs::File::open(&path_clone).map_err(|e| e.to_string())?;
                let total_size = file.metadata().map_err(|e| e.to_string())?.len();
                let mut hasher = Sha256::new();
                let mut buffer = vec![0_u8; 1024 * 1024];
                let mut verified_bytes = 0_u64;
                let mut window_bytes = 0_u64;
                let mut last_emit = std::time::Instant::now();

                loop {
                    let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
                    if count == 0 {
                        break;
                    }
                    verified_bytes = verified_bytes.saturating_add(count as u64);
                    window_bytes = window_bytes.saturating_add(count as u64);
                    if let Some(slice) = buffer.get(..count) {
                        hasher.update(slice);
                    }

                    if total_size > 0 && last_emit.elapsed().as_millis() >= 120 {
                        emit_progress(ProgressEvent {
                            app: &app_handle,
                            module_id: &verify_module_id,
                            status: "verifying",
                            message: "Verifying Integrity...",
                            progress: compute_progress(ProgressSnapshot {
                                downloaded: verified_bytes,
                                total: total_size,
                            }),
                            downloaded: snapshot.map_or(0, |progress| progress.downloaded),
                            total: snapshot.map_or(0, |progress| progress.total),
                            speed: calculate_speed(window_bytes, last_emit.elapsed().as_secs_f64()),
                        });
                        last_emit = std::time::Instant::now();
                        window_bytes = 0;
                    }
                }

                emit_progress(ProgressEvent {
                    app: &app_handle,
                    module_id: &verify_module_id,
                    status: "verifying",
                    message: "Verifying Integrity...",
                    progress: 1.0,
                    downloaded: snapshot.map_or(0, |progress| progress.downloaded),
                    total: snapshot.map_or(0, |progress| progress.total),
                    speed: 0,
                });
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
        let max_archive_file_count = archive_file_count_limit(module_id);
        let max_archive_total_uncompressed_size = archive_total_uncompressed_size_limit(module_id);

        let is_tar_gz = archive_path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| {
                name.ends_with(".tar.gz")
                    || std::path::Path::new(name)
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("tgz"))
            });
        let is_seven_zip = archive_path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("7z"));

        // 2. Heavy Extraction
        tokio::task::spawn_blocking(move || {
            if is_tar_gz {
                let archive_file = fs::File::open(&apath).map_err(|e| e.to_string())?;
                tracing::info!("Extracting .tar.gz archive for {}", mid);
                let tar = flate2::read::GzDecoder::new(archive_file);
                let mut archive = tar::Archive::new(tar);

                let mut current_total_size: u64 = 0;
                let mut file_count: usize = 0;
                let mut seen_entries = HashSet::new();

                for entry_result in archive.entries().map_err(|e| e.to_string())? {
                    let mut entry = entry_result.map_err(|e| e.to_string())?;
                    file_count += 1;

                    if file_count > max_archive_file_count {
                        return Err(format!(
                            "Archive contains too many files. Limit is {max_archive_file_count}."
                        ));
                    }

                    let raw_path = entry.path().map_err(|e| e.to_string())?.into_owned();
                    let path = normalize_archive_relative_path(&raw_path)?;
                    let entry_type = entry.header().entry_type();
                    let action = classify_tar_entry_type(entry_type, &path)?;

                    if action == TarEntryAction::SkipMetadata || path.as_os_str().is_empty() {
                        continue;
                    }

                    if !seen_entries.insert(path.clone()) {
                        return Err(format!(
                            "Security Violation: Duplicate entry in archive: {}",
                            path.display()
                        ));
                    }

                    let outpath = epath.join(&path);
                    if outpath == epath {
                        continue;
                    }

                    if action == TarEntryAction::CreateDirectory {
                        fs::create_dir_all(&outpath).map_err(|e| {
                            format!("Failed to create directory {}: {e}", outpath.display())
                        })?;
                        continue;
                    }

                    if let Some(parent) = outpath.parent() {
                        fs::create_dir_all(parent).map_err(|e| {
                            format!("Failed to create directory {}: {e}", parent.display())
                        })?;
                    }

                    let size = entry.header().size().unwrap_or(0);
                    if size > MAX_ARCHIVE_SINGLE_FILE_SIZE {
                        return Err(format!(
                            "Security Violation: File {} size exceeds limit",
                            path.display()
                        ));
                    }

                    current_total_size += size;
                    if current_total_size > max_archive_total_uncompressed_size {
                        return Err(format!(
                            "Extraction aborted: Total size exceeds limit ({}MB)",
                            max_archive_total_uncompressed_size / (1024 * 1024)
                        ));
                    }

                    let mut outfile = fs::File::create(&outpath)
                        .map_err(|e| format!("Failed to create file {}: {e}", outpath.display()))?;
                    let copied = copy(&mut entry, &mut outfile)
                        .map_err(|e| format!("Failed to extract {}: {e}", path.display()))?;
                    if copied != size {
                        return Err(format!(
                            "Extraction aborted: Unexpected size for {} (expected {size}, got {copied})",
                            path.display()
                        ));
                    }
                }
            } else if is_seven_zip {
                tracing::info!("Extracting .7z archive for {}", mid);
                let mut archive =
                    ArchiveReader::open(&apath, Password::empty()).map_err(|e| e.to_string())?;
                archive.set_thread_count(1);
                let total_files = archive.archive().files.len();

                if total_files > max_archive_file_count {
                    return Err(format!(
                        "Archive contains too many files ({total_files}). Limit is {max_archive_file_count}."
                    ));
                }

                tracing::info!("Scanning .7z archive metadata for {}", mid);
                let mut total_uncompressed_size = 0_u64;
                let mut last_scan_emit = std::time::Instant::now();
                for (entry_index, entry) in archive.archive().files.iter().enumerate() {
                    if entry.size() > MAX_ARCHIVE_SINGLE_FILE_SIZE {
                        return Err(format!(
                            "Security Violation: Single file size exceeds limit ({}MB): {}",
                            MAX_ARCHIVE_SINGLE_FILE_SIZE / (1024 * 1024),
                            entry.name()
                        ));
                    }

                    if entry.has_stream() {
                        total_uncompressed_size = total_uncompressed_size
                            .checked_add(entry.size())
                            .ok_or_else(|| {
                                format!(
                                    "Extraction aborted: Total size overflow while scanning {}",
                                    entry.name()
                                )
                            })?;
                    }

                    if total_uncompressed_size > max_archive_total_uncompressed_size {
                        return Err(format!(
                            "Extraction aborted: Total uncompressed size exceeds limit ({}MB)",
                            max_archive_total_uncompressed_size / (1024 * 1024)
                        ));
                    }

                    if total_files > 0 && last_scan_emit.elapsed().as_millis() >= 120 {
                        #[allow(clippy::cast_precision_loss)]
                        let scan_progress = (entry_index + 1) as f32 / total_files as f32;
                        emit_progress(ProgressEvent {
                            app: &app_handle,
                            module_id: &mid,
                            status: "extracting",
                            message: "Preparing extraction...",
                            progress: combine_progress_phases(0.0, 0.05, scan_progress),
                            downloaded: progress_snapshot
                                .map_or(0, |snapshot| snapshot.downloaded),
                            total: progress_snapshot.map_or(0, |snapshot| snapshot.total),
                            speed: 0,
                        });
                        last_scan_emit = std::time::Instant::now();
                    }
                }

                tracing::info!(
                    "Starting .7z extraction for {} ({} files, {} MB)",
                    mid,
                    total_files,
                    total_uncompressed_size / (1024 * 1024)
                );

                let root_to_skip = shared_archive_root(
                    archive
                        .archive()
                        .files
                        .iter()
                        .map(sevenz_rust2::ArchiveEntry::name),
                );

                let mut extracted_uncompressed_size = 0_u64;
                let mut extracted_window_bytes = 0_u64;
                let mut last_emit = std::time::Instant::now();

                archive
                    .for_each_entries(|entry, reader| {
                        let normalized_path =
                            normalize_archive_relative_path(Path::new(entry.name()))
                                .map_err(std::io::Error::other)?;
                        let relative_path =
                            strip_archive_root(&normalized_path, root_to_skip.as_deref());

                        if relative_path.as_os_str().is_empty() {
                            return Ok(true);
                        }

                        let outpath = epath.join(&relative_path);
                        if outpath == epath {
                            return Ok(true);
                        }

                        if entry.is_directory() {
                            fs::create_dir_all(&outpath)?;
                            return Ok(true);
                        }

                        if let Some(parent) = outpath.parent() {
                            fs::create_dir_all(parent)?;
                        }

                        let outfile = fs::File::create(&outpath)?;
                        let mut outfile = BufWriter::with_capacity(1024 * 1024, outfile);
                        let mut buffer = vec![0_u8; 1024 * 1024];

                        loop {
                            let read_size = std::io::Read::read(reader, &mut buffer)?;
                            if read_size == 0 {
                                break;
                            }

                            use std::io::Write as _;
                            let chunk = buffer.get(..read_size).ok_or_else(|| {
                                std::io::Error::other(format!(
                                    "Invalid 7z read size {read_size} for {}",
                                    entry.name()
                                ))
                            })?;
                            outfile.write_all(chunk)?;
                            extracted_uncompressed_size =
                                extracted_uncompressed_size.saturating_add(read_size as u64);
                            extracted_window_bytes =
                                extracted_window_bytes.saturating_add(read_size as u64);

                            if last_emit.elapsed().as_millis() >= 120 {
                                let progress = compute_progress(ProgressSnapshot {
                                    downloaded: extracted_uncompressed_size,
                                    total: total_uncompressed_size,
                                });
                                emit_progress(ProgressEvent {
                                    app: &app_handle,
                                    module_id: &mid,
                                    status: "extracting",
                                    message: "Extracting...",
                                    progress: combine_progress_phases(0.05, 0.95, progress),
                                    downloaded: progress_snapshot
                                        .map_or(0, |snapshot| snapshot.downloaded),
                                    total: progress_snapshot.map_or(0, |snapshot| snapshot.total),
                                    speed: calculate_speed(
                                        extracted_window_bytes,
                                        last_emit.elapsed().as_secs_f64(),
                                    ),
                                });
                                last_emit = std::time::Instant::now();
                                extracted_window_bytes = 0;
                            }
                        }

                        use std::io::Write as _;
                        outfile.flush()?;

                        Ok(true)
                    })
                    .map_err(|e| e.to_string())?;

                emit_progress(ProgressEvent {
                    app: &app_handle,
                    module_id: &mid,
                    status: "extracting",
                    message: "Extracting...",
                    progress: 1.0,
                    downloaded: progress_snapshot.map_or(0, |snapshot| snapshot.downloaded),
                    total: progress_snapshot.map_or(0, |snapshot| snapshot.total),
                    speed: 0,
                });
            } else {
                let archive_file = fs::File::open(&apath).map_err(|e| e.to_string())?;
                tracing::info!("Extracting .zip archive for {}", mid);
                let mut archive = ZipArchive::new(archive_file).map_err(|e| format!("Invalid archive: {e}"))?;

                let total_files = archive.len();

                let mut current_total_size: u64 = 0;
                let mut seen_files = std::collections::HashSet::new();

                if total_files > max_archive_file_count {
                    return Err(format!(
                        "Archive contains too many files ({total_files}). Limit is {max_archive_file_count}."
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
                        if current_total_size > max_archive_total_uncompressed_size {
                            return Err(format!(
                                "Extraction aborted: Total uncompressed size exceeds limit ({}MB)",
                                max_archive_total_uncompressed_size / (1024 * 1024)
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
            message: format!("Extraction failed: {}", format_archive_extraction_error(&e)),
        })
    }

    fn finalize(
        module_id: &str,
        extraction_path: &Path,
        expected_hash: Option<&String>,
        release_tag: Option<&str>,
    ) -> Result<(), AppError> {
        let final_path = MODULES_DIR.join(module_id);

        if module_id == "comfyui" {
            prepare_comfyui_module_files(extraction_path, release_tag)?;
        }

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

fn prepare_comfyui_module_files(
    extraction_path: &Path,
    release_tag: Option<&str>,
) -> Result<(), AppError> {
    let scripts_dir = extraction_path.join("scripts");
    fs::create_dir_all(&scripts_dir)
        .map_err(|e| AppError::Io(format!("Failed to create ComfyUI scripts directory: {e}")))?;

    let manifest = serde_json::json!({
        "api_version": "1",
        "id": "comfyui",
        "name": "ComfyUI",
        "version": release_tag.unwrap_or("unknown"),
        "description": "Node-based image workflow engine for maximum quality and control.",
        "dependencies": [],
        "lifecycle": {
            "start": {
                "program": "powershell",
                "args": [
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    "scripts/start.ps1"
                ]
            },
            "stop": {
                "program": "powershell",
                "args": [
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    "scripts/stop.ps1"
                ]
            }
        }
    });
    let manifest_path = extraction_path.join("module.json");
    let manifest_file = fs::File::create(&manifest_path).map_err(|e| {
        AppError::Io(format!(
            "Failed to create ComfyUI module manifest at {}: {e}",
            manifest_path.display()
        ))
    })?;
    serde_json::to_writer_pretty(manifest_file, &manifest).map_err(|e| {
        AppError::Serialization(format!("Failed to serialize ComfyUI module manifest: {e}"))
    })?;

    let start_script_path = scripts_dir.join("start.ps1");
    fs::write(&start_script_path, comfyui_start_script()).map_err(|e| {
        AppError::Io(format!(
            "Failed to write ComfyUI start script at {}: {e}",
            start_script_path.display()
        ))
    })?;

    let stop_script_path = scripts_dir.join("stop.ps1");
    fs::write(&stop_script_path, comfyui_stop_script()).map_err(|e| {
        AppError::Io(format!(
            "Failed to write ComfyUI stop script at {}: {e}",
            stop_script_path.display()
        ))
    })?;

    Ok(())
}

fn comfyui_start_script() -> String {
    r"$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptRoot
$childPidPath = Join-Path $moduleRoot 'comfyui.pid'
$stdoutLog = Join-Path $moduleRoot 'comfyui.stdout.log'
$stderrLog = Join-Path $moduleRoot 'comfyui.stderr.log'

function Resolve-ComfyPortable {
    param([string]$rootPath)

    $pythonExe = Get-ChildItem -Path $rootPath -Recurse -File -Filter 'python.exe' |
        Where-Object { $_.FullName -match '[\\/]python_embeded[\\/]python\.exe$' } |
        Select-Object -First 1
    if ($null -eq $pythonExe) {
        throw 'ComfyUI portable python runtime not found.'
    }

    $portableRoot = Split-Path (Split-Path $pythonExe.FullName -Parent) -Parent
    $mainPy = Get-ChildItem -Path $portableRoot -Recurse -File -Filter 'main.py' |
        Where-Object { $_.FullName -match '[\\/]ComfyUI[\\/]main\.py$' } |
        Select-Object -First 1
    if ($null -eq $mainPy) {
        throw 'ComfyUI main.py not found.'
    }

    return [PSCustomObject]@{
        PortableRoot = $portableRoot
        PythonExe = $pythonExe.FullName
        MainPy = $mainPy.FullName
    }
}

if (Test-Path -LiteralPath $childPidPath) {
    $existingPidText = Get-Content -LiteralPath $childPidPath -Raw -ErrorAction SilentlyContinue
    if ($null -ne $existingPidText -and $existingPidText.Trim() -ne '') {
        try {
            $existingPid = [int]$existingPidText.Trim()
            $existingProcess = Get-Process -Id $existingPid -ErrorAction Stop
            Write-Host ('ComfyUI already running on http://127.0.0.1:8188 (PID {0})' -f $existingProcess.Id)
            Wait-Process -Id $existingPid
            exit 0
        } catch {
            Remove-Item -LiteralPath $childPidPath -Force -ErrorAction SilentlyContinue
        }
    }
}

$portable = Resolve-ComfyPortable -rootPath $moduleRoot
$arguments = @(
    '-s',
    $portable.MainPy,
    '--listen',
    '127.0.0.1',
    '--port',
    '8188',
    '--disable-auto-launch'
)

Write-Host 'Starting ComfyUI on http://127.0.0.1:8188'
$process = Start-Process `
    -FilePath $portable.PythonExe `
    -ArgumentList $arguments `
    -WorkingDirectory $portable.PortableRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru `
    -WindowStyle Hidden

Set-Content -LiteralPath $childPidPath -Value $process.Id -Encoding ascii -NoNewline

try {
    $process.WaitForExit()
    exit $process.ExitCode
} finally {
    Remove-Item -LiteralPath $childPidPath -Force -ErrorAction SilentlyContinue
}
"
    .to_string()
}

fn comfyui_stop_script() -> String {
    r"$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptRoot
$childPidPath = Join-Path $moduleRoot 'comfyui.pid'

if (!(Test-Path -LiteralPath $childPidPath)) {
    exit 0
}

$pidText = Get-Content -LiteralPath $childPidPath -Raw -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $childPidPath -Force -ErrorAction SilentlyContinue

if ($null -eq $pidText -or $pidText.Trim() -eq '') {
    exit 0
}

$childPid = [int]$pidText.Trim()

try {
    $process = Get-Process -Id $childPid -ErrorAction Stop
    Stop-Process -Id $childPid -Force -ErrorAction Stop
    $process.WaitForExit(5000) | Out-Null
} catch [System.ArgumentException] {
    exit 0
}
"
    .to_string()
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
                    .map(|asset| {
                        (
                            asset.name,
                            asset.download_url,
                            Some(asset.sha256),
                            Some(asset.size),
                        )
                    })
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

    let cleanup_archives = match &result {
        Ok(()) => true,
        Err(error) => error.to_string().contains("Integrity check failed"),
    };
    if cleanup_archives {
        for archive_path in &temp_archives {
            if archive_path.exists() {
                let _ = tokio::fs::remove_file(archive_path).await;
            }
            remove_partial_metadata(archive_path).await;
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

    for archive_path in &temp_archives {
        remove_partial_metadata(archive_path).await;
    }

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

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::{
        PartialDownloadMetadata, TarEntryAction, classify_tar_entry_type, if_range_validator,
        normalize_archive_relative_path, parse_content_range_total,
    };
    use sevenz_rust2::{ArchiveReader, Password};
    use std::path::{Path, PathBuf};

    #[test]
    fn normalize_archive_relative_path_rejects_traversal() {
        let error = normalize_archive_relative_path(Path::new("../escape/file.txt"))
            .expect_err("parent traversal must be rejected");

        assert!(error.contains("Security Violation"));
    }

    #[test]
    fn normalize_archive_relative_path_strips_current_dir_components() {
        let normalized = normalize_archive_relative_path(Path::new("./nested/./file.txt"))
            .expect("relative path should normalize");

        assert_eq!(normalized, PathBuf::from("nested").join("file.txt"));
    }

    #[test]
    fn classify_tar_entry_type_allows_regular_entries_and_skips_metadata() {
        assert_eq!(
            classify_tar_entry_type(tar::EntryType::file(), Path::new("file.txt"))
                .expect("regular file should be allowed"),
            TarEntryAction::CopyFile
        );
        assert_eq!(
            classify_tar_entry_type(tar::EntryType::dir(), Path::new("dir"))
                .expect("directory should be allowed"),
            TarEntryAction::CreateDirectory
        );
        assert_eq!(
            classify_tar_entry_type(tar::EntryType::new(b'x'), Path::new("pax"))
                .expect("pax metadata should be skipped"),
            TarEntryAction::SkipMetadata
        );
    }

    #[test]
    fn classify_tar_entry_type_rejects_link_like_entries() {
        for entry_type in [
            tar::EntryType::hard_link(),
            tar::EntryType::symlink(),
            tar::EntryType::character_special(),
            tar::EntryType::block_special(),
            tar::EntryType::fifo(),
            tar::EntryType::new(b'S'),
        ] {
            let error = classify_tar_entry_type(entry_type, Path::new("bad"))
                .expect_err("unsafe tar entry must be rejected");
            assert!(error.contains("Unsupported tar entry type"));
        }
    }

    #[test]
    fn parses_content_range_total_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_RANGE,
            reqwest::header::HeaderValue::from_static("bytes 100-199/1024"),
        );

        assert_eq!(parse_content_range_total(&headers), Some(1024));
    }

    #[test]
    fn prefers_etag_for_if_range_validator() {
        let metadata = PartialDownloadMetadata {
            url: "https://example.com/file.7z".to_string(),
            etag: Some("\"etag-value\"".to_string()),
            last_modified: Some("Wed, 21 Oct 2015 07:28:00 GMT".to_string()),
            total_bytes: Some(1024),
        };

        assert_eq!(if_range_validator(&metadata), Some("\"etag-value\""));
    }

    #[test]
    #[ignore]
    fn debug_extract_local_comfyui_archive() {
        let archive_path = std::env::var("AXELATE_DEBUG_7Z").expect("AXELATE_DEBUG_7Z missing");
        let mut archive =
            ArchiveReader::open(&archive_path, Password::empty()).expect("open archive");
        archive.set_thread_count(1);

        let mut entries = 0usize;
        archive
            .for_each_entries(|_, reader| {
                let mut sink = std::io::sink();
                std::io::copy(reader, &mut sink).expect("copy entry");
                entries += 1;
                Ok(true)
            })
            .expect("extract entries");

        assert!(entries > 0);
    }
}
