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
#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub module_id: String,
    pub status: String,
    pub progress: f32,
    pub message: String,
    pub downloaded: u64,
    pub total: u64,
}

pub fn validate_module_id(module_id: &str) -> Result<(), String> {
    if module_id.is_empty() {
        return Err("Module ID cannot be empty".to_string());
    }
    if !module_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "Module ID contains invalid characters. Only alphanumeric, '-', and '_' are allowed."
                .to_string(),
        );
    }
    if module_id.contains("..") {
        return Err("Module ID cannot contain directory traversal patterns".to_string());
    }
    Ok(())
}

pub fn is_module_installed(module_id: &str) -> bool {
    if validate_module_id(module_id).is_err() {
        return false;
    }
    let module_path = MODULES_DIR.join(module_id);
    module_path.exists() && module_path.is_dir()
}

pub fn get_module_path(module_id: &str) -> PathBuf {
    // Note: Callers should validate module_id before using this path for sensitive operations
    MODULES_DIR.join(module_id)
}

pub fn delete_module(module_id: &str) -> Result<(), String> {
    validate_module_id(module_id)?;

    let module_path = MODULES_DIR.join(module_id);
    if module_path.exists() {
        fs::remove_dir_all(&module_path).map_err(|e| format!("Failed to delete module: {}", e))?;
        crate::services::logs::add_log(
            &format!("Module {} deleted", module_id),
            "Downloader",
            "info",
        );
        Ok(())
    } else {
        Err("Module not found".to_string())
    }
}

pub async fn download_module(
    app: AppHandle,
    module_id: String,
    repo_url: String,
    expected_hash: Option<String>,
) -> Result<(), String> {
    validate_module_id(&module_id)?;

    // 1. Transform GitHub URL to ZIP URL if needed
    let download_url = repo_url.clone();

    let zip_path = TEMP_DIR.join(format!("{}.zip.tmp", module_id));

    // Execute download and extraction and ensure cleanup via the wrapper
    let result =
        download_and_extract_internal(&app, &module_id, &download_url, &zip_path, expected_hash)
            .await;

    // Guaranteed cleanup of the temp file
    if zip_path.exists() {
        let _ = tokio::fs::remove_file(&zip_path).await;
    }

    if let Err(e) = result {
        emit_progress(&app, &module_id, "error", &e, 0.0, 0, 0);
        return Err(e);
    }

    emit_progress(&app, &module_id, "complete", "Success", 1.0, 0, 0);

    crate::services::logs::add_log(
        &format!("Module {} installed via Native Downloader", module_id),
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
) -> Result<(), String> {
    emit_progress(app, module_id, "connecting", "Connecting...", 0.0, 0, 0);

    let mut client_builder = reqwest::Client::builder()
        .user_agent("FluxPlatform/1.0.0 (Tauri; Windows)")
        .timeout(std::time::Duration::from_secs(600));

    // Inject License Key if available
    if let Some(license) = crate::services::license::storage::load_license()
        && !license.key.is_empty()
    {
        log::info!("Injecting license key for module download: {}", module_id);
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(auth_val) =
            reqwest::header::HeaderValue::from_str(&format!("Bearer {}", license.key))
        {
            headers.insert(reqwest::header::AUTHORIZATION, auth_val);
        }
        if let Ok(lic_val) = reqwest::header::HeaderValue::from_str(&license.key) {
            headers.insert("X-Flux-License", lic_val);
        }
        client_builder = client_builder.default_headers(headers);
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let mut response;

    // GitHub Smart Branch Discovery (main -> master)
    if download_url.contains("github.com") && !download_url.ends_with(".zip") {
        let base_url = download_url.trim_end_matches(".git");
        let main_url = format!("{}/archive/refs/heads/main.zip", base_url);
        let master_url = format!("{}/archive/refs/heads/master.zip", base_url);

        log::info!("Trying to download from: {}", main_url);
        response = client
            .get(&main_url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            log::info!("main branch not found, trying master: {}", master_url);
            response = client
                .get(&master_url)
                .send()
                .await
                .map_err(|e| format!("Failed to connect: {}", e))?;
        }
    } else {
        response = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;
    }

    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    fs::create_dir_all(&*TEMP_DIR).map_err(|e| e.to_string())?;

    let mut file = tokio::fs::File::create(zip_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = downloaded as f32 / total_size as f32;
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
                hasher.update(&buffer[..count]);
            }
            Ok::<String, String>(hex::encode(hasher.finalize()))
        })
        .await
        .map_err(|e| e.to_string())??;

        if computed_hash.to_lowercase() != expected_hash.to_lowercase() {
            return Err(format!(
                "Integrity check failed. Expected {}, got {}",
                expected_hash, computed_hash
            ));
        }

        log::info!("Integrity verified for {}", module_id);
    }

    // 2. Extract
    emit_progress(app, module_id, "extracting", "Extracting...", 0.0, 0, 0);
    let final_path = MODULES_DIR.join(module_id);

    if final_path.exists() {
        fs::remove_dir_all(&final_path).ok();
    }
    fs::create_dir_all(&final_path).map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    let mid = module_id.to_string();
    let zpath = zip_path.to_owned();
    let fpath = final_path.to_owned();

    tokio::task::spawn_blocking(move || {
        let zip_file = fs::File::open(&zpath).map_err(|e| e.to_string())?;
        let mut archive =
            ZipArchive::new(zip_file).map_err(|e| format!("Invalid archive: {}", e))?;

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
                    None => first_dir = Some(parts[0].to_string()),
                    Some(root) => {
                        if parts[0] != root {
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
                    .map_err(|e| format!("Failed to create file {:?}: {}", outpath, e))?;
                copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }

            if i % 10 == 0 {
                emit_progress(
                    &app_handle,
                    &mid,
                    "extracting",
                    "Extracting...",
                    i as f32 / total_files as f32,
                    0,
                    0,
                );
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Blocking task failed: {}", e))??;

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

pub fn check_module_installed(module_id: String) -> bool {
    is_module_installed(&module_id)
}

pub fn list_module_files(_module_id: String) -> Result<Vec<String>, String> {
    // Basic stub or implementation
    Ok(vec![])
}
