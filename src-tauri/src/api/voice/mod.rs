//! Native voice recognition commands.

use crate::errors::AppError;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use once_cell::sync::Lazy;
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use windows::Media::SpeechRecognition::{
    SpeechRecognitionConfidence, SpeechRecognitionResult, SpeechRecognitionResultStatus,
    SpeechRecognizer,
};
#[cfg(target_os = "windows")]
use windows_future::IAsyncOperation;

#[cfg(target_os = "windows")]
const SPEECH_SETTINGS_URI: &str = "ms-settings:privacy-speech";
#[cfg(target_os = "windows")]
const SPEECH_PRIVACY_POLICY_NOT_ACCEPTED: i32 = 0x8004_5509_u32.cast_signed();
#[cfg(target_os = "windows")]
const RECOGNIZER_UNAVAILABLE: &str = "Voice recognizer unavailable";
#[cfg(target_os = "windows")]
static ACTIVE_RECOGNITION: Lazy<Mutex<Option<ActiveRecognition>>> = Lazy::new(|| Mutex::new(None));

#[cfg(target_os = "windows")]
struct ActiveRecognition {
    id: u32,
    operation: IAsyncOperation<SpeechRecognitionResult>,
}

#[cfg(not(target_os = "windows"))]
const WINDOWS_ONLY_RECOGNITION: &str =
    "Native voice recognition is currently supported only on Windows";
#[cfg(not(target_os = "windows"))]
const WINDOWS_ONLY_SETTINGS: &str = "Voice privacy settings are available only on Windows";

/// One-shot voice recognition request.
#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct VoiceRecognitionRequest {
    /// Preferred UI language code, for example `en`, `ru`, or `ru-RU`.
    pub language: Option<String>,
}

/// One-shot voice recognition response.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct VoiceRecognitionResponse {
    /// Recognized final text.
    pub text: String,
    /// Native recognizer status.
    pub status: String,
    /// Native confidence bucket when available.
    pub confidence: Option<String>,
}

/// Captures one voice utterance with the native platform recognizer.
#[tauri::command]
#[specta::specta]
pub async fn recognize_voice_once(
    request: VoiceRecognitionRequest,
) -> Result<VoiceRecognitionResponse, AppError> {
    recognize_voice_once_platform(request).await
}

/// Opens the native Windows speech privacy settings page.
#[tauri::command]
#[specta::specta]
pub async fn open_voice_privacy_settings() -> Result<(), AppError> {
    open_voice_privacy_settings_platform().await
}

/// Cancels the active native voice recognition request, if one is running.
#[tauri::command]
#[specta::specta]
pub fn cancel_voice_recognition() -> Result<(), AppError> {
    cancel_voice_recognition_platform()
}

#[cfg(target_os = "windows")]
async fn recognize_voice_once_platform(
    request: VoiceRecognitionRequest,
) -> Result<VoiceRecognitionResponse, AppError> {
    let recognizer = create_recognizer(request.language.as_deref())?;
    let result = recognize_once(&recognizer).await?;
    build_response(&result)
}

#[cfg(not(target_os = "windows"))]
async fn recognize_voice_once_platform(
    _request: VoiceRecognitionRequest,
) -> Result<VoiceRecognitionResponse, AppError> {
    Err(AppError::Validation(WINDOWS_ONLY_RECOGNITION.to_string()))
}

#[cfg(target_os = "windows")]
fn create_recognizer(language: Option<&str>) -> Result<SpeechRecognizer, AppError> {
    let Some(tag) = normalized_language_tag(language) else {
        return default_recognizer();
    };

    recognizer_for_language(&tag).or_else(|_| default_recognizer())
}

#[cfg(target_os = "windows")]
fn recognizer_for_language(tag: &str) -> Result<SpeechRecognizer, AppError> {
    use windows::Globalization::Language;
    use windows::core::HSTRING;

    let language = Language::CreateLanguage(&HSTRING::from(tag))
        .map_err(|error| external_error(format!("Invalid voice language: {error}")))?;

    SpeechRecognizer::Create(&language)
        .map_err(|error| external_error(format!("{RECOGNIZER_UNAVAILABLE}: {error}")))
}

#[cfg(target_os = "windows")]
fn default_recognizer() -> Result<SpeechRecognizer, AppError> {
    SpeechRecognizer::new()
        .map_err(|error| external_error(format!("{RECOGNIZER_UNAVAILABLE}: {error}")))
}

#[cfg(target_os = "windows")]
async fn recognize_once(
    recognizer: &SpeechRecognizer,
) -> Result<SpeechRecognitionResult, AppError> {
    let operation = recognizer
        .RecognizeAsync()
        .map_err(|error| map_windows_voice_error(&error))?;
    let operation_id = operation
        .Id()
        .map_err(|error| external_error(format!("Could not read voice operation id: {error}")))?;
    {
        let mut active = ACTIVE_RECOGNITION
            .lock()
            .map_err(|_| external_error("Voice recognition state is unavailable"))?;
        if let Some(previous) = active.take() {
            let _ = previous.operation.Cancel();
        }
        *active = Some(ActiveRecognition {
            id: operation_id,
            operation: operation.clone(),
        });
    }

    let result = operation
        .await
        .map_err(|error| map_windows_voice_error(&error));

    clear_active_recognition(operation_id);
    result
}

#[cfg(target_os = "windows")]
fn clear_active_recognition(operation_id: u32) {
    let Ok(mut active) = ACTIVE_RECOGNITION.lock() else {
        return;
    };

    if active
        .as_ref()
        .is_some_and(|active| active.id == operation_id)
    {
        *active = None;
    }
}

#[cfg(target_os = "windows")]
fn cancel_voice_recognition_platform() -> Result<(), AppError> {
    let operation = ACTIVE_RECOGNITION
        .lock()
        .map_err(|_| external_error("Voice recognition state is unavailable"))?
        .take();

    if let Some(active) = operation {
        active.operation.Cancel().map_err(|error| {
            external_error(format!("Failed to cancel voice recognition: {error}"))
        })?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn cancel_voice_recognition_platform() -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn build_response(result: &SpeechRecognitionResult) -> Result<VoiceRecognitionResponse, AppError> {
    let status = result
        .Status()
        .map_err(|error| external_error(format!("Could not read voice status: {error}")))?;

    if status != SpeechRecognitionResultStatus::Success {
        return Err(status_to_error(status));
    }

    let text = result
        .Text()
        .map_err(|error| external_error(format!("Could not read voice text: {error}")))?
        .to_string();

    Ok(VoiceRecognitionResponse {
        text,
        status: "success".to_string(),
        confidence: result.Confidence().ok().map(confidence_label),
    })
}

#[cfg(target_os = "windows")]
fn status_to_error(status: SpeechRecognitionResultStatus) -> AppError {
    let message = if status == SpeechRecognitionResultStatus::MicrophoneUnavailable {
        return AppError::PermissionDenied("Microphone is unavailable or blocked".to_string());
    } else if status == SpeechRecognitionResultStatus::UserCanceled {
        "Voice recognition was canceled"
    } else if status == SpeechRecognitionResultStatus::TimeoutExceeded {
        "Voice recognition timed out"
    } else if status == SpeechRecognitionResultStatus::NetworkFailure {
        "Windows speech service network failure"
    } else if status == SpeechRecognitionResultStatus::TopicLanguageNotSupported {
        "Voice language is not supported by Windows speech recognition"
    } else if status == SpeechRecognitionResultStatus::GrammarLanguageMismatch {
        "Voice grammar language mismatch"
    } else if status == SpeechRecognitionResultStatus::AudioQualityFailure {
        "Microphone audio quality is too low"
    } else {
        "Voice recognition failed"
    };

    external_error(message)
}

#[cfg(target_os = "windows")]
fn confidence_label(confidence: SpeechRecognitionConfidence) -> String {
    let label = if confidence == SpeechRecognitionConfidence::High {
        "high"
    } else if confidence == SpeechRecognitionConfidence::Medium {
        "medium"
    } else if confidence == SpeechRecognitionConfidence::Low {
        "low"
    } else {
        "rejected"
    };

    label.to_string()
}

#[cfg(target_os = "windows")]
fn normalized_language_tag(language: Option<&str>) -> Option<String> {
    let raw = language?.trim();
    if raw.is_empty() {
        return None;
    }

    Some(
        match raw {
            "en" => "en-US",
            "ru" => "ru-RU",
            "zh" => "zh-CN",
            other => other,
        }
        .to_string(),
    )
}

#[cfg(target_os = "windows")]
fn map_windows_voice_error(error: &windows::core::Error) -> AppError {
    if error.code().0 == SPEECH_PRIVACY_POLICY_NOT_ACCEPTED {
        return AppError::PermissionDenied(
            "Windows speech privacy is disabled. Open Windows Settings > Privacy & security > Speech, enable Online speech recognition, then try again.".to_string(),
        );
    }

    external_error(format!("Voice recognition failed: {error}"))
}

#[cfg(target_os = "windows")]
async fn open_voice_privacy_settings_platform() -> Result<(), AppError> {
    use windows::Foundation::Uri;
    use windows::System::Launcher;
    use windows::core::HSTRING;

    let uri = Uri::CreateUri(&HSTRING::from(SPEECH_SETTINGS_URI)).map_err(|error| {
        external_error(format!(
            "Failed to create Windows speech settings URI: {error}"
        ))
    })?;

    let opened = Launcher::LaunchUriAsync(&uri)
        .map_err(|error| {
            external_error(format!("Failed to launch Windows speech settings: {error}"))
        })?
        .await
        .map_err(|error| {
            external_error(format!("Windows speech settings launch failed: {error}"))
        })?;

    if !opened {
        return Err(external_error("Windows refused to open speech settings"));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
async fn open_voice_privacy_settings_platform() -> Result<(), AppError> {
    Err(AppError::Validation(WINDOWS_ONLY_SETTINGS.to_string()))
}

#[cfg(target_os = "windows")]
fn external_error(message: impl Into<String>) -> AppError {
    AppError::External {
        request_id: None,
        message: message.into(),
    }
}
