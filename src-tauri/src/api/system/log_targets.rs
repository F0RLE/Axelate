use crate::domain::engine::manager::canonical_engine_id;
use crate::errors::AppError;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub(super) fn resolve_console_log_target(view_id: &str) -> Result<PathBuf, AppError> {
    if let Some(engine_id) = view_id.strip_prefix("engine:") {
        let engine_id = canonical_engine_id(engine_id);
        validate_console_log_segment(&engine_id, "Engine ID")?;
        return Ok(crate::utils::paths::ENGINE_LOGS_DIR.join(engine_id));
    }

    if let Some(module_id) = view_id.strip_prefix("module:") {
        crate::domain::modules::downloader::validate_module_id(module_id)?;
        return Ok(crate::utils::paths::INTEGRATION_LOGS_DIR.join(module_id));
    }

    if view_id == "general" {
        return Ok(crate::utils::paths::LOG_DIR.clone());
    }

    Err(AppError::Validation("invalid console view id".into()))
}

fn validate_console_log_segment(value: &str, label: &str) -> Result<(), AppError> {
    if value.is_empty() {
        return Err(AppError::Validation(format!("{label} cannot be empty")));
    }

    if !value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(AppError::Validation(format!(
            "{label} contains invalid characters"
        )));
    }

    Ok(())
}

pub(super) fn canonical_console_view_id(view_id: &str) -> String {
    if let Some(engine_id) = view_id.strip_prefix("engine:") {
        return format!("engine:{}", canonical_engine_id(engine_id));
    }

    view_id.trim().to_string()
}

pub(super) fn clear_console_log_target(view_id: &str, target: &Path) -> Result<(), AppError> {
    if !valid_log_root(target)? {
        return Ok(());
    }

    if view_id == "general" {
        let general_log = target.join("axelate.log");
        if is_regular_log_file(&general_log)? {
            clear_log_file(&general_log)?;
        }
        return Ok(());
    }

    for entry in fs::read_dir(target)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_file() && has_log_extension(&entry.path()) {
            let path = entry.path();
            clear_log_file(&path)?;
        }
    }

    Ok(())
}

fn valid_log_root(root: &Path) -> Result<bool, AppError> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };

    if metadata.file_type().is_symlink() {
        return Err(AppError::Validation(
            "console log target cannot be a symlink".into(),
        ));
    }

    Ok(metadata.is_dir())
}

fn is_regular_log_file(path: &Path) -> Result<bool, AppError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };

    Ok(metadata.file_type().is_file() && has_log_extension(path))
}

fn has_log_extension(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("log"))
}

fn clear_log_file(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Ok(());
    }

    fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)?;
    Ok(())
}

pub(super) fn clear_all_console_log_files(root: &Path) -> Result<(), AppError> {
    if !valid_log_root(root)? {
        return Ok(());
    }

    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_dir() {
            clear_all_console_log_files(&path)?;
            continue;
        }

        if file_type.is_file() && has_log_extension(&path) {
            clear_log_file(&path)?;
        }
    }

    Ok(())
}
