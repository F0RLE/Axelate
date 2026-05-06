use super::downloader_comfyui::build_temp_archive_path;
use super::downloader_install::{ArchiveExtractor, FileVerifier};
use super::downloader_progress::{
    AggregateDownloadContext, DownloadInterruption, ProgressEvent, ProgressSnapshot,
    compute_progress, emit_progress,
};
use super::downloader_service::resolve_existing_module_path;
use super::downloader_support::{package_install_dir, remove_partial_metadata};
use super::downloader_transfer::{
    DownloadTask, ReleaseDownloadAsset, build_client, build_public_client, clone_repository_into,
    download_file, resolve_download_url,
};
use super::github_releases::ReleaseDownloadSelection;
use super::lifecycle::{ManifestLoader, ModuleManifest};
use crate::errors::AppError;
use crate::utils::paths::{INTEGRATIONS_DIR, TEMP_DIR};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const IMPORT_FILE_COUNT_LIMIT: usize = 20_000;
const IMPORT_TOTAL_SIZE_LIMIT: u64 = 3 * 1024 * 1024 * 1024;

pub use super::downloader_service::{DownloadRequest, DownloaderService};

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
    resolve_existing_module_path(module_id).unwrap_or_else(|| package_install_dir(module_id))
}

/// Checks if a module is installed locally
pub fn is_module_installed(module_id: &str) -> bool {
    if validate_module_id(module_id).is_err() {
        return false;
    }
    resolve_existing_module_path(module_id).is_some()
}

/// Lists compatible release versions and CPU/GPU package choices for a module.
pub async fn get_release_download_options(
    module_id: &str,
    repo_url: &str,
) -> Result<super::github_releases::ReleaseDownloadOptions, AppError> {
    validate_module_id(module_id)?;
    let client = build_public_client()?;
    super::github_releases::fetch_release_download_options(&client, repo_url, module_id).await
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
        crate::domain::integration_api::revoke_module_api_token(module_id);
        Ok(())
    } else {
        Err(AppError::NotFound("Module not found".to_string()))
    }
}

/// Imports an integration from an existing local folder.
pub async fn import_integration_folder(path: &Path) -> Result<String, AppError> {
    ensure_source_directory(path)?;
    let manifest = ManifestLoader::load(path)?;
    let module_id = validate_integration_manifest(&manifest)?;
    let staging_path = ArchiveExtractor::prepare_staging(&module_id)?;
    let source_path = path.to_path_buf();
    let blocking_staging_path = staging_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        copy_directory_contents_secure(&source_path, &blocking_staging_path)?;
        finalize_imported_integration(&blocking_staging_path, Some("local-folder"))
    })
    .await
    .map_err(|error| AppError::Internal {
        request_id: None,
        message: format!("Integration folder import worker failed: {error}"),
    })?;

    cleanup_staging_on_error(&result, &staging_path);
    result
}

/// Imports an integration from a local path, auto-detecting folder or archive sources.
pub async fn import_integration_path(app: AppHandle, path: PathBuf) -> Result<String, AppError> {
    let metadata = std::fs::metadata(&path).map_err(|error| {
        AppError::Io(format!(
            "Failed to read integration source '{}': {error}",
            path.display()
        ))
    })?;

    if metadata.is_dir() {
        return import_integration_folder(&path).await;
    }

    if metadata.is_file() {
        return import_integration_archive(app, path).await;
    }

    Err(AppError::Validation(
        "Selected integration source must be a folder or archive file".to_string(),
    ))
}

/// Imports an integration from a local archive file.
pub async fn import_integration_archive(app: AppHandle, path: PathBuf) -> Result<String, AppError> {
    ensure_source_file(&path)?;
    let import_id = build_import_id();
    let staging_path = ArchiveExtractor::prepare_staging(&import_id)?;

    let result = async {
        ArchiveExtractor::extract_into(&app, &path, &import_id, &staging_path, None).await?;
        finalize_imported_integration(&staging_path, Some("local-archive"))
    }
    .await;

    cleanup_staging_on_error(&result, &staging_path);
    result
}

/// Downloads and imports an integration from a repository or archive URL.
pub async fn import_integration_url(
    app: AppHandle,
    downloader: &DownloaderService,
    source_url: String,
) -> Result<String, AppError> {
    let source_url = validate_import_url(&source_url)?;
    let import_id = build_import_id();
    let staging_path = ArchiveExtractor::prepare_staging(&import_id)?;
    let control = downloader.request_control(&import_id);
    let mut archive_path = None;

    let result = async {
        let client = build_public_client()?;
        let final_url = resolve_download_url(&client, &source_url).await?;
        let resolved_archive_path = build_import_archive_path(&import_id, &final_url);
        archive_path = Some(resolved_archive_path.clone());
        let download_result = download_file(
            DownloadTask {
                app: &app,
                downloader,
                client: &client,
                url: &final_url,
                dest_path: &resolved_archive_path,
                module_id: &import_id,
                control: &control,
            },
            None,
        )
        .await?;

        if let Some(interruption) = download_result.interruption {
            return Err(AppError::External {
                request_id: None,
                message: interruption.as_error_message().to_string(),
            });
        }

        ArchiveExtractor::extract_into(
            &app,
            &resolved_archive_path,
            &import_id,
            &staging_path,
            Some(download_result.snapshot),
        )
        .await?;

        finalize_imported_integration(&staging_path, Some(&source_url))
    }
    .await;

    downloader.remove_control(&import_id);
    cleanup_staging_on_error(&result, &staging_path);
    if let Some(archive_path) = archive_path {
        cleanup_import_archive(&archive_path).await;
    }
    result
}

/// Downloads and extracts a module from a remote repository
pub async fn download_module(
    app: AppHandle,
    downloader: &DownloaderService,
    module_id: String,
    repo_url: String,
    expected_hash: Option<String>,
    dl_type: Option<String>,
    release_selection: Option<ReleaseDownloadSelection>,
) -> Result<String, AppError> {
    validate_module_id(&module_id)?;
    downloader.remember_request(
        &module_id,
        DownloadRequest {
            repo_url: repo_url.clone(),
            expected_hash: expected_hash.clone(),
            dl_type: dl_type.clone(),
            release_selection: release_selection.clone(),
        },
    );

    let control = downloader.request_control(&module_id);
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

        let client = if dl_type.as_deref() == Some("release") && is_github_repo_url(&repo_url) {
            build_public_client()?
        } else {
            build_client(&module_id)?
        };
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
                    &client,
                    &repo_url,
                    &module_id,
                    release_selection.as_ref(),
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
                        control: &control,
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
                final_progress_snapshot = latest_progress_snapshot;

                if let Some(interruption) = download_result.interruption {
                    return Err(match interruption {
                        DownloadInterruption::Cancelled | DownloadInterruption::Paused => {
                            AppError::External {
                                request_id: None,
                                message: interruption.as_error_message().to_string(),
                            }
                        }
                    });
                }

                ensure_not_interrupted(&control)?;
                FileVerifier::verify(
                    &app,
                    &archive_path,
                    asset_hash.clone(),
                    &module_id,
                    Some(latest_progress_snapshot),
                )
                .await?;

                ensure_not_interrupted(&control)?;
                ArchiveExtractor::extract_into(
                    &app,
                    &archive_path,
                    &module_id,
                    &extraction_path,
                    Some(latest_progress_snapshot),
                )
                .await?;

                ensure_not_interrupted(&control)?;
            }
        }

        final_progress_snapshot = latest_progress_snapshot;

        ensure_not_interrupted(&control)?;
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
    downloader.remove_control(&module_id);

    let cleanup_archives = match &result {
        Ok(()) => true,
        Err(error) => {
            let message = error.to_string();
            message.contains("Integrity check failed") || message.contains("cancelled")
        }
    };
    if cleanup_archives {
        for archive_path in &temp_archives {
            if archive_path.exists() {
                if let Err(error) = tokio::fs::remove_file(archive_path).await
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    tracing::warn!(
                        module_id = module_id,
                        path = %archive_path.display(),
                        "Failed to remove temporary archive after interrupted download: {error}"
                    );
                }
            }
            if let Err(error) = remove_partial_metadata(archive_path).await {
                tracing::warn!(
                    module_id = module_id,
                    path = %archive_path.display(),
                    "Failed to remove partial download metadata after interrupted download: {error}"
                );
            }
        }
    }

    if result.is_err()
        && let Some(path) = &staging_path
        && path.exists()
    {
        if let Err(error) = tokio::fs::remove_dir_all(path).await {
            tracing::warn!(
                module_id = module_id,
                path = %path.display(),
                "Failed to remove staging directory after failed install: {error}"
            );
        }
    }

    if let Err(e) = result {
        let error_message = e.to_string();
        let status = if error_message.contains("paused") {
            "paused"
        } else if error_message.contains("cancelled") {
            "cancelled"
        } else {
            "error"
        };
        emit_progress(ProgressEvent {
            app: &app,
            module_id: &module_id,
            status,
            message: &error_message,
            progress: compute_progress(final_progress_snapshot),
            downloaded: final_progress_snapshot.downloaded,
            total: final_progress_snapshot.total,
            speed: 0,
        });
        if status == "paused" || status == "cancelled" {
            if status == "cancelled" {
                downloader.remove_request(&module_id);
            }
            return Ok(status.to_string());
        }
        downloader.remove_request(&module_id);
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
        if let Err(error) = remove_partial_metadata(archive_path).await {
            tracing::warn!(
                module_id = module_id,
                path = %archive_path.display(),
                "Failed to remove partial download metadata after successful install: {error}"
            );
        }
    }

    crate::infrastructure::logging::logger::add_log(
        &format!("Module {module_id} installed successfully (Atomic)"),
        "Downloader",
        "info",
    );
    downloader.remove_request(&module_id);

    Ok("completed".to_string())
}

fn validate_integration_manifest(manifest: &ModuleManifest) -> Result<String, AppError> {
    validate_module_id(&manifest.id)?;

    if let Some(category) = manifest.category.as_deref() {
        let normalized = category.trim().to_ascii_lowercase();
        if !matches!(
            normalized.as_str(),
            "service" | "services" | "integration" | "integrations"
        ) {
            return Err(AppError::Validation(
                "Custom integration manifest must use type = \"service\"".to_string(),
            ));
        }
    }

    Ok(manifest.id.clone())
}

fn finalize_imported_integration(
    extraction_path: &Path,
    source: Option<&str>,
) -> Result<String, AppError> {
    let manifest = ManifestLoader::load(extraction_path)?;
    let module_id = validate_integration_manifest(&manifest)?;
    let final_path = INTEGRATIONS_DIR.join(&module_id);

    std::fs::create_dir_all(&*INTEGRATIONS_DIR).map_err(|error| {
        AppError::Io(format!(
            "Failed to create integrations directory '{}': {error}",
            INTEGRATIONS_DIR.display()
        ))
    })?;

    let metadata = serde_json::json!({
        "module_id": module_id,
        "installed_at": chrono::Local::now().to_rfc3339(),
        "archive_hash": null,
        "status": "complete",
        "version": manifest.version,
        "source": source,
    });
    let metadata_path = extraction_path.join("metadata.json");
    let metadata_file = std::fs::File::create(&metadata_path).map_err(|error| {
        AppError::Io(format!(
            "Failed to create install metadata {}: {error}",
            metadata_path.display()
        ))
    })?;
    serde_json::to_writer_pretty(metadata_file, &metadata).map_err(|error| {
        AppError::Serialization(format!(
            "Failed to write install metadata {}: {error}",
            metadata_path.display()
        ))
    })?;

    let backup_path = TEMP_DIR.join(format!(
        "{}_integration_backup_{}",
        module_id,
        uuid::Uuid::new_v4().simple()
    ));

    if final_path.exists() {
        std::fs::rename(&final_path, &backup_path).map_err(|error| {
            AppError::Io(format!(
                "Failed to move old integration version to backup: {error}"
            ))
        })?;
    }

    if let Err(error) = std::fs::rename(extraction_path, &final_path) {
        if backup_path.exists()
            && let Err(restore_error) = std::fs::rename(&backup_path, &final_path)
        {
            tracing::error!(
                module_id,
                backup = %backup_path.display(),
                target = %final_path.display(),
                "Failed to restore previous integration after import failure: {restore_error}"
            );
        }

        return Err(AppError::Io(format!(
            "Atomic integration import failed during move: {error}"
        )));
    }

    if backup_path.exists() {
        std::fs::remove_dir_all(&backup_path).map_err(|error| {
            AppError::Io(format!("Failed to remove old integration backup: {error}"))
        })?;
    }

    crate::infrastructure::logging::logger::add_log(
        &format!("Integration {module_id} imported successfully"),
        "Downloader",
        "info",
    );

    Ok(module_id)
}

fn copy_directory_contents_secure(source: &Path, destination: &Path) -> Result<(), AppError> {
    let mut state = ImportCopyState::default();
    copy_directory_contents_secure_inner(source, destination, &mut state)
}

#[derive(Default)]
struct ImportCopyState {
    file_count: usize,
    total_size: u64,
}

fn copy_directory_contents_secure_inner(
    source: &Path,
    destination: &Path,
    state: &mut ImportCopyState,
) -> Result<(), AppError> {
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let metadata = std::fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::Validation(format!(
                "Symlinks are not supported in integration imports: {}",
                source_path.display()
            )));
        }

        let destination_path = destination.join(entry.file_name());
        if metadata.is_dir() {
            std::fs::create_dir_all(&destination_path)?;
            copy_directory_contents_secure_inner(&source_path, &destination_path, state)?;
            continue;
        }

        if !metadata.is_file() {
            return Err(AppError::Validation(format!(
                "Unsupported filesystem entry in integration import: {}",
                source_path.display()
            )));
        }

        state.file_count += 1;
        if state.file_count > IMPORT_FILE_COUNT_LIMIT {
            return Err(AppError::Validation(format!(
                "Integration folder contains too many files. Limit is {IMPORT_FILE_COUNT_LIMIT}."
            )));
        }

        state.total_size = state
            .total_size
            .checked_add(metadata.len())
            .ok_or_else(|| AppError::Validation("Integration folder size overflow".to_string()))?;
        if state.total_size > IMPORT_TOTAL_SIZE_LIMIT {
            return Err(AppError::Validation(
                "Integration folder is too large to import".to_string(),
            ));
        }

        if let Some(parent) = destination_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&source_path, &destination_path).map_err(|error| {
            AppError::Io(format!(
                "Failed to copy '{}' to '{}': {error}",
                source_path.display(),
                destination_path.display()
            ))
        })?;
    }

    Ok(())
}

fn ensure_source_directory(path: &Path) -> Result<(), AppError> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        AppError::Io(format!(
            "Failed to read integration folder '{}': {error}",
            path.display()
        ))
    })?;
    if !metadata.is_dir() {
        return Err(AppError::Validation(
            "Selected integration source is not a folder".to_string(),
        ));
    }

    Ok(())
}

fn ensure_source_file(path: &Path) -> Result<(), AppError> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        AppError::Io(format!(
            "Failed to read integration archive '{}': {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(AppError::Validation(
            "Selected integration source is not an archive file".to_string(),
        ));
    }

    Ok(())
}

fn validate_import_url(source_url: &str) -> Result<String, AppError> {
    let source_url = source_url.trim();
    if source_url.is_empty() {
        return Err(AppError::Validation(
            "Integration URL cannot be empty".to_string(),
        ));
    }

    let url = reqwest::Url::parse(source_url)
        .map_err(|error| AppError::Validation(format!("Integration URL is invalid: {error}")))?;
    match url.scheme() {
        "https" => {}
        "http" if is_local_import_host(url.host_str()) => {}
        "http" => {
            return Err(AppError::Validation(
                "Integration URL must use https:// unless it targets localhost development"
                    .to_string(),
            ));
        }
        _ => {
            return Err(AppError::Validation(
                "Integration URL must start with https://".to_string(),
            ));
        }
    }

    Ok(source_url.to_string())
}

fn is_local_import_host(host: Option<&str>) -> bool {
    matches!(host, Some("localhost" | "127.0.0.1" | "::1"))
}

fn build_import_id() -> String {
    format!("integration-import-{}", uuid::Uuid::new_v4().simple())
}

fn build_import_archive_path(import_id: &str, source_url: &str) -> PathBuf {
    let normalized = source_url
        .split(['?', '#'])
        .next()
        .unwrap_or(source_url)
        .to_ascii_lowercase();
    let extension = if normalized.ends_with(".tar.gz") {
        "tar.gz"
    } else {
        match Path::new(&normalized)
            .extension()
            .and_then(|extension| extension.to_str())
        {
            Some(extension) if extension.eq_ignore_ascii_case("tgz") => "tgz",
            Some(extension) if extension.eq_ignore_ascii_case("7z") => "7z",
            _ => "zip",
        }
    };

    TEMP_DIR.join(format!("{import_id}.{extension}"))
}

fn cleanup_staging_on_error(result: &Result<String, AppError>, staging_path: &Path) {
    if result.is_ok() || !staging_path.exists() {
        return;
    }

    if let Err(error) = std::fs::remove_dir_all(staging_path) {
        tracing::warn!(
            path = %staging_path.display(),
            "Failed to clean integration import staging directory: {error}"
        );
    }
}

async fn cleanup_import_archive(archive_path: &Path) {
    if let Err(error) = remove_partial_metadata(archive_path).await {
        tracing::warn!(
            path = %archive_path.display(),
            "Failed to remove integration import partial metadata: {error}"
        );
    }
    match tokio::fs::remove_file(archive_path).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            tracing::warn!(
                path = %archive_path.display(),
                "Failed to remove temporary integration archive: {error}"
            );
        }
    }
}

fn is_github_repo_url(repo_url: &str) -> bool {
    repo_url.trim().to_ascii_lowercase().contains("github.com/")
}

fn ensure_not_interrupted(
    control: &super::downloader_service::DownloadControl,
) -> Result<(), AppError> {
    if control.is_cancel_requested() {
        return Err(AppError::External {
            request_id: None,
            message: DownloadInterruption::Cancelled
                .as_error_message()
                .to_string(),
        });
    }

    if control.is_pause_requested() {
        return Err(AppError::External {
            request_id: None,
            message: DownloadInterruption::Paused.as_error_message().to_string(),
        });
    }

    Ok(())
}

/// Checks if a module is installed (wrapper)
pub fn check_module_installed(module_id: &str) -> bool {
    is_module_installed(module_id)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::ensure_not_interrupted;
    use crate::domain::modules::downloader_service::DownloaderService;
    use crate::domain::modules::downloader_support::{
        PartialDownloadMetadata, TarEntryAction, classify_tar_entry_type, if_range_validator,
        load_partial_metadata, normalize_archive_relative_path, parse_content_range_total,
        store_partial_metadata,
    };
    use crate::errors::AppError;
    use sevenz_rust2::{ArchiveReader, Password};
    use std::path::{Path, PathBuf};

    #[test]
    fn ensure_not_interrupted_reports_pause_requests() {
        let service = DownloaderService::new();
        let control = service.request_control("demo");
        assert!(service.pause("demo"));

        let error = ensure_not_interrupted(&control).expect_err("pause should interrupt");

        assert!(error.to_string().contains("Download paused"));
    }

    #[test]
    fn ensure_not_interrupted_reports_cancel_requests() {
        let service = DownloaderService::new();
        let control = service.request_control("demo");
        assert!(service.cancel("demo"));

        let error = ensure_not_interrupted(&control).expect_err("cancel should interrupt");

        assert!(error.to_string().contains("Download cancelled"));
    }

    #[test]
    fn validate_import_url_rejects_plain_http_except_localhost() {
        assert!(
            super::validate_import_url("https://github.com/F0RLE/demo/archive/main.zip").is_ok()
        );
        assert!(super::validate_import_url("http://localhost:4000/integration.zip").is_ok());
        assert!(super::validate_import_url("http://127.0.0.1:4000/integration.zip").is_ok());

        let error = super::validate_import_url("http://example.com/integration.zip")
            .expect_err("plain remote http should be rejected");

        assert!(matches!(error, AppError::Validation(_)));
    }

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

    #[tokio::test]
    async fn partial_metadata_load_reports_corrupt_json() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let archive_path = temp_dir.path().join("module.zip");
        tokio::fs::write(
            format!("{}.resume.json", archive_path.to_string_lossy()),
            "{not-json",
        )
        .await
        .expect("write corrupt metadata");

        let error = load_partial_metadata(&archive_path)
            .await
            .expect_err("corrupt metadata must be reported");

        assert!(error.to_string().contains("partial download metadata"));
    }

    #[tokio::test]
    async fn partial_metadata_round_trips_valid_json() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let archive_path = temp_dir.path().join("module.zip");
        let metadata = PartialDownloadMetadata {
            url: "https://example.com/module.zip".to_string(),
            etag: Some("\"etag-value\"".to_string()),
            last_modified: None,
            total_bytes: Some(42),
        };

        store_partial_metadata(&archive_path, &metadata)
            .await
            .expect("store metadata");
        let loaded = load_partial_metadata(&archive_path)
            .await
            .expect("load metadata")
            .expect("metadata exists");

        assert_eq!(loaded.url, metadata.url);
        assert_eq!(loaded.etag, metadata.etag);
        assert_eq!(loaded.total_bytes, metadata.total_bytes);
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
