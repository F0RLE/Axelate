use super::downloader_comfyui::prepare_comfyui_module_files;
use super::downloader_progress::{
    ProgressSnapshot, calculate_speed, combine_progress_phases, compute_progress,
    emit_extraction_progress, emit_verifying_progress,
};
use super::downloader_support::{
    TarEntryAction, archive_file_count_limit, archive_total_uncompressed_size_limit,
    classify_tar_entry_type, format_archive_extraction_error, normalize_archive_relative_path,
    package_install_dir, shared_archive_root, strip_archive_root,
};
use crate::errors::AppError;
use crate::utils::paths::TEMP_DIR;
use sevenz_rust2::{ArchiveReader, Password};
use std::collections::HashSet;
use std::fs;
use std::io::{BufWriter, copy};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use zip::ZipArchive;
use zip::result::ZipError;

const MAX_ARCHIVE_SINGLE_FILE_SIZE: u64 = 1024 * 1024 * 1024;

pub struct FileVerifier;

impl FileVerifier {
    pub async fn verify(
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

            emit_verifying_progress(app, module_id, 0.0, progress_snapshot, 0);

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
                        emit_verifying_progress(
                            &app_handle,
                            &verify_module_id,
                            compute_progress(ProgressSnapshot {
                                downloaded: verified_bytes,
                                total: total_size,
                            }),
                            snapshot,
                            calculate_speed(window_bytes, last_emit.elapsed().as_secs_f64()),
                        );
                        last_emit = std::time::Instant::now();
                        window_bytes = 0;
                    }
                }

                emit_verifying_progress(&app_handle, &verify_module_id, 1.0, snapshot, 0);
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

pub struct ArchiveExtractor;

#[derive(Clone, Copy)]
struct ExtractionSafetyPolicy {
    max_file_count: usize,
    max_total_uncompressed_size: u64,
}

impl ExtractionSafetyPolicy {
    fn new(module_id: &str) -> Self {
        Self {
            max_file_count: archive_file_count_limit(module_id),
            max_total_uncompressed_size: archive_total_uncompressed_size_limit(module_id),
        }
    }

    fn ensure_file_count(self, file_count: usize) -> Result<(), String> {
        if file_count > self.max_file_count {
            return Err(format!(
                "Archive contains too many files ({file_count}). Limit is {}.",
                self.max_file_count
            ));
        }

        Ok(())
    }

    fn ensure_file_count_no_total(self, file_count: usize) -> Result<(), String> {
        if file_count > self.max_file_count {
            return Err(format!(
                "Archive contains too many files. Limit is {}.",
                self.max_file_count
            ));
        }

        Ok(())
    }

    fn ensure_single_file_size(size: u64, label: &str) -> Result<(), String> {
        if size > MAX_ARCHIVE_SINGLE_FILE_SIZE {
            return Err(format!(
                "Security Violation: Single file size exceeds limit ({}MB): {label}",
                MAX_ARCHIVE_SINGLE_FILE_SIZE / (1024 * 1024)
            ));
        }

        Ok(())
    }

    fn ensure_total_uncompressed_size(self, total_size: u64) -> Result<(), String> {
        if total_size > self.max_total_uncompressed_size {
            return Err(format!(
                "Extraction aborted: Total uncompressed size exceeds limit ({}MB)",
                self.max_total_uncompressed_size / (1024 * 1024)
            ));
        }

        Ok(())
    }
}

fn detect_zip_shared_root(archive: &mut ZipArchive<fs::File>) -> Result<Option<String>, String> {
    let mut names = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error: ZipError| error.to_string())?;
        names.push(file.name().to_string());
    }

    Ok(shared_archive_root(names.iter().map(String::as_str)))
}

fn resolve_zip_output_path(
    extraction_path: &Path,
    enclosed_name: Option<&Path>,
    raw_name: &str,
    root_to_skip: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let Some(path) = enclosed_name else {
        return Ok(None);
    };

    if path.is_absolute() {
        return Err(format!(
            "Security Violation: Absolute path detected: {raw_name}"
        ));
    }

    let output_path = if let Some(root) = root_to_skip {
        let mut components = path.components();
        let first = components.next();
        if let Some(std::path::Component::Normal(component)) = first {
            if component.to_string_lossy() == root {
                extraction_path.join(components.as_path())
            } else {
                extraction_path.join(path)
            }
        } else {
            extraction_path.join(path)
        }
    } else {
        extraction_path.join(path)
    };

    Ok(Some(output_path))
}

impl ArchiveExtractor {
    pub fn prepare_staging(module_id: &str) -> Result<PathBuf, AppError> {
        let extraction_id = format!("extracting_{}_{}", module_id, uuid::Uuid::new_v4());
        let extraction_path = TEMP_DIR.join(extraction_id);

        if extraction_path.exists() {
            fs::remove_dir_all(&extraction_path).map_err(|error| {
                AppError::Io(format!(
                    "Failed to remove stale extraction directory '{}': {error}",
                    extraction_path.display()
                ))
            })?;
        }
        fs::create_dir_all(&extraction_path).map_err(|error| {
            AppError::Io(format!(
                "Failed to create extraction directory '{}': {error}",
                extraction_path.display()
            ))
        })?;

        Ok(extraction_path)
    }

    pub async fn extract_into(
        app: &AppHandle,
        archive_path: &Path,
        module_id: &str,
        extraction_path: &Path,
        progress_snapshot: Option<ProgressSnapshot>,
    ) -> Result<(), AppError> {
        emit_extraction_progress(app, module_id, "Extracting...", 0.0, progress_snapshot, 0);

        let app_handle = app.clone();
        let mid = module_id.to_string();
        let apath = archive_path.to_owned();
        let epath = extraction_path.to_path_buf();
        let safety = ExtractionSafetyPolicy::new(module_id);

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

        tokio::task::spawn_blocking(move || {
            if is_tar_gz {
                Self::extract_tar_gz_archive(&apath, &epath, safety, &mid)?;
            } else if is_seven_zip {
                Self::extract_seven_zip_archive(
                    &app_handle,
                    &mid,
                    &apath,
                    &epath,
                    safety,
                    progress_snapshot,
                )?;
            } else {
                Self::extract_zip_archive(
                    &app_handle,
                    &mid,
                    &apath,
                    &epath,
                    safety,
                    progress_snapshot,
                )?;
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

    fn extract_tar_gz_archive(
        archive_path: &Path,
        extraction_path: &Path,
        safety: ExtractionSafetyPolicy,
        module_id: &str,
    ) -> Result<(), String> {
        let archive_file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
        tracing::info!("Extracting .tar.gz archive for {}", module_id);
        let tar = flate2::read::GzDecoder::new(archive_file);
        let mut archive = tar::Archive::new(tar);

        let mut current_total_size: u64 = 0;
        let mut file_count: usize = 0;
        let mut seen_entries = HashSet::new();

        for entry_result in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry_result.map_err(|e| e.to_string())?;
            file_count += 1;
            safety.ensure_file_count_no_total(file_count)?;

            let raw_path = entry.path().map_err(|e| e.to_string())?.into_owned();
            let path = normalize_archive_relative_path(&raw_path)?;
            let action = classify_tar_entry_type(entry.header().entry_type(), &path)?;

            if action == TarEntryAction::SkipMetadata || path.as_os_str().is_empty() {
                continue;
            }

            if !seen_entries.insert(path.clone()) {
                return Err(format!(
                    "Security Violation: Duplicate entry in archive: {}",
                    path.display()
                ));
            }

            let outpath = extraction_path.join(&path);
            if outpath == extraction_path {
                continue;
            }

            if action == TarEntryAction::CreateDirectory {
                fs::create_dir_all(&outpath).map_err(|e| {
                    format!("Failed to create directory {}: {e}", outpath.display())
                })?;
                continue;
            }

            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
            }

            let size = entry.header().size().unwrap_or(0);
            ExtractionSafetyPolicy::ensure_single_file_size(size, &path.display().to_string())?;
            current_total_size += size;
            safety.ensure_total_uncompressed_size(current_total_size)?;

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

        Ok(())
    }

    fn extract_seven_zip_archive(
        app_handle: &AppHandle,
        module_id: &str,
        archive_path: &Path,
        extraction_path: &Path,
        safety: ExtractionSafetyPolicy,
        progress_snapshot: Option<ProgressSnapshot>,
    ) -> Result<(), String> {
        tracing::info!("Extracting .7z archive for {}", module_id);
        let mut archive =
            ArchiveReader::open(archive_path, Password::empty()).map_err(|e| e.to_string())?;
        archive.set_thread_count(1);
        let total_files = archive.archive().files.len();
        safety.ensure_file_count(total_files)?;

        let total_uncompressed_size = Self::scan_seven_zip_metadata(
            app_handle,
            module_id,
            &archive,
            safety,
            progress_snapshot,
        )?;
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
                let normalized_path = normalize_archive_relative_path(Path::new(entry.name()))
                    .map_err(std::io::Error::other)?;
                let relative_path = strip_archive_root(&normalized_path, root_to_skip.as_deref());

                if relative_path.as_os_str().is_empty() {
                    return Ok(true);
                }

                let outpath = extraction_path.join(&relative_path);
                if outpath == extraction_path {
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
                        emit_extraction_progress(
                            app_handle,
                            module_id,
                            "Extracting...",
                            combine_progress_phases(0.05, 0.95, progress),
                            progress_snapshot,
                            calculate_speed(
                                extracted_window_bytes,
                                last_emit.elapsed().as_secs_f64(),
                            ),
                        );
                        last_emit = std::time::Instant::now();
                        extracted_window_bytes = 0;
                    }
                }

                use std::io::Write as _;
                outfile.flush()?;

                Ok(true)
            })
            .map_err(|e| e.to_string())?;

        emit_extraction_progress(
            app_handle,
            module_id,
            "Extracting...",
            1.0,
            progress_snapshot,
            0,
        );
        Ok(())
    }

    fn scan_seven_zip_metadata(
        app_handle: &AppHandle,
        module_id: &str,
        archive: &ArchiveReader<fs::File>,
        safety: ExtractionSafetyPolicy,
        progress_snapshot: Option<ProgressSnapshot>,
    ) -> Result<u64, String> {
        tracing::info!("Scanning .7z archive metadata for {}", module_id);
        let total_files = archive.archive().files.len();
        let mut total_uncompressed_size = 0_u64;
        let mut last_scan_emit = std::time::Instant::now();

        for (entry_index, entry) in archive.archive().files.iter().enumerate() {
            ExtractionSafetyPolicy::ensure_single_file_size(entry.size(), entry.name())?;

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

            safety.ensure_total_uncompressed_size(total_uncompressed_size)?;

            if total_files > 0 && last_scan_emit.elapsed().as_millis() >= 120 {
                #[allow(clippy::cast_precision_loss)]
                let scan_progress = (entry_index + 1) as f32 / total_files as f32;
                emit_extraction_progress(
                    app_handle,
                    module_id,
                    "Preparing extraction...",
                    combine_progress_phases(0.0, 0.05, scan_progress),
                    progress_snapshot,
                    0,
                );
                last_scan_emit = std::time::Instant::now();
            }
        }

        Ok(total_uncompressed_size)
    }

    fn extract_zip_archive(
        app_handle: &AppHandle,
        module_id: &str,
        archive_path: &Path,
        extraction_path: &Path,
        safety: ExtractionSafetyPolicy,
        progress_snapshot: Option<ProgressSnapshot>,
    ) -> Result<(), String> {
        let archive_file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
        tracing::info!("Extracting .zip archive for {}", module_id);
        let mut archive =
            ZipArchive::new(archive_file).map_err(|e| format!("Invalid archive: {e}"))?;

        let total_files = archive.len();
        let mut current_total_size: u64 = 0;
        let mut seen_files = HashSet::new();

        safety.ensure_file_count(total_files)?;
        let root_to_skip = detect_zip_shared_root(&mut archive)?;

        for i in 0..total_files {
            let mut file = archive.by_index(i).map_err(|e: ZipError| e.to_string())?;
            let raw_name = file.name().to_string();
            if !seen_files.insert(raw_name.clone()) {
                return Err(format!(
                    "Security Violation: Duplicate entry in archive: {raw_name}"
                ));
            }

            Self::ensure_zip_entry_type_supported(&file, &raw_name)?;
            let Some(outpath) = resolve_zip_output_path(
                extraction_path,
                file.enclosed_name().as_deref(),
                &raw_name,
                root_to_skip.as_deref(),
            )?
            else {
                continue;
            };

            if outpath == extraction_path {
                continue;
            }

            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath).map_err(|error| {
                    format!(
                        "Failed to create extraction directory {}: {error}",
                        outpath.display()
                    )
                })?;
            } else {
                Self::extract_zip_file_entry(
                    &mut file,
                    &outpath,
                    &raw_name,
                    safety,
                    &mut current_total_size,
                )?;
            }

            if i % 10 == 0 {
                #[allow(clippy::cast_precision_loss)]
                let progress = i as f32 / total_files as f32;
                emit_extraction_progress(
                    app_handle,
                    module_id,
                    "Extracting...",
                    progress,
                    progress_snapshot,
                    0,
                );
            }
        }

        Ok(())
    }

    #[cfg(unix)]
    fn ensure_zip_entry_type_supported(
        file: &zip::read::ZipFile<'_, fs::File>,
        raw_name: &str,
    ) -> Result<(), String> {
        if let Some(mode) = file.unix_mode() {
            let file_type = mode & 0o170000;
            if file_type != 0o100000 && file_type != 0o040000 {
                return Err(format!(
                    "Security Violation: Unsupported file type (symlink/device) in archive: {raw_name}"
                ));
            }
        }

        Ok(())
    }

    #[cfg(not(unix))]
    #[allow(clippy::unnecessary_wraps)]
    #[allow(clippy::missing_const_for_fn)]
    fn ensure_zip_entry_type_supported(
        _file: &zip::read::ZipFile<'_, fs::File>,
        _raw_name: &str,
    ) -> Result<(), String> {
        Ok(())
    }

    fn extract_zip_file_entry(
        file: &mut zip::read::ZipFile<'_, fs::File>,
        outpath: &Path,
        raw_name: &str,
        safety: ExtractionSafetyPolicy,
        current_total_size: &mut u64,
    ) -> Result<(), String> {
        if let Some(parent) = outpath.parent()
            && !parent.exists()
        {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create extraction directory {}: {error}",
                    parent.display()
                )
            })?;
        }

        let u_size = file.size();
        let c_size = file.compressed_size();
        ExtractionSafetyPolicy::ensure_single_file_size(u_size, raw_name)?;
        Self::ensure_zip_compression_ratio_is_safe(u_size, c_size, raw_name)?;

        *current_total_size += u_size;
        safety.ensure_total_uncompressed_size(*current_total_size)?;

        let mut outfile = fs::File::create(outpath)
            .map_err(|e| format!("Failed to create file {}: {e}", outpath.display()))?;
        copy(file, &mut outfile).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn ensure_zip_compression_ratio_is_safe(
        uncompressed_size: u64,
        compressed_size: u64,
        raw_name: &str,
    ) -> Result<(), String> {
        if compressed_size > 0 {
            #[allow(clippy::cast_precision_loss)]
            let ratio = (uncompressed_size as f64) / (compressed_size as f64);
            if ratio > 1000.0 {
                return Err(format!(
                    "Security Violation: Anomalous compression ratio ({ratio}x) detected for {raw_name}"
                ));
            }
        }

        Ok(())
    }

    pub fn finalize(
        module_id: &str,
        extraction_path: &Path,
        expected_hash: Option<&String>,
        release_tag: Option<&str>,
        release_compute_target: Option<&str>,
    ) -> Result<(), AppError> {
        let final_path = package_install_dir(module_id);

        if module_id == "comfyui" {
            prepare_comfyui_module_files(extraction_path, release_tag)?;
        }
        let manifest = serde_json::json!({
            "module_id": module_id,
            "installed_at": chrono::Local::now().to_rfc3339(),
            "archive_hash": expected_hash.cloned(),
            "status": "complete",
            "version": release_tag.unwrap_or("unknown"),
            "compute_target": release_compute_target,
        });
        let manifest_path = extraction_path.join("metadata.json");
        let manifest_file = fs::File::create(&manifest_path).map_err(|error| {
            AppError::Io(format!(
                "Failed to create install metadata {}: {error}",
                manifest_path.display()
            ))
        })?;
        serde_json::to_writer_pretty(manifest_file, &manifest).map_err(|error| {
            AppError::Serialization(format!(
                "Failed to write install metadata {}: {error}",
                manifest_path.display()
            ))
        })?;

        let backup_path = TEMP_DIR.join(format!("{module_id}_backup_{}", uuid::Uuid::new_v4()));

        if final_path.exists() {
            fs::rename(&final_path, &backup_path).map_err(|e| {
                AppError::Io(format!("Failed to move old module version to backup: {e}"))
            })?;
        }

        if let Err(e) = fs::rename(extraction_path, &final_path) {
            if backup_path.exists() {
                if let Err(restore_error) = fs::rename(&backup_path, &final_path) {
                    tracing::error!(
                        module_id,
                        backup = %backup_path.display(),
                        target = %final_path.display(),
                        "Failed to restore previous module version after install failure: {restore_error}"
                    );
                }
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
