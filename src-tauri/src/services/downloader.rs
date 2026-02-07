use crate::errors::AppError;
use crate::utils::paths::{MODULES_DIR, TEMP_DIR};
use futures_util::StreamExt;
use std::fs;
use std::io::copy;
use std::path::PathBuf;
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

/// Checks if a module is installed locally
pub fn is_module_installed(module_id: &str) -> bool {
    if validate_module_id(module_id).is_err() {
        return false;
    }
    let module_path = MODULES_DIR.join(module_id);
    module_path.exists() && module_path.is_dir()
}

/// Returns the filesystem path to a module directory
pub fn get_module_path(module_id: &str) -> PathBuf {
    // Note: Callers should validate module_id before using this path for sensitive operations
    MODULES_DIR.join(module_id)
}

/// Deletes a module from disk
pub fn delete_module(module_id: &str) -> Result<(), AppError> {
    validate_module_id(module_id)?;

    let module_path = MODULES_DIR.join(module_id);
    if module_path.exists() {
        fs::remove_dir_all(&module_path).map_err(AppError::Io)?;
        crate::services::logs::add_log(
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
    pub fn set_limit(&self, enabled: bool, max_speed_mb: u64) {
        if let Ok(mut settings) = self.settings.lock() {
            settings.limit_enabled = enabled;
            settings.max_speed_bytes = max_speed_mb * 1024 * 1024;
            log::info!("Download limit set: enabled={enabled}, speed={max_speed_mb}MB/s");
        }
    }

    /// Gets current download settings
    pub fn get_settings(&self) -> (bool, u64) {
        self.settings.lock().map_or((false, 0), |settings| {
            (settings.limit_enabled, settings.max_speed_bytes)
        })
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

    // 1. Transform GitHub URL to ZIP URL if needed
    let download_url = repo_url.clone();

    let zip_path = TEMP_DIR.join(format!("{module_id}.zip.tmp"));

    // Execute download and extraction and ensure cleanup via the wrapper
    let result =
        download_and_extract_internal(&app, &module_id, &download_url, &zip_path, expected_hash)
            .await;

    // Guaranteed cleanup of the temp file
    if zip_path.exists() {
        let _ = tokio::fs::remove_file(&zip_path).await;
    }

    if let Err(e) = result {
        emit_progress(&app, &module_id, "error", &e.to_string(), 0.0, 0, 0);
        return Err(e);
    }

    emit_progress(&app, &module_id, "complete", "Success", 1.0, 0, 0);

    crate::services::logs::add_log(
        &format!("Module {module_id} installed via Native Downloader"),
        "Downloader",
        "info",
    );

    Ok(())
}

/// Internal implementation of download and extraction to allow guaranteed cleanup in the wrapper
async fn download_and_extract_internal(
    app: &AppHandle,
    module_id: &str,
    download_url: &str,
    zip_path: &std::path::Path,
    expected_hash: Option<String>,
) -> Result<(), AppError> {
    emit_progress(app, module_id, "connecting", "Connecting...", 0.0, 0, 0);

    let mut client_builder = reqwest::Client::builder()
        .user_agent("Axelate/1.0.0 (Tauri; Windows)")
        .timeout(std::time::Duration::from_secs(600));

    // Inject License Key if available
    if let Some(license) = crate::services::license::storage::load_license()
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

    let client = client_builder
        .build()
        .map_err(|e| AppError::External(format!("Client error: {e}")))?;

    let mut response;

    // GitHub Smart Branch Discovery (main -> master)
    if download_url.contains("github.com")
        && !std::path::Path::new(download_url)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        let base_url = download_url.trim_end_matches(".git");
        let main_url = format!("{base_url}/archive/refs/heads/main.zip");
        let master_url = format!("{base_url}/archive/refs/heads/master.zip");

        log::info!("Trying to download from: {main_url}");
        response = client
            .get(&main_url)
            .send()
            .await
            .map_err(|e| AppError::External(format!("Failed to connect: {e}")))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            log::info!("main branch not found, trying master: {master_url}");
            response = client
                .get(&master_url)
                .send()
                .await
                .map_err(|e| AppError::External(format!("Failed to connect: {e}")))?;
        }
    } else {
        response = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| AppError::External(format!("Failed to connect: {e}")))?;
    }

    if !response.status().is_success() {
        return Err(AppError::External(format!(
            "Download failed: {}",
            response.status()
        )));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    fs::create_dir_all(&*TEMP_DIR)?;

    let mut file = tokio::fs::File::create(zip_path)
        .await
        .map_err(AppError::Io)?;

    let mut last_log_time = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk_start = std::time::Instant::now();
        let chunk = item.map_err(|e| AppError::External(format!("Stream error: {e}")))?;
        let chunk_len = chunk.len();

        file.write_all(&chunk).await.map_err(AppError::Io)?;
        downloaded += chunk_len as u64;

        // Rate Limiting Logic
        let (limit_enabled, max_speed_bytes) = DOWNLOADER.get_settings();
        if limit_enabled && max_speed_bytes > 0 {
            // Calculate how long this chunk *should* take
            // time_s = bytes / (bytes/s)
            // time_us = bytes * 1_000_000 / (bytes/s)
            let ideal_duration_micros =
                (chunk_len as u128 * 1_000_000) / u128::from(max_speed_bytes);
            let elapsed_micros = chunk_start.elapsed().as_micros();

            if ideal_duration_micros > elapsed_micros {
                let sleep_micros = ideal_duration_micros - elapsed_micros;
                if sleep_micros > 1000 {
                    // Only sleep if meaningful (>1ms)
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
            // UI progress calculation
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

    // Hash Verification
    if let Some(expected_hash) = expected_hash {
        if expected_hash.trim().is_empty() {
            log::warn!("Skipping integrity check for {module_id} because expected_hash is empty");
        } else {
            emit_progress(
                app,
                module_id,
                "verifying",
                "Verifying Integrity...",
                1.0,
                0,
                0,
            );

            let path_clone = zip_path.to_path_buf();
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
            .map_err(|e| AppError::Internal(e.to_string()))?
            .map_err(AppError::Internal)?;

            if computed_hash.to_lowercase() != expected_hash.to_lowercase() {
                return Err(AppError::Validation(format!(
                    "Integrity check failed. Expected {expected_hash}, got {computed_hash}"
                )));
            }

            log::info!("Integrity verified for {module_id}");
        }
    }

    // 2. Extract
    emit_progress(app, module_id, "extracting", "Extracting...", 0.0, 0, 0);
    let final_path = MODULES_DIR.join(module_id);

    if final_path.exists() {
        fs::remove_dir_all(&final_path).ok();
    }
    fs::create_dir_all(&final_path).map_err(AppError::Io)?;

    let app_handle = app.clone();
    let mid = module_id.to_string();
    let zpath = zip_path.to_owned();
    let fpath = final_path.clone();

    tokio::task::spawn_blocking(move || {
        let zip_file = fs::File::open(&zpath).map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(zip_file).map_err(|e| format!("Invalid archive: {e}"))?;

        let total_files = archive.len();

        // 2a. Determine if there is a common root folder to skip (standard for GitHub ZIPs)
        let root_to_skip = {
            let mut first_dir: Option<String> = None;
            let mut all_share_root = true;

            for i in 0..total_files {
                let file = archive.by_index(i).map_err(|e: ZipError| e.to_string())?;
                let name = file.name().to_string();
                if name == "/" || name.is_empty() {
                    continue;
                }

                let parts: Vec<&str> = name.split('/').filter(|s: &&str| !s.is_empty()).collect();
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
                .map_err(|e: zip::result::ZipError| e.to_string())?;

            let outpath = match file.enclosed_name() {
                Some(path) => {
                    if let Some(root) = &root_to_skip {
                        let mut components = path.as_path().components();
                        let first = components.next();
                        // Double check it matches the detected root
                        if let Some(std::path::Component::Normal(c)) = first {
                            if c.to_string_lossy() == *root {
                                fpath.join(components.as_path())
                            } else {
                                fpath.join(path)
                            }
                        } else {
                            fpath.join(path)
                        }
                    } else {
                        fpath.join(path)
                    }
                }
                None => continue,
            };

            if outpath == fpath {
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
                let mut outfile = fs::File::create(&outpath)
                    .map_err(|e| format!("Failed to create file {}: {e}", outpath.display()))?;
                copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }

            if i % 10 == 0 {
                #[allow(clippy::cast_precision_loss)] // Acceptable for progress percentage
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
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))?
    .map_err(|e| AppError::Internal(format!("Extraction failed: {e}")))?;

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
