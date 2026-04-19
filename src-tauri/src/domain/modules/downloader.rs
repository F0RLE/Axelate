use super::downloader_comfyui::build_temp_archive_path;
use super::downloader_install::{ArchiveExtractor, FileVerifier};
use super::downloader_progress::{
    AggregateDownloadContext, ProgressEvent, ProgressSnapshot, emit_progress,
};
use super::downloader_service::resolve_existing_module_path;
use super::downloader_support::remove_partial_metadata;
use super::downloader_transfer::{
    DownloadTask, ReleaseDownloadAsset, build_client, clone_repository_into, download_file,
    resolve_download_url,
};
use crate::errors::AppError;
use crate::utils::paths::MODULES_DIR;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub use super::downloader_service::DownloaderService;

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

        let client = build_client(&module_id)?;
        let extraction_path = ArchiveExtractor::prepare_staging(&module_id)?;
        staging_path = Some(extraction_path.clone());
        let mut completed_downloaded_bytes: u64 = 0;
        let mut latest_progress_snapshot = ProgressSnapshot::default();

        let (release_tag, assets_to_download): (Option<String>, Vec<ReleaseDownloadAsset>) =
            if dl_type.as_deref() == Some("git") {
                clone_repository_into(&app, &module_id, &repo_url, &extraction_path).await?;
                (None, Vec::new())
            } else if dl_type.as_deref() == Some("release") {
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
                let final_url = resolve_download_url(&client, &repo_url).await?;
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

        if !assets_to_download.is_empty() {
            let aggregate_total_bytes = assets_to_download.iter().try_fold(0_u64, |acc, asset| {
                asset.3.and_then(|size| acc.checked_add(size))
            });

            for (asset_index, (asset_name, asset_url, asset_hash, _asset_size)) in
                assets_to_download.iter().enumerate()
            {
                let archive_path = build_temp_archive_path(&module_id, asset_index, asset_name);
                temp_archives.push(archive_path.clone());

                let download_result = download_file(
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

/// Checks if a module is installed (wrapper)
pub fn check_module_installed(module_id: &str) -> bool {
    is_module_installed(module_id)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use crate::domain::modules::downloader_support::{
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
    #[ignore = "manual local archive debug helper; requires AXELATE_DEBUG_7Z"]
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
