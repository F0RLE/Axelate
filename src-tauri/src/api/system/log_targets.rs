use crate::domain::engine::manager::canonical_engine_id;
use crate::errors::AppError;
use std::fs;
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

    Ok(crate::utils::paths::LOG_DIR.clone())
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
    if view_id == "general" {
        clear_log_file(&target.join("axelate.log"))?;
        return Ok(());
    }

    if !target.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(target)? {
        let path = entry?.path();
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("log"))
        {
            clear_log_file(&path)?;
        }
    }

    Ok(())
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
    if !root.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            clear_all_console_log_files(&path)?;
            continue;
        }

        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("log"))
        {
            clear_log_file(&path)?;
        }
    }

    Ok(())
}
