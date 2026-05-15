use super::downloader_progress::{
    AggregateDownloadContext, DownloadInterruption, DownloadProgressReporter, DownloadResult,
    ProgressEvent, calculate_speed, emit_progress,
};
use super::downloader_service::{DownloadControl, DownloaderService};
use super::downloader_support::{
    PartialDownloadMetadata, extract_last_modified, extract_strong_etag, if_range_validator,
    load_partial_metadata, parse_content_range_total, remove_partial_metadata,
    store_partial_metadata,
};
use crate::errors::AppError;
use crate::utils::paths::TEMP_DIR;
use futures_util::StreamExt;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub(super) type ReleaseDownloadAsset = (String, String, Option<String>, Option<u64>);

pub(super) async fn resolve_download_url(
    client: &reqwest::Client,
    download_url: &str,
) -> Result<String, AppError> {
    if is_github_repository_reference(download_url) {
        let base_url = download_url.trim_end_matches(".git").trim_end_matches('/');
        let main_url = format!("{base_url}/archive/refs/heads/main.zip");
        let master_url = format!("{base_url}/archive/refs/heads/master.zip");

        tracing::info!("Trying to download from: {main_url}");
        let response = client
            .get(&main_url)
            .send()
            .await
            .map_err(|error| AppError::External {
                request_id: None,
                message: format!("Failed to connect: {error}"),
            })?;

        if response.status().is_success() {
            return Ok(main_url);
        }

        let main_status = response.status();
        tracing::info!("main branch probe returned {main_status}, trying master: {master_url}");
        let response_master =
            client
                .get(&master_url)
                .send()
                .await
                .map_err(|error| AppError::External {
                    request_id: None,
                    message: format!("Failed to connect: {error}"),
                })?;

        if response_master.status().is_success() {
            return Ok(master_url);
        }

        let master_status = response_master.status();
        return Err(AppError::External {
            request_id: None,
            message: format!(
                "Module source probes failed at {base_url}: main.zip returned {main_status}, master.zip returned {master_status}"
            ),
        });
    }

    Ok(download_url.to_string())
}

fn is_github_repository_reference(download_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(download_url.trim()) else {
        return false;
    };
    if !matches!(url.host_str(), Some("github.com" | "www.github.com")) {
        return false;
    }

    let Some(segments) = url.path_segments() else {
        return false;
    };
    let segments = segments
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let [owner, repo] = segments.as_slice() else {
        return false;
    };

    let repo = repo.trim_end_matches(".git");
    !owner.is_empty() && !repo.is_empty()
}

pub(super) async fn clone_repository_into(
    app: &AppHandle,
    module_id: &str,
    repo_url: &str,
    extraction_path: &Path,
) -> Result<(), AppError> {
    emit_progress(ProgressEvent {
        app,
        module_id,
        status: "downloading",
        message: "Cloning repository...",
        progress: 0.15,
        downloaded: 0,
        total: 0,
        speed: 0,
    });

    let output = Command::new("git")
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg(repo_url)
        .arg(extraction_path)
        .output()
        .await
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!("Failed to launch git clone for '{module_id}': {error}"),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Unknown git clone failure".to_string()
        };

        return Err(AppError::External {
            request_id: None,
            message: format!("Failed to clone repository for '{module_id}': {details}"),
        });
    }

    emit_progress(ProgressEvent {
        app,
        module_id,
        status: "extracting",
        message: "Preparing module files...",
        progress: 0.9,
        downloaded: 0,
        total: 0,
        speed: 0,
    });

    let git_dir = extraction_path.join(".git");
    match tokio::fs::remove_dir_all(&git_dir).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(AppError::Io(format!(
                "Failed to remove git metadata directory '{}': {error}",
                git_dir.display()
            )));
        }
    }

    Ok(())
}

pub(super) fn build_client(module_id: &str) -> Result<reqwest::Client, AppError> {
    tracing::debug!(module_id = module_id, "Building module download client");
    construct_client_builder()
        .build()
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!("Client error: {error}"),
        })
}

fn construct_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .user_agent(format!("Axelate/1.0.0 (Tauri; {})", std::env::consts::OS))
        .timeout(std::time::Duration::from_mins(10))
}

pub(super) fn build_public_client() -> Result<reqwest::Client, AppError> {
    construct_client_builder()
        .build()
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!("Client error: {error}"),
        })
}

pub(super) struct DownloadTask<'a> {
    pub(super) app: &'a AppHandle,
    pub(super) downloader: &'a DownloaderService,
    pub(super) client: &'a reqwest::Client,
    pub(super) url: &'a str,
    pub(super) dest_path: &'a Path,
    pub(super) module_id: &'a str,
    pub(super) control: &'a DownloadControl,
}

pub(super) async fn download_file(
    task: DownloadTask<'_>,
    aggregate_context: Option<AggregateDownloadContext>,
) -> Result<DownloadResult, AppError> {
    let progress = DownloadProgressReporter {
        app: task.app,
        module_id: task.module_id,
        aggregate_context,
    };
    fs::create_dir_all(&*TEMP_DIR).map_err(|error| AppError::Io(error.to_string()))?;

    let loaded_resume_metadata = match load_partial_metadata(task.dest_path).await {
        Ok(metadata) => metadata,
        Err(AppError::Serialization(error)) => {
            tracing::warn!(
                module_id = task.module_id,
                path = %task.dest_path.display(),
                "Ignoring corrupt partial download metadata: {error}"
            );
            remove_partial_metadata(task.dest_path).await?;
            None
        }
        Err(error) => return Err(error),
    };
    let resume_metadata = loaded_resume_metadata.filter(|metadata| metadata.url == task.url);
    let mut existing_bytes = tokio::fs::metadata(task.dest_path)
        .await
        .ok()
        .filter(std::fs::Metadata::is_file)
        .map_or(0, |metadata| metadata.len());
    if existing_bytes > 0 && resume_metadata.is_none() {
        tracing::warn!(
            module_id = task.module_id,
            path = %task.dest_path.display(),
            "Discarding partial download without matching resume metadata"
        );
        remove_partial_metadata(task.dest_path).await?;
        if let Err(error) = tokio::fs::remove_file(task.dest_path).await
            && error.kind() != std::io::ErrorKind::NotFound
        {
            return Err(AppError::Io(format!(
                "Failed to remove stale partial download '{}': {error}",
                task.dest_path.display()
            )));
        }
        existing_bytes = 0;
    }

    let mut request = task.client.get(task.url);
    if existing_bytes > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing_bytes}-"));
        if let Some(validator) = resume_metadata.as_ref().and_then(if_range_validator) {
            request = request.header(reqwest::header::IF_RANGE, validator);
        }
    }

    let mut response = request.send().await.map_err(|error| AppError::External {
        request_id: None,
        message: format!("Failed to connect: {error}"),
    })?;

    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing_bytes > 0 {
        if parse_content_range_total(response.headers())
            .is_some_and(|total| total == existing_bytes)
        {
            let snapshot = progress.emit_download(existing_bytes, existing_bytes, 0);

            return Ok(DownloadResult {
                asset_downloaded: existing_bytes,
                snapshot,
                interruption: None,
            });
        }

        remove_partial_metadata(task.dest_path).await?;
        response = task
            .client
            .get(task.url)
            .send()
            .await
            .map_err(|error| AppError::External {
                request_id: None,
                message: format!("Failed to connect: {error}"),
            })?;
    }

    if !response.status().is_success() {
        return Err(AppError::External {
            request_id: None,
            message: format!("Download failed: {}", response.status()),
        });
    }

    let resumed = response.status() == reqwest::StatusCode::PARTIAL_CONTENT && existing_bytes > 0;
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
        total_bytes: (total_size > 0).then_some(total_size),
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
        progress.emit_download(bytes_downloaded, total_size, 0);
    }

    while let Some(item) = stream.next().await {
        if task.control.is_cancel_requested() {
            tracing::info!("Download cancelled for module: {}", task.module_id);
            let snapshot =
                progress.emit_download(bytes_downloaded, total_size, last_speed_bytes_per_sec);
            return Ok(DownloadResult {
                asset_downloaded: bytes_downloaded,
                snapshot,
                interruption: Some(DownloadInterruption::Cancelled),
            });
        }
        if task.control.is_pause_requested() {
            tracing::info!("Download paused for module: {}", task.module_id);
            let snapshot =
                progress.emit_download(bytes_downloaded, total_size, last_speed_bytes_per_sec);
            return Ok(DownloadResult {
                asset_downloaded: bytes_downloaded,
                snapshot,
                interruption: Some(DownloadInterruption::Paused),
            });
        }

        let chunk_start = std::time::Instant::now();
        let chunk = item.map_err(|error| AppError::External {
            request_id: None,
            message: format!("Stream error: {error}"),
        })?;
        let chunk_len = chunk.len();

        file.write_all(&chunk)
            .await
            .map_err(|error| AppError::Io(error.to_string()))?;
        bytes_downloaded += chunk_len as u64;
        window_bytes += chunk_len as u64;

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
            progress.emit_download(bytes_downloaded, total_size, last_speed_bytes_per_sec);
        }
    }

    let snapshot = progress.emit_download(bytes_downloaded, total_size, last_speed_bytes_per_sec);

    file.flush()
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;
    file.sync_all()
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;

    Ok(DownloadResult {
        asset_downloaded: bytes_downloaded,
        snapshot,
        interruption: None,
    })
}

#[cfg(test)]
mod tests {
    use super::is_github_repository_reference;

    #[test]
    fn github_repository_reference_accepts_repo_roots_only() {
        assert!(is_github_repository_reference(
            "https://github.com/F0RLE/Axelate-telegram-parser"
        ));
        assert!(is_github_repository_reference(
            "https://github.com/F0RLE/Axelate-telegram-parser.git"
        ));
    }

    #[test]
    fn github_repository_reference_rejects_direct_assets_and_archive_urls() {
        for url in [
            "https://github.com/F0RLE/Axelate-telegram-parser/archive/refs/heads/main.zip",
            "https://github.com/F0RLE/Axelate-telegram-parser/releases/download/v1/parser.7z",
            "https://github.com/F0RLE/Axelate-telegram-parser/releases/download/v1/parser.tar.gz",
            "https://github.com/F0RLE/Axelate-telegram-parser/raw/main/parser.zip",
            "https://example.com/F0RLE/Axelate-telegram-parser",
        ] {
            assert!(!is_github_repository_reference(url), "{url}");
        }
    }
}
