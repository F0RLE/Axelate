use crate::domain::ai::{
    self, ChatSessionManager, ai_service,
    ai_service::{ChatRequest, ChatResponse},
};
use crate::domain::ai::{StreamEvent, StreamSink};
use crate::domain::engine::manager::EngineManager;
use crate::domain::engine::types::Capability;
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use crate::infrastructure::crypto::secure_storage::SecureStorage;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use dashmap::DashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::oneshot;

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

/// Live preview payload for in-progress image generation.
#[derive(Debug, serde::Serialize, specta::Type)]
pub struct ImageGenerationPreview {
    /// Data URL of the latest preview image.
    data_url: String,
    /// File modification timestamp in Unix milliseconds.
    updated_at_ms: f64,
    /// Current image-generation progress, normalized to 0.0..1.0 when the engine exposes it.
    progress: Option<f32>,
    /// Current sampling step when available.
    step: Option<u32>,
    /// Total sampling steps when available.
    total: Option<u32>,
    /// Latest reported generation speed when available, for example `1.07s/it`.
    speed: Option<String>,
    /// Estimated remaining seconds when the engine exposes it.
    eta_relative: Option<f32>,
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

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
/// Kind of streaming payload delivered to frontend chat channels.
pub enum StreamPayloadKind {
    /// A visible assistant text fragment.
    ChatChunk,
    /// A reasoning/thinking text fragment.
    ThoughtChunk,
    /// End-of-stream marker after all chunks have been delivered.
    Done,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
/// Streaming payload delivered from the backend to the frontend chat channels.
pub struct StreamChunkPayload {
    /// Correlates the chunk with the originating frontend request.
    pub request_id: String,
    /// Identifies the assistant message currently being streamed.
    pub message_id: String,
    /// Describes how the frontend should handle this stream event.
    pub kind: StreamPayloadKind,
    /// The incremental text fragment emitted by the model.
    pub content: String,
}

#[derive(Clone)]
struct TauriStreamSink {
    request_id: String,
    chat_channel: Channel<StreamChunkPayload>,
    thought_channel: Channel<StreamChunkPayload>,
}

#[derive(Debug, Default)]
/// Tracks active chat requests that can be cancelled by the frontend.
pub struct ChatCancellationRegistry {
    requests: DashMap<String, oneshot::Sender<()>>,
}

impl ChatCancellationRegistry {
    fn register(&self, request_id: &str) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        if let Some(old_tx) = self.requests.insert(request_id.to_string(), tx) {
            let _ = old_tx.send(());
        }
        rx
    }

    fn cancel(&self, request_id: &str) -> bool {
        self.requests
            .remove(request_id)
            .is_some_and(|(_, tx)| tx.send(()).is_ok())
    }

    fn clear(&self, request_id: &str) {
        self.requests.remove(request_id);
    }
}

impl StreamSink for TauriStreamSink {
    fn emit(&self, event: StreamEvent) {
        match event {
            StreamEvent::ChatChunk {
                message_id,
                content,
            } => {
                let payload = StreamChunkPayload {
                    request_id: self.request_id.clone(),
                    message_id,
                    kind: StreamPayloadKind::ChatChunk,
                    content,
                };
                let _ = self.chat_channel.send(payload);
            }
            StreamEvent::ThoughtChunk {
                message_id,
                content,
            } => {
                let payload = StreamChunkPayload {
                    request_id: self.request_id.clone(),
                    message_id,
                    kind: StreamPayloadKind::ThoughtChunk,
                    content,
                };
                let _ = self.thought_channel.send(payload);
            }
            StreamEvent::Done { message_id, .. } => {
                let payload = StreamChunkPayload {
                    request_id: self.request_id.clone(),
                    message_id,
                    kind: StreamPayloadKind::Done,
                    content: String::new(),
                };
                let _ = self.chat_channel.send(payload);
            }
        }
    }
}

fn ensure_request_id(request: &mut ChatRequest) -> String {
    let request_id = request
        .request_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    request.request_id = Some(request_id.clone());
    request_id
}

fn normalize_secret_service_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn configured_provider_secret_service(
    config_service: &ConfigService,
    provider: &str,
) -> Option<String> {
    let provider = provider.trim();
    if provider.is_empty() {
        return None;
    }

    if let Ok(config) = config_service.load_full_config()
        && let Some(provider_config) = config
            .api_providers
            .iter()
            .find(|candidate| candidate.id == provider)
    {
        return Some(normalize_secret_service_name(
            provider_config
                .api_key_env
                .as_deref()
                .unwrap_or("openrouter_api_key"),
        ));
    }

    default_secret_service_for_provider(provider)
}

fn default_secret_service_for_provider(provider: &str) -> Option<String> {
    if is_local_provider(provider) {
        return None;
    }

    Some("openrouter_api_key".to_string())
}

async fn load_stored_provider_api_key(
    config_service: &ConfigService,
    provider: &str,
) -> Result<Option<String>, AppError> {
    let Some(service) = configured_provider_secret_service(config_service, provider) else {
        return Ok(None);
    };

    let key = SecureStorage::get_key_async(service).await?;
    Ok(key.filter(|value| !value.trim().is_empty()))
}

pub(crate) async fn fill_chat_request_api_key(
    request: &mut ChatRequest,
    config_service: &ConfigService,
) -> Result<(), AppError> {
    if request
        .api_key
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        request.api_key = load_stored_provider_api_key(config_service, &request.provider).await?;
    }

    Ok(())
}

async fn cancel_comfyui_job(
    provider: &str,
    image_generation_state: &crate::domain::ai::ImageGenerationState,
) -> Result<(), AppError> {
    if let Some(job) = image_generation_state.cancel(provider).await {
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/interrupt", job.base_url.trim_end_matches('/')))
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::External {
                request_id: None,
                message: format!("Failed to interrupt ComfyUI job: {body}"),
            });
        }
    }

    Ok(())
}

async fn cancel_sdcpp_job(
    provider: &str,
    engine_manager: &EngineManager,
    image_generation_state: &crate::domain::ai::ImageGenerationState,
) -> Result<(), AppError> {
    let mut should_stop_engine = true;

    if let Some(job) = image_generation_state.cancel(provider).await
        && let Some(job_id) = job.prompt_id
    {
        let client = reqwest::Client::new();
        let response = client
            .post(format!(
                "{}/sdcpp/v1/jobs/{job_id}/cancel",
                job.base_url.trim_end_matches('/')
            ))
            .send()
            .await?;

        should_stop_engine = !response.status().is_success();
        if should_stop_engine && response.status().as_u16() != 409 {
            let body = response.text().await.unwrap_or_default();
            tracing::warn!("Failed to cancel stable-diffusion.cpp job via native API: {body}");
        }
    }

    if should_stop_engine {
        engine_manager.stop_slot(Capability::Image).await?;
    }

    Ok(())
}

fn read_image_generation_preview_file(path: &Path) -> Option<ImageGenerationPreview> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            tracing::debug!("Failed to stat preview file {}: {error}", path.display());
            return None;
        }
    };

    if !metadata.is_file() || metadata.len() == 0 {
        return None;
    }

    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            tracing::debug!("Failed to read preview file {}: {error}", path.display());
            return None;
        }
    };

    let updated_at_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |duration| duration.as_secs_f64() * 1000.0);

    Some(ImageGenerationPreview {
        data_url: format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
        updated_at_ms,
        progress: None,
        step: None,
        total: None,
        speed: None,
        eta_relative: None,
    })
}

fn image_extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type.to_ascii_lowercase().as_str() {
        mime if mime.contains("jpeg") || mime.contains("jpg") => "jpg",
        mime if mime.contains("webp") => "webp",
        mime if mime.contains("gif") => "gif",
        _ => "png",
    }
}

fn decode_chat_image_payload(base64_data: &str) -> Result<Vec<u8>, AppError> {
    let payload = base64_data
        .split_once(',')
        .map_or(base64_data, |(_, data)| data);
    STANDARD
        .decode(payload)
        .map_err(|error| AppError::Validation(format!("Invalid image data: {error}")))
}

fn build_chat_image_file_path(target_dir: &Path, ext: &str) -> PathBuf {
    let file_name = format!(
        "axelate_image_{}.{}",
        chrono::Local::now().format("%Y%m%d_%H%M%S_%3f"),
        ext
    );
    target_dir.join(file_name)
}

fn resolve_chat_image_path(path: &Path, expected_kind: &str) -> Result<PathBuf, AppError> {
    let target_dir = chat_image_root_dir()?;
    let resolved = resolve_existing_path_within_root(path, &target_dir, expected_kind)?;

    match expected_kind {
        "Image folder does not exist" if !resolved.is_dir() => Err(AppError::Validation(format!(
            "Path is not a directory: {}",
            resolved.display()
        ))),
        "Saved image does not exist" if !resolved.is_file() => Err(AppError::Validation(format!(
            "Path is not a file: {}",
            resolved.display()
        ))),
        _ => Ok(resolved),
    }
}

fn resolve_image_open_target(
    requested_file: &Path,
    requested_folder: &Path,
) -> Result<(PathBuf, bool), AppError> {
    let open_folder_only = requested_file == requested_folder || requested_file.is_dir();
    if open_folder_only {
        return resolve_chat_image_path(requested_folder, "Image folder does not exist")
            .map(|path| (path, true));
    }

    resolve_chat_image_path(requested_file, "Saved image does not exist").map(|path| (path, false))
}

fn image_open_directory(path: &Path, folder_only: bool) -> Result<PathBuf, AppError> {
    if folder_only {
        return Ok(path.to_path_buf());
    }

    path.parent().map(Path::to_path_buf).ok_or_else(|| {
        AppError::Validation(format!(
            "Image file has no parent directory: {}",
            path.display()
        ))
    })
}

#[tauri::command]
#[specta::specta]
/// Sends a chat message to the AI provider and streams the response
#[allow(clippy::too_many_arguments)]
pub async fn send_chat_message(
    request: ChatRequest,
    chat_channel: Channel<StreamChunkPayload>,
    thought_channel: Channel<StreamChunkPayload>,
    sessions: State<'_, Arc<ChatSessionManager>>,
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
    settings_service: State<'_, crate::infrastructure::config::settings::SettingsService>,
    cancellation_registry: State<'_, ChatCancellationRegistry>,
) -> Result<ChatResponse, AppError> {
    let mut request = request;
    let request_id = ensure_request_id(&mut request);
    let model = request.model.clone();
    let cancellation = cancellation_registry.register(&request_id);
    if let Err(error) = fill_chat_request_api_key(&mut request, &config_service).await {
        cancellation_registry.clear(&request_id);
        return Err(error);
    }

    let sink = create_stream_sink(request_id.clone(), chat_channel, thought_channel);
    let cancel_sink = Arc::clone(&sink);

    let result = tokio::select! {
        result = ai_service::process_chat_request(
            request,
            &sessions,
            &config_service,
            &engine_manager,
            settings_service.inner(),
            sink,
        ) => result,
        _ = cancellation => {
            tracing::info!(request_id = %request_id, "AI request cancelled by frontend");
            cancel_sink.emit(StreamEvent::Done {
                message_id: request_id.clone(),
                usage: None,
            });
            Ok(ChatResponse {
                id: request_id.clone(),
                ok: false,
                reply: None,
                error: Some("AI request cancelled".to_string()),
                model: Some(model),
                thought_signature: None,
                usage: None,
            })
        }
    };

    cancellation_registry.clear(&request_id);
    result
}

#[tauri::command]
#[specta::specta]
/// Cancels an active streamed chat request by request identifier.
#[allow(clippy::needless_pass_by_value)]
pub fn cancel_chat_generation(
    request_id: String,
    cancellation_registry: State<'_, ChatCancellationRegistry>,
) -> bool {
    cancellation_registry.cancel(&request_id)
}

#[tauri::command]
#[specta::specta]
/// Validates an API key for the specified provider
pub async fn validate_api_key(provider: String, key: String) -> Result<bool, AppError> {
    ai_service::validate_api_key(provider, key).await
}

#[tauri::command]
#[specta::specta]
/// Validates the stored provider key without exposing it to the frontend
pub async fn validate_stored_api_key(
    provider: String,
    config_service: State<'_, Arc<ConfigService>>,
) -> Result<bool, AppError> {
    if let Some(key) = load_stored_provider_api_key(&config_service, &provider).await? {
        return ai_service::validate_api_key(provider, key).await;
    }

    Ok(false)
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
/// Clears chat history for a specific session
pub async fn clear_chat_history(
    session_id: &str,
    sessions: State<'_, Arc<ChatSessionManager>>,
) -> Result<(), AppError> {
    sessions.clear_chat_history(session_id);
    let _ = sessions.force_save().await;
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
    image_generation_state: State<'_, Arc<crate::domain::ai::ImageGenerationState>>,
    settings_service: State<'_, crate::infrastructure::config::settings::SettingsService>,
) -> Result<ai::ImageGenerationResponse, AppError> {
    ai_service::process_image_request(
        request,
        &sessions,
        &config_service,
        &engine_manager,
        &image_generation_state,
        settings_service.inner(),
    )
    .await
}

#[tauri::command]
#[specta::specta]
/// Cancels the current image generation request for the selected provider.
pub async fn cancel_image_generation(
    provider: String,
    engine_manager: State<'_, Arc<EngineManager>>,
    image_generation_state: State<'_, Arc<crate::domain::ai::ImageGenerationState>>,
) -> Result<(), AppError> {
    if provider == "comfyui" {
        return cancel_comfyui_job(&provider, &image_generation_state).await;
    }
    if matches!(provider.as_str(), "sdcpp" | "stable-diffusion") {
        return cancel_sdcpp_job(&provider, &engine_manager, &image_generation_state).await;
    }

    engine_manager.stop_slot(Capability::Image).await
}

#[tauri::command]
#[specta::specta]
/// Returns the latest image-generation preview when the local image engine writes one.
pub async fn get_image_generation_preview(
    engine_manager: State<'_, Arc<EngineManager>>,
    image_generation_state: State<'_, Arc<crate::domain::ai::ImageGenerationState>>,
) -> Result<Option<ImageGenerationPreview>, AppError> {
    let log_progress = image_generation_state.latest_progress("sdcpp").await;
    let merged_progress = log_progress.as_ref().and_then(|snapshot| snapshot.progress);
    let step = log_progress.as_ref().and_then(|snapshot| snapshot.step);
    let total = log_progress.as_ref().and_then(|snapshot| snapshot.total);
    let speed = log_progress
        .as_ref()
        .and_then(|snapshot| snapshot.speed.clone());
    let has_status =
        merged_progress.is_some() || step.is_some() || total.is_some() || speed.is_some();
    let has_active_job = image_generation_state.is_active("sdcpp").await;

    let Some(path) = engine_manager.active_image_preview_path().await else {
        return Ok(if has_status || has_active_job {
            Some(ImageGenerationPreview {
                data_url: String::new(),
                updated_at_ms: log_progress
                    .as_ref()
                    .map_or_else(current_time_ms_f64, |snapshot| snapshot.updated_at_ms),
                progress: merged_progress,
                step,
                total,
                speed,
                eta_relative: None,
            })
        } else {
            None
        });
    };

    let mut preview =
        tokio::task::spawn_blocking(move || read_image_generation_preview_file(&path))
            .await
            .map_err(|error| AppError::Internal {
                request_id: None,
                message: format!("Preview read task failed: {error}"),
            })?;

    if let Some(preview) = &mut preview {
        preview.progress = merged_progress;
        preview.step = step;
        preview.total = total;
        preview.speed.clone_from(&speed);
        preview.eta_relative = None;
    } else if has_status {
        preview = Some(ImageGenerationPreview {
            data_url: String::new(),
            updated_at_ms: log_progress
                .as_ref()
                .map_or_else(current_time_ms_f64, |snapshot| snapshot.updated_at_ms),
            progress: merged_progress,
            step,
            total,
            speed,
            eta_relative: None,
        });
    }

    Ok(preview)
}

fn current_time_ms_f64() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |duration| duration.as_secs_f64() * 1000.0)
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
    let bytes = decode_chat_image_payload(&base64_data)?;
    let file_path =
        build_chat_image_file_path(&target_dir, image_extension_for_mime_type(&mime_type));
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

    let file = resolve_chat_image_path(&file, "Saved image does not exist")?;
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
    let (file, open_folder_only) = resolve_image_open_target(&requested_file, &requested_folder)?;
    let path = image_open_directory(&file, open_folder_only)?;

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

fn create_stream_sink(
    request_id: String,
    chat_channel: Channel<StreamChunkPayload>,
    thought_channel: Channel<StreamChunkPayload>,
) -> Arc<dyn StreamSink> {
    Arc::new(TauriStreamSink {
        request_id,
        chat_channel,
        thought_channel,
    })
}

fn is_local_provider(provider: &str) -> bool {
    !matches!(
        provider,
        "gpt"
            | "gemini"
            | "gemini-image"
            | "gpt-image"
            | "seedream-image"
            | "openai"
            | "openrouter"
            | "anthropic"
            | "mistral"
            | "claude"
            | "deepseek"
    )
}

#[cfg(test)]
#[allow(clippy::expect_used)]
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
