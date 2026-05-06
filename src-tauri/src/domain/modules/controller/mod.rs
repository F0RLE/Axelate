use crate::domain::modules::{downloader, lifecycle as module_lifecycle};
use crate::errors::AppError;
use crate::models::modules::ModulePreview;
use crate::models::{ControlResponse, Module};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use dashmap::DashMap;
use std::path::Path;
use std::str::FromStr;
use tauri::AppHandle;
use tokio::fs;
use tokio::process::Child;

/// Lifecycle management logic
pub mod lifecycle;
/// OS-specific process monitoring
pub mod process;
/// Shared script module runtime management
pub mod script_runtime;

pub use self::lifecycle::LifecycleExecutor;

/// In-memory registry for active child processes.
static PROCESS_REGISTRY: std::sync::LazyLock<DashMap<String, Child>> =
    std::sync::LazyLock::new(DashMap::new);
const MODULE_PREVIEW_IMAGE_MAX_BYTES: u64 = 2 * 1024 * 1024;
const PREVIEW_TITLE_KEY: &str = "preview.title";
const PREVIEW_DESCRIPTION_KEY: &str = "preview.description";

/// High-level API for module control
#[derive(Debug)]
pub struct Controller {
    pub(crate) registry: &'static DashMap<String, Child>,
}

impl Default for Controller {
    fn default() -> Self {
        Self::new()
    }
}

impl Controller {
    /// Creates a new instance of the module controller.
    pub fn new() -> Self {
        Self {
            registry: &PROCESS_REGISTRY,
        }
    }

    /// Checks if a module is currently running (checking memory first, then PID file fallback)
    pub async fn is_running(&self, module_id: &str, module_path: &Path) -> bool {
        // 1. Check in-memory registry
        if let Some(child) = self.registry.get(module_id)
            && let Some(pid) = child.id()
            && process::is_running(pid as usize)
        {
            return true;
        }

        // 2. Fallback to PID file (e.g. if app restarted but module stayed alive)
        let pid_file = module_path.join("module.pid");
        if pid_file.exists()
            && let Ok(pid_str) = fs::read_to_string(&pid_file).await
            && let Ok(pid) = pid_str.trim().parse::<usize>()
            && process::is_running(pid)
        {
            return true;
        }

        false
    }

    /// Registers a new active child process
    pub fn register(&self, module_id: String, child: Child) {
        self.registry.insert(module_id, child);
    }

    /// Unregisters a process
    pub fn unregister(&self, module_id: &str) -> Option<Child> {
        self.registry.remove(module_id).map(|(_, child)| child)
    }
}

// ==================================================================================
// Public API Bridge
// ==================================================================================

/// Module control actions (start, stop, etc.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleAction {
    /// Start the module process
    Start,
    /// Stop the module process
    Stop,
    /// Stop and then start the module
    Restart,
    /// Run installation hooks
    Install,
    /// Cleanly remove module files
    Uninstall,
    /// Run update hooks
    Update,
}

impl FromStr for ModuleAction {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "start" => Ok(Self::Start),
            "stop" => Ok(Self::Stop),
            "restart" => Ok(Self::Restart),
            "install" => Ok(Self::Install),
            "uninstall" => Ok(Self::Uninstall),
            "update" => Ok(Self::Update),
            _ => Err(AppError::Validation(format!("Invalid action: {s}"))),
        }
    }
}

/// Scans installed integration packages.
pub async fn get_all_modules() -> Vec<Module> {
    let mut modules = Vec::new();
    let controller = Controller::new();

    if let Ok(mut entries) = fs::read_dir(&*crate::utils::paths::INTEGRATIONS_DIR).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(file_type) = entry.file_type().await
                && file_type.is_dir()
            {
                let id = entry.file_name().to_string_lossy().to_string();
                if downloader::validate_module_id(&id).is_err() {
                    continue;
                }
                let path = entry.path();

                let manifest = match module_lifecycle::ManifestLoader::load(&path) {
                    Ok(manifest) => manifest,
                    Err(error) => {
                        tracing::warn!(
                            integration_id = id,
                            path = %path.display(),
                            "Skipping integration without valid axelate-module.toml: {error}"
                        );
                        continue;
                    }
                };
                let module_id = manifest.id.clone();
                if downloader::validate_module_id(&module_id).is_err() {
                    tracing::warn!(
                        integration_id = module_id,
                        path = %path.display(),
                        "Skipping integration with invalid manifest id"
                    );
                    continue;
                }

                let preview = resolve_module_preview(&path, manifest.preview.clone()).await;
                let name = manifest.name;
                let description = manifest.description;
                let version = manifest.version;
                let author = manifest.author.unwrap_or_default();
                let category = manifest.category.unwrap_or_else(|| "service".to_string());
                let icon = manifest.icon.unwrap_or_default();
                let config_schema = manifest.config_schema;
                let settings_ui = manifest.settings_ui;

                let status = if controller.is_running(&module_id, &path).await {
                    "running".to_string()
                } else {
                    "stopped".to_string()
                };

                modules.push(Module {
                    id: module_id,
                    name,
                    description,
                    version,
                    author,
                    category,
                    icon,
                    preview,
                    path: path.to_string_lossy().to_string(),
                    installed: true,
                    local: true,
                    enabled: true,
                    status: Some(status),
                    is_deletable: true,
                    config: std::collections::HashMap::new(),
                    config_schema,
                    settings_ui,
                });
            }
        }
    }
    modules
}

/// Gets the runtime status of a specific module.
pub async fn get_module_status(module_id: &str) -> String {
    if downloader::validate_module_id(module_id).is_err() {
        return "stopped".to_string();
    }

    let controller = Controller::new();
    let module_path = downloader::get_module_path(module_id);
    if controller.is_running(module_id, &module_path).await {
        "running".to_string()
    } else {
        "stopped".to_string()
    }
}

async fn resolve_module_preview(
    module_path: &Path,
    preview: Option<ModulePreview>,
) -> Option<ModulePreview> {
    let mut preview = preview?;
    apply_localized_module_preview(module_path, &mut preview);
    let Some(image) = preview.image.as_deref().map(str::trim) else {
        return Some(preview);
    };
    if image.is_empty() || image.starts_with("data:") || image.starts_with("https://") {
        return Some(preview);
    }

    match read_module_preview_image(module_path, image).await {
        Ok(data_url) => {
            preview.image = Some(data_url);
        }
        Err(error) => {
            tracing::warn!(
                module_path = %module_path.display(),
                image,
                "Failed to load module preview image: {error}"
            );
            preview.image = None;
        }
    }

    Some(preview)
}

fn apply_localized_module_preview(module_path: &Path, preview: &mut ModulePreview) {
    let Some(i18n_dir) = preview
        .i18n
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if i18n_dir.contains("..") {
        tracing::warn!("Ignoring module preview i18n path with parent traversal");
        return;
    }

    let i18n_path = Path::new(i18n_dir);
    if i18n_path.is_absolute() {
        tracing::warn!("Ignoring absolute module preview i18n path");
        return;
    }

    let language = crate::infrastructure::config::settings::get_language_sync();
    let translations = load_preview_translations(module_path, i18n_path, &language)
        .or_else(|| load_preview_translations(module_path, i18n_path, "en"));
    let Some(translations) = translations else {
        return;
    };

    if let Some(title) = translations
        .get(PREVIEW_TITLE_KEY)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        preview.title = Some(title.to_string());
    }

    if let Some(description) = translations
        .get(PREVIEW_DESCRIPTION_KEY)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        preview.description = Some(description.to_string());
    }
}

fn load_preview_translations(
    module_path: &Path,
    i18n_path: &Path,
    language: &str,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let language = language.trim().to_ascii_lowercase();
    let safe_language = match language.as_str() {
        "en" | "ru" | "zh" => language,
        other if other.starts_with("en-") => "en".to_string(),
        other if other.starts_with("ru-") => "ru".to_string(),
        other if other.starts_with("zh-") => "zh".to_string(),
        _ => return None,
    };

    let path = module_path
        .join(i18n_path)
        .join(format!("{safe_language}.json"));
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Value>(&content)
        .ok()?
        .as_object()
        .cloned()
}

async fn read_module_preview_image(module_path: &Path, image: &str) -> Result<String, AppError> {
    let relative_path = Path::new(image);
    if relative_path.is_absolute() || image.contains("..") {
        return Err(AppError::Validation(
            "Preview image must be a relative module path".to_string(),
        ));
    }

    let image_path = module_path.join(relative_path);
    let metadata = fs::metadata(&image_path)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;
    if !metadata.is_file() || metadata.len() > MODULE_PREVIEW_IMAGE_MAX_BYTES {
        return Err(AppError::Validation(
            "Preview image is missing or too large".to_string(),
        ));
    }

    let mime = preview_image_mime(&image_path)?;
    let bytes = fs::read(&image_path)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn preview_image_mime(path: &Path) -> Result<&'static str, AppError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "webp" => Ok("image/webp"),
        "gif" => Ok("image/gif"),
        "svg" => Ok("image/svg+xml"),
        _ => Err(AppError::Validation(
            "Unsupported preview image format".to_string(),
        )),
    }
}

/// Main entry point for controlling module lifecycle actions.
pub async fn control(
    _app: AppHandle,
    module_id: &str,
    action: ModuleAction,
) -> Result<ControlResponse, AppError> {
    let controller = Controller::new();
    downloader::validate_module_id(module_id)?;
    let module_path = downloader::get_module_path(module_id);

    if action == ModuleAction::Uninstall {
        let executor = LifecycleExecutor::new(&controller, module_id.to_string(), &module_path);
        if let Ok(manifest) = module_lifecycle::ManifestLoader::load(&module_path) {
            executor.stop(&manifest).await?;
        } else {
            let pid_file = module_path.join("module.pid");
            if let Ok(pid_str) = std::fs::read_to_string(&pid_file)
                && let Ok(pid) = pid_str.trim().parse::<usize>()
            {
                process::kill_orphan(pid).map_err(|error| AppError::Internal {
                    request_id: None,
                    message: format!(
                        "Failed to stop module {module_id} from PID file before uninstall: {error}"
                    ),
                })?;
            }
        }
        downloader::delete_module(module_id).await?;
        crate::domain::integration_api::revoke_module_api_token(module_id);
        return Ok(ControlResponse {
            success: true,
            message: format!("Module {module_id} uninstalled successfully"),
            status: None,
        });
    }

    if !module_path.exists() {
        return Err(AppError::NotFound(format!("Module {module_id} not found")));
    }

    let manifest = module_lifecycle::ManifestLoader::load(&module_path)?;
    let executor = LifecycleExecutor::new(&controller, module_id.to_string(), &module_path);

    match action {
        ModuleAction::Start => executor.start(&manifest).await,
        ModuleAction::Stop => executor.stop(&manifest).await,
        ModuleAction::Restart => {
            tracing::info!("Restarting module: {module_id}");
            executor.stop(&manifest).await?;

            // Wait for it to actually die (up to 5s) with survival check
            let mut terminated = false;
            for attempt in 0..20 {
                if !controller.is_running(module_id, &module_path).await {
                    terminated = true;
                    tracing::info!(
                        "Module {module_id} terminated after {attempt} attempts during restart"
                    );
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }

            if !terminated {
                return Err(AppError::Internal {
                    request_id: None,
                    message: format!("Module {module_id} failed to terminate during restart"),
                });
            }

            executor.start(&manifest).await
        }
        _ => Ok(ControlResponse {
            success: false,
            message: "Not implemented".to_string(),
            status: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::{
        ModuleAction, apply_localized_module_preview, load_preview_translations,
        preview_image_mime, read_module_preview_image, resolve_module_preview,
    };
    use crate::models::modules::ModulePreview;
    use std::str::FromStr;

    #[test]
    fn module_action_parses_supported_actions_case_insensitively() {
        assert_eq!(
            ModuleAction::from_str("start").unwrap(),
            ModuleAction::Start
        );
        assert_eq!(ModuleAction::from_str("STOP").unwrap(), ModuleAction::Stop);
        assert_eq!(
            ModuleAction::from_str("Restart").unwrap(),
            ModuleAction::Restart
        );
        assert_eq!(
            ModuleAction::from_str("install").unwrap(),
            ModuleAction::Install
        );
        assert_eq!(
            ModuleAction::from_str("uninstall").unwrap(),
            ModuleAction::Uninstall
        );
        assert_eq!(
            ModuleAction::from_str("update").unwrap(),
            ModuleAction::Update
        );
        assert!(ModuleAction::from_str("delete").is_err());
    }

    #[test]
    fn preview_image_mime_accepts_supported_extensions() {
        assert_eq!(
            preview_image_mime(std::path::Path::new("card.PNG")).unwrap(),
            "image/png"
        );
        assert_eq!(
            preview_image_mime(std::path::Path::new("card.jpg")).unwrap(),
            "image/jpeg"
        );
        assert_eq!(
            preview_image_mime(std::path::Path::new("card.jpeg")).unwrap(),
            "image/jpeg"
        );
        assert_eq!(
            preview_image_mime(std::path::Path::new("card.webp")).unwrap(),
            "image/webp"
        );
        assert_eq!(
            preview_image_mime(std::path::Path::new("card.gif")).unwrap(),
            "image/gif"
        );
        assert_eq!(
            preview_image_mime(std::path::Path::new("card.svg")).unwrap(),
            "image/svg+xml"
        );
        assert!(preview_image_mime(std::path::Path::new("card.txt")).is_err());
    }

    #[tokio::test]
    async fn read_module_preview_image_returns_data_url_and_rejects_unsafe_paths() {
        let temp = tempfile::tempdir().unwrap();
        let image_path = temp.path().join("preview.png");
        tokio::fs::write(&image_path, b"png-bytes").await.unwrap();

        let data_url = read_module_preview_image(temp.path(), "preview.png")
            .await
            .unwrap();

        assert_eq!(data_url, "data:image/png;base64,cG5nLWJ5dGVz");
        assert!(
            read_module_preview_image(temp.path(), "../preview.png")
                .await
                .is_err()
        );
        assert!(
            read_module_preview_image(temp.path(), "missing.png")
                .await
                .is_err()
        );
        assert!(
            read_module_preview_image(temp.path(), "preview.txt")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn read_module_preview_image_rejects_large_files_and_directories() {
        let temp = tempfile::tempdir().unwrap();
        let large_path = temp.path().join("large.png");
        let dir_path = temp.path().join("dir.png");
        tokio::fs::write(&large_path, vec![0_u8; 2 * 1024 * 1024 + 1])
            .await
            .unwrap();
        tokio::fs::create_dir(&dir_path).await.unwrap();

        assert!(
            read_module_preview_image(temp.path(), "large.png")
                .await
                .is_err()
        );
        assert!(
            read_module_preview_image(temp.path(), "dir.png")
                .await
                .is_err()
        );
    }

    #[test]
    fn load_preview_translations_accepts_supported_language_prefixes() {
        let temp = tempfile::tempdir().unwrap();
        let i18n = temp.path().join("i18n");
        std::fs::create_dir(&i18n).unwrap();
        std::fs::write(
            i18n.join("ru.json"),
            r#"{"preview.title":"Ru title","preview.description":"Ru description"}"#,
        )
        .unwrap();

        let translations =
            load_preview_translations(temp.path(), std::path::Path::new("i18n"), "ru-BY").unwrap();

        assert_eq!(
            translations
                .get("preview.title")
                .and_then(serde_json::Value::as_str),
            Some("Ru title")
        );
        assert!(
            load_preview_translations(temp.path(), std::path::Path::new("i18n"), "fr").is_none()
        );
    }

    #[test]
    fn apply_localized_module_preview_ignores_unsafe_i18n_paths() {
        let temp = tempfile::tempdir().unwrap();
        let mut traversal = ModulePreview {
            title: Some("Original".to_string()),
            i18n: Some("../i18n".to_string()),
            ..ModulePreview::default()
        };
        let mut absolute = ModulePreview {
            title: Some("Original".to_string()),
            i18n: Some(temp.path().to_string_lossy().to_string()),
            ..ModulePreview::default()
        };

        apply_localized_module_preview(temp.path(), &mut traversal);
        apply_localized_module_preview(temp.path(), &mut absolute);

        assert_eq!(traversal.title.as_deref(), Some("Original"));
        assert_eq!(absolute.title.as_deref(), Some("Original"));
    }

    #[tokio::test]
    async fn resolve_module_preview_keeps_external_images_and_embeds_local_images() {
        let temp = tempfile::tempdir().unwrap();
        let i18n = temp.path().join("i18n");
        std::fs::create_dir(&i18n).unwrap();
        std::fs::write(
            i18n.join("en.json"),
            r#"{"preview.title":"Localized","preview.description":"Localized description"}"#,
        )
        .unwrap();
        tokio::fs::write(temp.path().join("preview.svg"), b"<svg/>")
            .await
            .unwrap();

        let embedded = resolve_module_preview(
            temp.path(),
            Some(ModulePreview {
                title: Some("Original".to_string()),
                description: None,
                image: Some("preview.svg".to_string()),
                i18n: Some("i18n".to_string()),
                ..ModulePreview::default()
            }),
        )
        .await
        .unwrap();
        let external = resolve_module_preview(
            temp.path(),
            Some(ModulePreview {
                image: Some("https://example.test/card.png".to_string()),
                ..ModulePreview::default()
            }),
        )
        .await
        .unwrap();

        assert_eq!(embedded.title.as_deref(), Some("Localized"));
        assert_eq!(
            embedded.description.as_deref(),
            Some("Localized description")
        );
        assert_eq!(
            embedded.image.as_deref(),
            Some("data:image/svg+xml;base64,PHN2Zy8+")
        );
        assert_eq!(
            external.image.as_deref(),
            Some("https://example.test/card.png")
        );
        assert!(resolve_module_preview(temp.path(), None).await.is_none());
    }
}
