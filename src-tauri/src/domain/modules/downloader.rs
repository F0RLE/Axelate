use crate::errors::AppError;
use crate::utils::paths::{MODULES_DIR, TEMP_DIR};
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
        fs::remove_dir_all(&module_path).map_err(AppError::Io)?;
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
            let base_url = download_url.trim_end_matches(".git");
            let main_url = format!("{base_url}/archive/refs/heads/main.zip");
            let master_url = format!("{base_url}/archive/refs/heads/master.zip");

            log::info!("Trying to download from: {main_url}");
            let response = client
                .get(&main_url)
                .send()
                .await
                .map_err(|e| AppError::External(format!("Failed to connect: {e}")))?;

            if response.status() == reqwest::StatusCode::NOT_FOUND {
                log::info!("main branch not found, trying master: {master_url}");
                let _ = client
                    .get(&master_url)
                    .send()
                    .await
                    .map_err(|e| AppError::External(format!("Failed to connect: {e}")))?;

                // If master also fails, we return master_url anyway?
                // Original code implicitly returned the *response* of the last attempt.
                // Here we return the URL that succeeded or the last attempted URL.
                return Ok(master_url);
            }
            return Ok(main_url);
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

        client_builder
            .build()
            .map_err(|e| AppError::External(format!("Client error: {e}")))
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
            .map_err(|e| AppError::External(format!("Failed to connect: {e}")))?;

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

        let mut file = tokio::fs::File::create(dest_path)
            .await
            .map_err(AppError::Io)?;

        let mut last_log_time = std::time::Instant::now();

        while let Some(item) = stream.next().await {
            let chunk_start = std::time::Instant::now();
            let chunk = item.map_err(|e| AppError::External(format!("Stream error: {e}")))?;
            let chunk_len = chunk.len();

            file.write_all(&chunk).await.map_err(AppError::Io)?;
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
            .map_err(|e| AppError::Internal(e.to_string()))?
            .map_err(AppError::Internal)?;

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
    async fn extract(app: &AppHandle, zip_path: &Path, module_id: &str) -> Result<(), AppError> {
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
            let mut archive =
                ZipArchive::new(zip_file).map_err(|e| format!("Invalid archive: {e}"))?;

            let total_files = archive.len();

            // Determine if there is a common root folder to skip (standard for GitHub ZIPs)
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
                    .map_err(|e: zip::result::ZipError| e.to_string())?;

                let outpath = match file.enclosed_name() {
                    Some(path) => {
                        if let Some(root) = &root_to_skip {
                            let mut components = path.as_path().components();
                            let first = components.next();
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
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))?
        .map_err(|e| AppError::Internal(format!("Extraction failed: {e}")))?;

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
        FileVerifier::verify(&app, &zip_path, expected_hash, &module_id).await?;
        ArchiveExtractor::extract(&app, &zip_path, &module_id).await?;

        Ok::<(), AppError>(())
    }
    .await;

    // Guaranteed cleanup
    if zip_path.exists() {
        let _ = tokio::fs::remove_file(&zip_path).await;
    }

    if let Err(e) = result {
        emit_progress(&app, &module_id, "error", &e.to_string(), 0.0, 0, 0);
        return Err(e);
    }

    emit_progress(&app, &module_id, "complete", "Success", 1.0, 0, 0);

    crate::infrastructure::logging::logger::add_log(
        &format!("Module {module_id} installed via Native Downloader"),
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
