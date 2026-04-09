use crate::app::window::{create_main_window, show_and_focus_window};
use crate::domain::ai::{
    self, ChatSessionManager, ai_service,
    ai_service::{ChatRequest, ChatResponse},
};
use crate::domain::ai::{ChannelSink, StreamEvent, StreamSink};
use crate::domain::engine::manager::EngineManager;
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use crate::infrastructure::config::ui_state::UiStateService;
use crate::infrastructure::crypto::secure_storage::SecureStorage;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::Emitter;
use tauri::{Manager, State, Window};
use tokio::sync::mpsc;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
    IDispatch,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Variant::VARIANT;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{IShellWindows, IWebBrowser2, ShellWindows};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{SW_RESTORE, SetForegroundWindow, ShowWindow};
#[cfg(target_os = "windows")]
use windows::core::Interface;

/// Result of saving a generated chat image to disk.
#[derive(Debug, serde::Serialize, specta::Type)]
pub struct SavedChatImage {
    /// Absolute path to the saved image file.
    file_path: String,
    /// Absolute path to the folder containing the saved image.
    folder_path: String,
}

fn chat_image_root_dir() -> Result<PathBuf, AppError> {
    let picture_dir = dirs::picture_dir()
        .ok_or_else(|| AppError::NotFound("Pictures directory is unavailable".to_string()))?;
    Ok(picture_dir.join("axelate"))
}

fn map_path_error(path: &Path, message: &str, error: &std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::NotFound {
        return AppError::NotFound(format!("{message}: {}", path.display()));
    }

    AppError::Io(format!("{message}: {} ({error})", path.display()))
}

fn resolve_existing_path_within_root(
    candidate: &Path,
    root: &Path,
    not_found_message: &str,
) -> Result<PathBuf, AppError> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| map_path_error(root, "Image directory is unavailable", &error))?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| map_path_error(candidate, not_found_message, &error))?;

    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(AppError::Validation(format!(
            "Path is outside chat image directory: {}",
            candidate.display()
        )));
    }

    Ok(canonical_candidate)
}

#[derive(Debug, Clone, serde::Serialize)]
struct StreamChunkPayload {
    request_id: String,
    message_id: String,
    content: String,
}

#[tauri::command]
#[specta::specta]
/// Sends a chat message to the AI provider and streams the response
pub async fn send_chat_message(
    window: Window,
    request: ChatRequest,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<ChatResponse, AppError> {
    let mut request = request;
    let request_id = request
        .request_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    request.request_id = Some(request_id.clone());

    if !is_local_provider(&request.provider)
        && request
            .api_key
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        request.api_key = SecureStorage::get_key_async("openrouter_api_key".to_string()).await?;
    }

    let sink = create_window_stream_sink(window, request_id);
    ai_service::process_chat_request(request, &sessions, &config_service, &engine_manager, sink)
        .await
}

#[tauri::command]
#[specta::specta]
/// Validates an API key for the specified provider
pub async fn validate_api_key(provider: String, key: String) -> Result<bool, AppError> {
    ai_service::validate_api_key(provider, key).await
}

#[tauri::command]
#[specta::specta]
/// Validates the stored OpenRouter API key without exposing it to the frontend
pub async fn validate_stored_api_key(provider: String) -> Result<bool, AppError> {
    let key = SecureStorage::get_key_async("openrouter_api_key".to_string()).await?;
    if let Some(key) = key
        && !key.trim().is_empty()
    {
        return ai_service::validate_api_key(provider, key).await;
    }

    Ok(false)
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Clears chat history for a specific session
pub fn clear_chat_history(
    session_id: &str,
    sessions: State<'_, Arc<ChatSessionManager>>,
) -> Result<(), AppError> {
    sessions.clear_chat_history(session_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Retrieves chat history for a specific session
pub fn get_chat_history(
    session_id: &str,
    sessions: State<'_, Arc<ChatSessionManager>>,
) -> Result<Vec<ai::ChatMessage>, AppError> {
    Ok(sessions.get_chat_history(session_id))
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Removes the latest user turn and any following assistant replies from a session.
pub async fn rewind_last_turn(
    session_id: &str,
    sessions: State<'_, Arc<ChatSessionManager>>,
) -> Result<Option<String>, AppError> {
    let removed = sessions.rewind_last_turn(session_id);
    let _ = sessions.force_save().await;
    Ok(removed)
}

#[tauri::command]
#[specta::specta]
/// Counts tokens in text for the specified model
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned types for serialization
pub async fn count_tokens(text: String, model: Option<String>) -> Result<u32, String> {
    tokio::task::spawn_blocking(move || {
        ai_service::count_tokens(&text, model.as_deref())
            .and_then(|c| u32::try_from(c).map_err(|_| "token count overflow".to_string()))
    })
    .await
    .map_err(|e| format!("Task joined with error: {e}"))?
}

#[tauri::command]
#[specta::specta]
/// Sends an image generation request to the connected AI provider
pub async fn generate_image(
    request: ai::ImageGenerationRequest,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
    settings_service: State<'_, crate::infrastructure::config::settings::SettingsService>,
) -> Result<ai::ImageGenerationResponse, AppError> {
    ai_service::process_image_request(
        request,
        &sessions,
        &config_service,
        &engine_manager,
        settings_service.inner(),
    )
    .await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
/// Starts image generation as a detached backend task and restores the window on completion.
pub async fn generate_image_background(
    app: tauri::AppHandle,
    _window: Window,
    request: ai::ImageGenerationRequest,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
    settings_service: State<'_, crate::infrastructure::config::settings::SettingsService>,
    ui_state_service: State<'_, UiStateService>,
) -> Result<(), AppError> {
    let sessions = Arc::clone(&*sessions);
    let config_service = Arc::clone(&*config_service);
    let engine_manager = Arc::clone(&*engine_manager);
    let settings_service = settings_service.inner().clone();
    let ui_state_service = ui_state_service.inner().clone();
    let app_handle = app;

    tauri::async_runtime::spawn(async move {
        crate::app::tray::set_background_generation_active(&app_handle, "Generating image...");
        let result = ai_service::process_image_request(
            request,
            &sessions,
            &config_service,
            &engine_manager,
            &settings_service,
        )
        .await;

        if let Err(error) = &result {
            tracing::error!("Background image generation failed: {error}");
        }

        let mut ui_state = ui_state_service.get_ui_state().await.unwrap_or_default();
        ui_state.last_page = Some("chat".to_string());
        ui_state.pending_chat_reveal = true;
        let _ = ui_state_service.save_ui_state(&ui_state).await;

        crate::app::tray::clear_background_generation(&app_handle);

        if let Some(window) = app_handle.get_webview_window("main") {
            show_and_focus_window(&window);
        } else if let Some(window) = create_main_window(&app_handle) {
            show_and_focus_window(&window);
        }
    });

    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Saves a chat image to the default Pictures/axelate directory and returns the final path.
pub fn save_chat_image_default(
    base64_data: String,
    mime_type: String,
) -> Result<SavedChatImage, AppError> {
    let target_dir = chat_image_root_dir()?;
    std::fs::create_dir_all(&target_dir)?;

    let ext = match mime_type.to_ascii_lowercase().as_str() {
        mime if mime.contains("jpeg") || mime.contains("jpg") => "jpg",
        mime if mime.contains("webp") => "webp",
        mime if mime.contains("gif") => "gif",
        _ => "png",
    };

    let payload = base64_data
        .split_once(',')
        .map_or(base64_data.as_str(), |(_, data)| data);
    let bytes = STANDARD
        .decode(payload)
        .map_err(|e| AppError::Validation(format!("Invalid image data: {e}")))?;

    let file_name = format!(
        "axelate_image_{}.{}",
        chrono::Local::now().format("%Y%m%d_%H%M%S_%3f"),
        ext
    );
    let file_path = target_dir.join(file_name);
    std::fs::write(&file_path, bytes)?;

    Ok(SavedChatImage {
        file_path: file_path.to_string_lossy().into_owned(),
        folder_path: target_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Deletes a previously saved chat image from disk.
pub fn delete_chat_image(file_path: String) -> Result<(), AppError> {
    let file = PathBuf::from(&file_path);
    if !file.exists() {
        return Ok(());
    }

    let target_dir = chat_image_root_dir()?;
    let file = resolve_existing_path_within_root(&file, &target_dir, "Saved image does not exist")?;

    if !file.is_file() {
        return Err(AppError::Validation(format!(
            "Path is not a file: {}",
            file.display()
        )));
    }

    std::fs::remove_file(&file)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Opens the saved chat image folder in the system file manager.
pub fn open_chat_image_location(file_path: String, folder_path: String) -> Result<(), AppError> {
    let requested_file = PathBuf::from(&file_path);
    let requested_folder = PathBuf::from(&folder_path);
    let open_folder_only = requested_file == requested_folder || requested_file.is_dir();
    let target_dir = chat_image_root_dir()?;

    let file = if open_folder_only {
        let folder = resolve_existing_path_within_root(
            &requested_folder,
            &target_dir,
            "Image folder does not exist",
        )?;

        if !folder.is_dir() {
            return Err(AppError::Validation(format!(
                "Path is not a directory: {}",
                folder.display()
            )));
        }

        folder
    } else {
        let file = resolve_existing_path_within_root(
            &requested_file,
            &target_dir,
            "Saved image does not exist",
        )?;

        if !file.is_file() {
            return Err(AppError::Validation(format!(
                "Path is not a file: {}",
                file.display()
            )));
        }

        file
    };

    let path = if open_folder_only {
        file
    } else {
        file.parent()
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "Image file has no parent directory: {}",
                    file.display()
                ))
            })?
            .to_path_buf()
    };

    #[cfg(target_os = "windows")]
    {
        if try_activate_existing_explorer_window(&path)? {
            return Ok(());
        }
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(&path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R");
        command.arg(&file);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&path);
        command
    };

    command.spawn().map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::resolve_existing_path_within_root;
    use crate::errors::AppError;

    #[test]
    fn resolve_existing_path_within_root_allows_file_inside_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("axelate");
        std::fs::create_dir_all(&root).expect("create root");
        let file = root.join("image.png");
        std::fs::write(&file, b"png").expect("write file");

        let resolved = resolve_existing_path_within_root(&file, &root, "missing file")
            .expect("path should resolve");

        assert_eq!(
            resolved,
            file.canonicalize().expect("canonical file should exist")
        );
    }

    #[test]
    fn resolve_existing_path_within_root_rejects_path_outside_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("axelate");
        std::fs::create_dir_all(&root).expect("create root");
        let outside = temp_dir.path().join("outside.png");
        std::fs::write(&outside, b"png").expect("write outside file");

        let error = resolve_existing_path_within_root(&outside, &root, "missing file")
            .expect_err("outside path must be rejected");

        assert!(
            matches!(error, AppError::Validation(message) if message.contains("outside chat image directory"))
        );
    }
}

#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
fn try_activate_existing_explorer_window(
    target_folder: &std::path::Path,
) -> Result<bool, AppError> {
    let coinit = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let should_uninitialize = coinit.is_ok();
    if let Err(err) = coinit.ok() {
        const RPC_E_CHANGED_MODE: windows::core::HRESULT =
            windows::core::HRESULT(0x8001_0106u32.cast_signed());
        if err.code() != RPC_E_CHANGED_MODE {
            return Err(AppError::External {
                request_id: None,
                message: format!("Explorer COM initialization failed: {err}"),
            });
        }
    }

    let result = (|| {
        let shell_windows: IShellWindows = unsafe {
            CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)
        }
        .map_err(|err| AppError::External {
            request_id: None,
            message: format!("Failed to access ShellWindows: {err}"),
        })?;

        let count = unsafe { shell_windows.Count() }.map_err(|err| AppError::External {
            request_id: None,
            message: format!("Failed to enumerate Explorer windows: {err}"),
        })?;

        let target_url = normalize_windows_explorer_url(&folder_path_to_file_url(target_folder));

        for index in 0..count {
            let variant_index: VARIANT = index.into();
            let dispatch: IDispatch = match unsafe { shell_windows.Item(&variant_index) } {
                Ok(dispatch) => dispatch,
                Err(_) => continue,
            };

            let browser: IWebBrowser2 = match dispatch.cast() {
                Ok(browser) => browser,
                Err(_) => continue,
            };

            let current_url = match unsafe { browser.LocationURL() } {
                Ok(url) => normalize_windows_explorer_url(&url.to_string()),
                Err(_) => continue,
            };

            if current_url != target_url {
                continue;
            }

            let hwnd_value = unsafe { browser.HWND() }.map_err(|err| AppError::External {
                request_id: None,
                message: format!("Failed to get Explorer window handle: {err}"),
            })?;
            let hwnd = HWND(hwnd_value.0 as *mut core::ffi::c_void);

            unsafe {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
            return Ok(true);
        }

        Ok(false)
    })();

    if should_uninitialize {
        unsafe { CoUninitialize() };
    }

    result
}

#[cfg(target_os = "windows")]
fn folder_path_to_file_url(path: &std::path::Path) -> String {
    let mut url = String::from("file:///");
    let display = path.to_string_lossy().replace('\\', "/");
    url.push_str(&display);
    if !url.ends_with('/') {
        url.push('/');
    }
    url
}

#[cfg(target_os = "windows")]
fn normalize_windows_explorer_url(url: &str) -> String {
    let without_scheme = url
        .strip_prefix("file:///")
        .or_else(|| url.strip_prefix("file://"))
        .unwrap_or(url);

    let path = without_scheme.replace('/', "\\");
    let decoded = percent_decode_path(&path);
    decoded.trim_end_matches('\\').to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn percent_decode_path(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut result = String::with_capacity(value.len());
    let mut index = 0;

    while index < bytes.len() {
        let Some(&byte) = bytes.get(index) else {
            break;
        };

        if byte == b'%' {
            let next_index = index + 3;
            if let Some(hex) = value.get(index + 1..next_index) {
                if let Ok(parsed) = u8::from_str_radix(hex, 16) {
                    result.push(parsed as char);
                    index = next_index;
                    continue;
                }
            }
        }

        result.push(byte as char);
        index += 1;
    }

    result
}

fn create_window_stream_sink(window: Window, request_id: String) -> Arc<dyn StreamSink> {
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
    let sink: Arc<dyn StreamSink> = Arc::new(ChannelSink::new(tx));

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::ChatChunk {
                    message_id,
                    content,
                } => {
                    let _ = window.emit(
                        "ai:chat:chunk",
                        StreamChunkPayload {
                            request_id: request_id.clone(),
                            message_id,
                            content,
                        },
                    );
                }
                StreamEvent::ThoughtChunk {
                    message_id,
                    content,
                } => {
                    let _ = window.emit(
                        "ai:thought:chunk",
                        StreamChunkPayload {
                            request_id: request_id.clone(),
                            message_id,
                            content,
                        },
                    );
                }
                StreamEvent::Done { usage, .. } => {
                    let _ = window.emit("ai:chat:done", usage);
                }
            }
        }
    });

    sink
}

fn is_local_provider(provider: &str) -> bool {
    !matches!(
        provider,
        "gpt"
            | "gemini"
            | "openai"
            | "openrouter"
            | "anthropic"
            | "mistral"
            | "claude"
            | "deepseek"
    )
}
