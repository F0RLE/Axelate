use crate::errors::AppError;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
/// Canonical module-owned settings UI location.
pub struct SettingsUiLocation {
    /// Canonical root directory that contains the settings UI assets.
    pub root: PathBuf,
    /// Canonical entry HTML file loaded by the launcher.
    pub entry: PathBuf,
}

/// Resolves the canonical root directory and entry HTML file for a module-owned settings UI.
pub async fn resolve_module_settings_ui_location(
    module_id: &str,
) -> Result<SettingsUiLocation, AppError> {
    crate::domain::modules::downloader::validate_module_id(module_id)?;

    let module_root = crate::domain::modules::downloader::get_module_path(module_id);
    let manifest = crate::domain::modules::lifecycle::ManifestLoader::load(&module_root)?;
    let settings_ui = manifest.settings_ui.ok_or_else(|| {
        AppError::NotFound(format!(
            "Module {module_id} does not expose a custom settings UI"
        ))
    })?;

    resolve_settings_ui_location(&module_root, &settings_ui).await
}

/// Resolves a canonical settings UI root and entry path from a module-local `settings_ui` value.
pub async fn resolve_settings_ui_root(
    module_root: &Path,
    settings_ui: &str,
) -> Result<(PathBuf, PathBuf), AppError> {
    let location = resolve_settings_ui_location(module_root, settings_ui).await?;
    Ok((location.root, location.entry))
}

/// Resolves a module-owned asset path relative to the canonical settings UI root.
pub async fn resolve_settings_ui_asset_path(
    location: &SettingsUiLocation,
    raw_path: &str,
) -> Result<PathBuf, AppError> {
    let relative_path = validate_relative_module_asset(raw_path)?;
    let asset_path = tokio::fs::canonicalize(location.root.join(relative_path))
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    if !asset_path.starts_with(&location.root) {
        return Err(AppError::PermissionDenied(
            "settings_ui asset must stay inside its root directory".to_string(),
        ));
    }

    let metadata = tokio::fs::metadata(&asset_path)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;

    if !metadata.is_file() {
        return Err(AppError::NotFound(
            "settings_ui asset must point to a file".to_string(),
        ));
    }

    Ok(asset_path)
}

async fn resolve_settings_ui_location(
    module_root: &Path,
    settings_ui: &str,
) -> Result<SettingsUiLocation, AppError> {
    let canonical_module_root = tokio::fs::canonicalize(module_root)
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;
    let requested_path = validate_relative_module_asset(settings_ui)?;
    let configured_path = tokio::fs::canonicalize(module_root.join(&requested_path))
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    if !configured_path.starts_with(&canonical_module_root) {
        return Err(AppError::PermissionDenied(
            "settings_ui must stay inside the module directory".to_string(),
        ));
    }

    let metadata = tokio::fs::metadata(&configured_path)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;

    let (root, entry) = if metadata.is_dir() {
        let entry = configured_path.join("index.html");
        (configured_path, entry)
    } else {
        let root = configured_path.parent().ok_or_else(|| {
            AppError::Validation("settings_ui file must have a parent directory".to_string())
        })?;
        (root.to_path_buf(), configured_path)
    };

    let entry = tokio::fs::canonicalize(&entry)
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    let canonical_root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|error| AppError::NotFound(error.to_string()))?;

    if !entry.starts_with(&canonical_root) {
        return Err(AppError::PermissionDenied(
            "settings_ui entry must stay inside its root directory".to_string(),
        ));
    }

    Ok(SettingsUiLocation {
        root: canonical_root,
        entry,
    })
}

pub(crate) fn validate_relative_module_asset(raw_path: &str) -> Result<PathBuf, AppError> {
    let trimmed = raw_path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "settings_ui path cannot be empty".to_string(),
        ));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Err(AppError::Validation(
            "settings_ui path must be relative".to_string(),
        ));
    }

    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(AppError::Validation(
            "settings_ui path contains forbidden segments".to_string(),
        ));
    }

    Ok(path)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{
        SettingsUiLocation, resolve_settings_ui_asset_path, resolve_settings_ui_root,
        validate_relative_module_asset,
    };
    use crate::errors::AppError;
    use std::fs;

    #[tokio::test]
    async fn resolve_settings_ui_root_allows_valid_file_inside_module() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let settings_dir = temp_dir.path().join("settings-ui");
        fs::create_dir_all(&settings_dir).expect("create settings dir");
        let entry_path = settings_dir.join("index.html");
        fs::write(&entry_path, "<html></html>").expect("write entry file");

        let (root, entry) = resolve_settings_ui_root(temp_dir.path(), "settings-ui/index.html")
            .await
            .expect("resolve settings ui");

        assert_eq!(
            root,
            fs::canonicalize(&settings_dir).expect("canonical settings root")
        );
        assert_eq!(
            entry,
            fs::canonicalize(&entry_path).expect("canonical entry path")
        );
    }

    #[tokio::test]
    async fn resolve_settings_ui_root_uses_directory_index() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let settings_dir = temp_dir.path().join("settings-ui");
        fs::create_dir_all(&settings_dir).expect("create settings dir");
        let entry_path = settings_dir.join("index.html");
        fs::write(&entry_path, "<html></html>").expect("write entry file");

        let (root, entry) = resolve_settings_ui_root(temp_dir.path(), "settings-ui")
            .await
            .expect("resolve settings ui");

        assert_eq!(
            root,
            fs::canonicalize(&settings_dir).expect("canonical settings root")
        );
        assert_eq!(
            entry,
            fs::canonicalize(&entry_path).expect("canonical entry path")
        );
    }

    #[tokio::test]
    async fn resolve_settings_ui_asset_path_rejects_escape_attempts() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let settings_dir = temp_dir.path().join("settings-ui");
        fs::create_dir_all(&settings_dir).expect("create settings dir");
        let entry_path = settings_dir.join("index.html");
        fs::write(&entry_path, "<html></html>").expect("write entry file");

        let location = SettingsUiLocation {
            root: fs::canonicalize(&settings_dir).expect("canonical settings root"),
            entry: fs::canonicalize(&entry_path).expect("canonical entry path"),
        };

        let error = resolve_settings_ui_asset_path(&location, "../secret.txt")
            .await
            .expect_err("escape should fail");

        assert!(matches!(error, AppError::Validation(_)));
    }

    #[test]
    fn validate_relative_module_asset_rejects_empty_paths() {
        let error = validate_relative_module_asset("   ").expect_err("empty path should fail");
        assert!(matches!(error, AppError::Validation(_)));
    }
}
