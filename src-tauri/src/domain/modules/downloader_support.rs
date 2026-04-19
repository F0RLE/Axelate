use crate::errors::AppError;
use std::path::{Path, PathBuf};

const MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE: u64 = 3 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE_LARGE_MODULE: u64 = 12 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_FILE_COUNT: usize = 10000;
const MAX_ARCHIVE_FILE_COUNT_LARGE_MODULE: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TarEntryAction {
    CopyFile,
    CreateDirectory,
    SkipMetadata,
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub(super) struct PartialDownloadMetadata {
    pub(super) url: String,
    pub(super) etag: Option<String>,
    pub(super) last_modified: Option<String>,
    pub(super) total_bytes: Option<u64>,
}

pub(super) fn normalize_archive_relative_path(path: &Path) -> Result<PathBuf, String> {
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

pub(super) fn classify_tar_entry_type(
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

pub(super) fn parse_content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
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

pub(super) async fn load_partial_metadata(dest_path: &Path) -> Option<PartialDownloadMetadata> {
    let metadata_path = partial_metadata_path(dest_path);
    let raw = tokio::fs::read_to_string(metadata_path).await.ok()?;
    serde_json::from_str(&raw).ok()
}

pub(super) async fn store_partial_metadata(
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

pub(super) async fn remove_partial_metadata(dest_path: &Path) {
    let metadata_path = partial_metadata_path(dest_path);
    if tokio::fs::try_exists(&metadata_path).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(metadata_path).await;
    }
}

pub(super) fn extract_strong_etag(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let raw = headers.get(reqwest::header::ETAG)?.to_str().ok()?.trim();
    if raw.starts_with("W/") || raw.is_empty() {
        return None;
    }

    Some(raw.to_string())
}

pub(super) fn extract_last_modified(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn if_range_validator(metadata: &PartialDownloadMetadata) -> Option<&str> {
    metadata
        .etag
        .as_deref()
        .or(metadata.last_modified.as_deref())
}

pub(super) fn format_archive_extraction_error(message: &str) -> String {
    if message.contains("Kind(OutOfMemory)") || message.contains("MaxMemLimited") {
        return "Not enough RAM to extract this archive with the current decoder".to_string();
    }

    message.to_string()
}

pub(super) fn shared_archive_root<I>(entry_names: I) -> Option<String>
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

pub(super) fn strip_archive_root(path: &Path, root_to_skip: Option<&str>) -> PathBuf {
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

pub(super) fn archive_file_count_limit(module_id: &str) -> usize {
    if module_id == "comfyui" {
        return MAX_ARCHIVE_FILE_COUNT_LARGE_MODULE;
    }

    MAX_ARCHIVE_FILE_COUNT
}

pub(super) fn archive_total_uncompressed_size_limit(module_id: &str) -> u64 {
    if module_id == "comfyui" {
        return MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE_LARGE_MODULE;
    }

    MAX_ARCHIVE_TOTAL_UNCOMPRESSED_SIZE
}
