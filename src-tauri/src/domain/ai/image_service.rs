use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::path::Path;
use std::time::{Duration, Instant};

use super::ai_dispatch::{LocalEngineAccess, active_local_engine_status, build_engine_config};
use super::ai_service::stop_conflicting_local_engine;
use super::session::ChatSessionManager;
use super::types::{ChatMessage, ChatReply, ImageGenerationRequest, ImageGenerationResponse};
use crate::domain::ai::ImageGenerationState;
use crate::domain::engine::manager::{EngineManager, resolve_sdcpp_preview_path};
use crate::domain::engine::types::Capability;
use crate::errors::AppError;
use crate::infrastructure::config::settings::SettingsService;
use crate::infrastructure::crypto::secure_storage::SecureStorage;
use crate::models::AppSettings;

struct PreparedImageDispatch {
    base_url: String,
    request_url: String,
    api: LocalImageApi,
    response_format: ImageResponseFormat,
    preview_path: Option<std::path::PathBuf>,
}

struct ImageRequestSettingsContext {
    settings: AppSettings,
    settings_key: String,
}

struct ComfyUiRequestContext {
    base_url: String,
    checkpoint: String,
    sampler: String,
    scheduler: String,
    seed: u64,
    steps: u32,
    cfg_scale: f32,
    width: u32,
    height: u32,
    batch_size: u32,
    negative_prompt: String,
    prompt_id: String,
    client_id: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LocalImageApi {
    SdcppNative,
    OpenAiCompatible,
}

#[derive(Clone, Copy)]
enum ImageResponseFormat {
    SdApi,
    OpenAiCompatible,
}

pub(super) async fn process_image_request(
    request: ImageGenerationRequest,
    sessions: &ChatSessionManager,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
) -> Result<ImageGenerationResponse, AppError> {
    process_image_request_with_local_engine_access(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
        LocalEngineAccess::AutoStart,
    )
    .await
}

pub(super) async fn process_image_request_without_engine_autostart(
    request: ImageGenerationRequest,
    sessions: &ChatSessionManager,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
) -> Result<ImageGenerationResponse, AppError> {
    process_image_request_with_local_engine_access(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
        LocalEngineAccess::RequireRunning,
    )
    .await
}

async fn process_image_request_with_local_engine_access(
    request: ImageGenerationRequest,
    sessions: &ChatSessionManager,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
    local_engine_access: LocalEngineAccess,
) -> Result<ImageGenerationResponse, AppError> {
    let request = apply_image_request_defaults(request, settings_service).await?;
    let _local_workload_guard = if is_cloud_image_provider(&request.provider) {
        None
    } else {
        Some(engine_manager.acquire_local_workload().await)
    };

    let images = if request.provider == "comfyui" {
        stop_conflicting_local_engine(engine_manager, Capability::Image).await?;
        process_comfyui_request(&request, image_generation_state, settings_service).await?
    } else if is_cloud_image_provider(&request.provider) {
        process_cloud_image_request(&request).await?
    } else {
        let dispatch =
            prepare_local_image_dispatch(&request, engine_manager, local_engine_access).await?;
        image_generation_state
            .begin(&request.provider, &dispatch.base_url, None)
            .await;
        let result = execute_local_image_request(&request, dispatch, image_generation_state).await;
        image_generation_state.clear(&request.provider, None).await;
        result?
    };

    if let Some(session_id) = request.session_id.as_deref()
        && !images.is_empty()
    {
        let user_message = ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String(
                request
                    .original_prompt
                    .clone()
                    .unwrap_or_else(|| request.prompt.clone()),
            ),
            thought_signature: None,
        };
        let _ = sessions.merge_request_messages(session_id, &[user_message]);

        let reply = ChatReply {
            text: String::new(),
            role: "assistant".to_string(),
        };

        sessions.append_response_with_content(
            session_id,
            uuid::Uuid::new_v4().to_string(),
            build_generated_image_content(&images),
            &reply.role,
            None,
        );
    }

    Ok(ImageGenerationResponse {
        images,
        ok: true,
        error: None,
    })
}

async fn prepare_local_image_dispatch(
    request: &ImageGenerationRequest,
    engine_manager: &EngineManager,
    local_engine_access: LocalEngineAccess,
) -> Result<PreparedImageDispatch, AppError> {
    let Some(definition) = engine_manager.get_definition(&request.provider).await else {
        return Err(AppError::External {
            request_id: None,
            message: "Cloud image generation is not yet supported. Please use a local engine."
                .into(),
        });
    };

    tracing::info!(
        provider = %request.provider,
        "Detected local engine for image generation"
    );

    let (base_url, preview_path) =
        resolve_local_image_endpoint(request, engine_manager, local_engine_access, &definition)
            .await?;
    let api = local_image_api(&request.provider);
    let response_format = image_response_format(api);
    let request_url = build_image_generation_url(&base_url, api);

    Ok(PreparedImageDispatch {
        base_url,
        request_url,
        api,
        response_format,
        preview_path,
    })
}

fn is_cloud_image_provider(provider: &str) -> bool {
    matches!(provider, "gemini-image" | "gpt-image" | "seedream-image")
}

fn local_image_api(provider: &str) -> LocalImageApi {
    if matches!(provider, "sdcpp" | "stable-diffusion") {
        LocalImageApi::SdcppNative
    } else {
        LocalImageApi::OpenAiCompatible
    }
}

async fn resolve_local_image_endpoint(
    request: &ImageGenerationRequest,
    engine_manager: &EngineManager,
    local_engine_access: LocalEngineAccess,
    definition: &crate::domain::engine::types::EngineDefinition,
) -> Result<(String, Option<std::path::PathBuf>), AppError> {
    match local_engine_access {
        LocalEngineAccess::AutoStart => {
            let mut config = build_engine_config(definition).await?;

            if !request.model.is_empty() && request.model != "default" {
                config.model_path = Some(request.model.clone());
            }

            if config.model_path.as_deref() == Some("default") {
                config.model_path = None;
            }

            let preview_path = resolve_sdcpp_preview_path(&config.extra_args);
            stop_conflicting_local_engine(engine_manager, Capability::Image).await?;
            let status = engine_manager.start(config).await?;

            Ok((status.endpoint, preview_path))
        }
        LocalEngineAccess::RequireRunning => {
            let status =
                active_local_engine_status(engine_manager, &request.provider, Capability::Image)
                    .await?;
            let preview_path = engine_manager.active_image_preview_path().await;
            Ok((status.endpoint, preview_path))
        }
    }
}

const fn image_response_format(api: LocalImageApi) -> ImageResponseFormat {
    match api {
        LocalImageApi::SdcppNative => ImageResponseFormat::SdApi,
        LocalImageApi::OpenAiCompatible => ImageResponseFormat::OpenAiCompatible,
    }
}

fn build_image_generation_url(base_url: &str, api: LocalImageApi) -> String {
    match api {
        LocalImageApi::SdcppNative => format!("{base_url}/sdcpp/v1/img_gen"),
        LocalImageApi::OpenAiCompatible => format!("{base_url}/v1/images/generations"),
    }
}

async fn execute_local_image_request(
    request: &ImageGenerationRequest,
    dispatch: PreparedImageDispatch,
    image_generation_state: &ImageGenerationState,
) -> Result<Vec<String>, AppError> {
    let client = build_image_client(Duration::from_secs(999_999))?;

    if let Some(preview_path) = dispatch.preview_path.as_deref() {
        clear_preview_file(preview_path).await;
    }

    if dispatch.api == LocalImageApi::SdcppNative {
        return execute_sdcpp_native_image_request(
            request,
            &dispatch,
            image_generation_state,
            &client,
        )
        .await;
    }

    let payload = build_local_image_payload(request);
    tracing::info!(
        "Sending image generation request to {}",
        dispatch.request_url
    );
    let response = client
        .post(&dispatch.request_url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!(
                "Local image engine request failed at {}: {error}. The engine may have stopped, closed the connection, or run out of memory while generating.",
                dispatch.request_url
            ),
        })?;

    let body = parse_image_response_body(response).await?;
    let images = parse_generated_images(&body, dispatch.response_format);
    if images.is_empty() {
        return Err(AppError::External {
            request_id: None,
            message: format!(
                "Local image engine returned no images. Response shape was: {}",
                summarize_image_response_shape(&body)
            ),
        });
    }

    Ok(images)
}

async fn execute_sdcpp_native_image_request(
    request: &ImageGenerationRequest,
    dispatch: &PreparedImageDispatch,
    image_generation_state: &ImageGenerationState,
    client: &reqwest::Client,
) -> Result<Vec<String>, AppError> {
    let payload = build_sdcpp_native_image_payload(request);
    tracing::info!(
        "Submitting stable-diffusion.cpp native image job to {}",
        dispatch.request_url
    );
    let response = client
        .post(&dispatch.request_url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!(
                "Local image engine request failed at {}: {error}. The engine may have stopped, closed the connection, or run out of memory while generating.",
                dispatch.request_url
            ),
        })?;

    let body = parse_image_response_body(response).await?;
    let job_id = extract_sdcpp_job_id(&body).ok_or_else(|| AppError::External {
        request_id: None,
        message: format!(
            "stable-diffusion.cpp did not return a native job id. Response shape was: {}",
            summarize_image_response_shape(&body)
        ),
    })?;
    image_generation_state
        .update_prompt_id(&request.provider, job_id.clone())
        .await;

    wait_for_sdcpp_native_images(
        client,
        &dispatch.base_url,
        &request.provider,
        &job_id,
        image_generation_state,
    )
    .await
}

fn extract_sdcpp_job_id(body: &serde_json::Value) -> Option<String> {
    body.get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

async fn wait_for_sdcpp_native_images(
    client: &reqwest::Client,
    base_url: &str,
    provider: &str,
    job_id: &str,
    image_generation_state: &ImageGenerationState,
) -> Result<Vec<String>, AppError> {
    let deadline = Instant::now() + Duration::from_secs(999_999);
    let job_url = format!("{}/sdcpp/v1/jobs/{job_id}", base_url.trim_end_matches('/'));

    loop {
        if image_generation_state
            .is_cancelled(provider, Some(job_id))
            .await
        {
            return Err(AppError::External {
                request_id: None,
                message: "Image generation cancelled".to_string(),
            });
        }

        let response = client
            .get(&job_url)
            .send()
            .await
            .map_err(|error| AppError::External {
                request_id: None,
                message: format!("Failed to poll stable-diffusion.cpp job: {error}"),
            })?;
        let body = parse_image_response_body(response).await?;
        let status = body
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();

        match status {
            "completed" => {
                let images = parse_sdcpp_generated_images(&body);
                if !images.is_empty() {
                    return Ok(images);
                }
                return Err(AppError::External {
                    request_id: None,
                    message: format!(
                        "stable-diffusion.cpp completed without images. Response shape was: {}",
                        summarize_image_response_shape(&body)
                    ),
                });
            }
            "failed" | "cancelled" => {
                return Err(AppError::External {
                    request_id: None,
                    message: extract_sdcpp_job_error(&body)
                        .unwrap_or_else(|| format!("stable-diffusion.cpp job {status}")),
                });
            }
            "queued" | "generating" => {}
            _ => {
                return Err(AppError::External {
                    request_id: None,
                    message: format!("stable-diffusion.cpp returned unknown job status: {status}"),
                });
            }
        }

        if Instant::now() >= deadline {
            return Err(AppError::External {
                request_id: None,
                message: "stable-diffusion.cpp image generation timed out".to_string(),
            });
        }

        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

fn extract_sdcpp_job_error(body: &serde_json::Value) -> Option<String> {
    body.get("error")
        .and_then(|error| error.get("message"))
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn build_sdcpp_native_image_payload(request: &ImageGenerationRequest) -> serde_json::Value {
    serde_json::json!({
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt.clone().unwrap_or_default(),
        "clip_skip": request.clip_skip.unwrap_or(-1),
        "width": request.width.unwrap_or(512),
        "height": request.height.unwrap_or(512),
        "seed": request.seed.unwrap_or(-1),
        "batch_count": request.batch_size.unwrap_or(1),
        "sample_params": {
            "scheduler": normalize_sdcpp_scheduler(request.scheduler.as_deref()),
            "sample_method": normalize_sdcpp_sampler(request.sampler.as_deref()),
            "sample_steps": request.steps.unwrap_or(20),
            "strength": request.denoising_strength.unwrap_or(0.75),
            "guidance": {
                "txt_cfg": request.cfg_scale.unwrap_or(7.0)
            }
        },
        "output_format": "png",
        "output_compression": 100
    })
}

fn build_local_image_payload(request: &ImageGenerationRequest) -> serde_json::Value {
    let sampler_name = request
        .sampler
        .clone()
        .unwrap_or_else(|| "euler_a".to_string());
    let scheduler = request.scheduler.clone().unwrap_or_default();

    serde_json::json!({
        "prompt": request.prompt,
        "steps": request.steps.unwrap_or(20),
        "cfg_scale": request.cfg_scale.unwrap_or(7.0),
        "width": request.width.unwrap_or(512),
        "height": request.height.unwrap_or(512),
        "sampler_name": sampler_name,
        "scheduler": scheduler,
        "seed": request.seed.unwrap_or(-1),
        "batch_size": request.batch_size.unwrap_or(1),
        "clip_skip": request.clip_skip.unwrap_or(-1),
        "negative_prompt": request.negative_prompt.clone().unwrap_or_default()
    })
}

async fn process_cloud_image_request(
    request: &ImageGenerationRequest,
) -> Result<Vec<String>, AppError> {
    let api_key = SecureStorage::get_key_async("openrouter_api_key".to_string())
        .await?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Validation("OpenRouter API key is missing".to_string()))?;

    let client = build_image_client(Duration::from_secs(180))?;
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&build_cloud_image_payload(request))
        .send()
        .await
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!("Cloud image request failed: {error}"),
        })?;

    let body = parse_image_response_body(response).await?;
    let images = parse_openrouter_generated_images(&body);
    if images.is_empty() {
        return Err(AppError::External {
            request_id: None,
            message: "Cloud image provider returned no images".to_string(),
        });
    }

    Ok(images)
}

fn build_cloud_image_payload(request: &ImageGenerationRequest) -> serde_json::Value {
    let model = resolve_cloud_image_model(request);
    let mut payload = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": request.prompt
            }
        ],
        "modalities": resolve_openrouter_modalities(model)
    });

    if let Some(session_id) = request.session_id.as_ref().map(|value| value.trim())
        && !session_id.is_empty()
        && let Some(payload_object) = payload.as_object_mut()
    {
        payload_object.insert(
            "session_id".to_string(),
            serde_json::Value::String(session_id.to_string()),
        );
    }

    if let Some(image_config) = build_openrouter_image_config(request) {
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("image_config".to_string(), image_config);
        }
    }

    payload
}

fn resolve_cloud_image_model(request: &ImageGenerationRequest) -> &str {
    if !request.model.trim().is_empty() && request.model != "default" {
        return request.model.as_str();
    }

    match request.provider.as_str() {
        "gpt-image" => "openai/gpt-5-image",
        "seedream-image" => "bytedance-seed/seedream-4.5",
        _ => "google/gemini-3.1-flash-image-preview",
    }
}

fn resolve_openrouter_modalities(model: &str) -> &'static [&'static str] {
    if supports_text_with_generated_images(model) {
        &["image", "text"]
    } else {
        &["image"]
    }
}

fn supports_text_with_generated_images(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();

    normalized.starts_with("google/gemini-")
        || normalized.starts_with("openai/gpt-5-image")
        || normalized.starts_with("openai/gpt-image")
}

fn build_openrouter_image_config(request: &ImageGenerationRequest) -> Option<serde_json::Value> {
    let aspect_ratio = resolve_aspect_ratio(request.width, request.height)?;
    Some(serde_json::json!({
        "aspect_ratio": aspect_ratio
    }))
}

fn resolve_aspect_ratio(width: Option<u32>, height: Option<u32>) -> Option<&'static str> {
    let (width, height) = (width?, height?);
    match (width, height) {
        (1024, 1024) | (512, 512) => Some("1:1"),
        (1152, 896) | (1216, 832) => Some("4:3"),
        (896, 1152) | (832, 1216) => Some("3:4"),
        (1344, 768) | (1536, 864) => Some("16:9"),
        (768, 1344) | (864, 1536) => Some("9:16"),
        _ => None,
    }
}

fn build_image_client(timeout: Duration) -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| AppError::External {
            request_id: None,
            message: error.to_string(),
        })
}

async fn parse_image_response_body(
    response: reqwest::Response,
) -> Result<serde_json::Value, AppError> {
    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(AppError::External {
            request_id: None,
            message: format!("Image generation failed: {err_text}"),
        });
    }

    response.json().await.map_err(|error| AppError::External {
        request_id: None,
        message: format!("Failed to parse image response: {error}"),
    })
}

fn parse_generated_images(
    body: &serde_json::Value,
    response_format: ImageResponseFormat,
) -> Vec<String> {
    match response_format {
        ImageResponseFormat::SdApi => parse_sdcpp_generated_images(body),
        ImageResponseFormat::OpenAiCompatible => body
            .get("data")
            .and_then(|value| value.as_array())
            .into_iter()
            .flat_map(|items| items.iter())
            .filter_map(|item| {
                item.get("b64_json")
                    .and_then(|value| value.as_str())
                    .map(|b64| format!("data:image/png;base64,{b64}"))
                    .or_else(|| {
                        item.get("url")
                            .and_then(|value| value.as_str())
                            .map(str::to_string)
                    })
            })
            .collect(),
    }
}

fn parse_sdcpp_generated_images(body: &serde_json::Value) -> Vec<String> {
    let output_format = body
        .get("result")
        .and_then(|value| value.get("output_format"))
        .or_else(|| body.get("output_format"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("png");

    parse_image_items(body.get("images"), output_format)
        .into_iter()
        .chain(parse_image_items(
            body.get("result").and_then(|value| value.get("images")),
            output_format,
        ))
        .chain(
            body.get("result")
                .and_then(|value| value.get("b64_json"))
                .and_then(serde_json::Value::as_str)
                .map(|b64| data_url_from_b64(output_format, b64)),
        )
        .collect()
}

fn parse_image_items(value: Option<&serde_json::Value>, output_format: &str) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(|item| {
            item.as_str()
                .map(|b64| data_url_from_b64(output_format, b64))
                .or_else(|| {
                    item.get("b64_json")
                        .and_then(serde_json::Value::as_str)
                        .map(|b64| data_url_from_b64(output_format, b64))
                })
                .or_else(|| {
                    item.get("url")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
        })
        .collect()
}

fn data_url_from_b64(output_format: &str, b64: &str) -> String {
    let format = output_format
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    let mime = match format.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    format!("data:{mime};base64,{b64}")
}

fn summarize_image_response_shape(body: &serde_json::Value) -> String {
    let Some(object) = body.as_object() else {
        return body
            .as_str()
            .map_or_else(|| body.to_string(), std::string::ToString::to_string);
    };

    object
        .iter()
        .map(|(key, value)| {
            let kind = if value.is_array() {
                "array"
            } else if value.is_object() {
                "object"
            } else if value.is_string() {
                "string"
            } else if value.is_number() {
                "number"
            } else if value.is_boolean() {
                "boolean"
            } else {
                "null"
            };
            format!("{key}:{kind}")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn parse_openrouter_generated_images(body: &serde_json::Value) -> Vec<String> {
    body.get("choices")
        .and_then(|value| value.as_array())
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(|item| item.get("message"))
        .flat_map(extract_images_from_openrouter_message)
        .collect()
}

fn extract_images_from_openrouter_message(message: &serde_json::Value) -> Vec<String> {
    if let Some(images) = message.get("images").and_then(|value| value.as_array()) {
        return images
            .iter()
            .filter_map(extract_openrouter_image_url)
            .collect();
    }

    if let Some(content) = message.get("content").and_then(|value| value.as_array()) {
        return content
            .iter()
            .filter_map(|item| {
                item.get("image_url")
                    .and_then(|value| value.get("url"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .collect();
    }

    Vec::new()
}

fn extract_openrouter_image_url(item: &serde_json::Value) -> Option<String> {
    item.get("image_url")
        .and_then(|value| value.get("url"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            item.get("imageUrl")
                .and_then(|value| value.get("url"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
}

async fn process_comfyui_request(
    request: &ImageGenerationRequest,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
) -> Result<Vec<String>, AppError> {
    let settings_context = load_image_request_settings_context(request, settings_service).await?;
    let client = build_image_client(Duration::from_secs(120))?;
    let comfyui = build_comfyui_request_context(request, &settings_context, &client).await?;
    let workflow = build_comfyui_workflow(
        &request.prompt,
        &comfyui.negative_prompt,
        &comfyui.checkpoint,
        comfyui.seed,
        comfyui.steps,
        comfyui.cfg_scale,
        comfyui.width,
        comfyui.height,
        comfyui.batch_size,
        &comfyui.sampler,
        &comfyui.scheduler,
    );

    image_generation_state
        .begin(
            &request.provider,
            &comfyui.base_url,
            Some(comfyui.prompt_id.clone()),
        )
        .await;

    let mut active_prompt_id = comfyui.prompt_id.clone();
    let result = async {
        let queue_body = queue_comfyui_prompt(&client, &comfyui, workflow).await?;

        if let Some(server_prompt_id) = queue_body.get("prompt_id").and_then(|value| value.as_str())
            && !server_prompt_id.trim().is_empty()
        {
            active_prompt_id = server_prompt_id.to_string();
            image_generation_state
                .update_prompt_id(&request.provider, active_prompt_id.clone())
                .await;
        }

        if let Some(message) = extract_comfyui_queue_error(&queue_body) {
            return Err(AppError::External {
                request_id: None,
                message,
            });
        }

        wait_for_comfyui_images(
            &client,
            &comfyui.base_url,
            &request.provider,
            &active_prompt_id,
            image_generation_state,
        )
        .await
    }
    .await;

    image_generation_state
        .clear(&request.provider, Some(active_prompt_id.as_str()))
        .await;

    result
}

async fn resolve_comfyui_checkpoint(
    request: &ImageGenerationRequest,
    settings: &AppSettings,
    settings_key: &str,
    base_url: &str,
    client: &reqwest::Client,
) -> Result<String, AppError> {
    if !request.model.trim().is_empty() && request.model != "default" {
        return Ok(normalize_comfyui_checkpoint(&request.model));
    }

    if let Some(saved_checkpoint) =
        resolve_string_setting(settings, settings_key, &request.provider, "checkpoint")
    {
        return Ok(normalize_comfyui_checkpoint(&saved_checkpoint));
    }

    let available_checkpoints = fetch_comfyui_checkpoints(client, base_url).await?;
    if let Some(checkpoint) = available_checkpoints.first() {
        return Ok(normalize_comfyui_checkpoint(checkpoint));
    }

    Err(AppError::Config(
        "ComfyUI does not expose any checkpoints yet. Install a model in ComfyUI and try again."
            .to_string(),
    ))
}

fn normalize_comfyui_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "http://127.0.0.1:8188".to_string();
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }

    format!("http://{trimmed}")
}

fn normalize_comfyui_checkpoint(raw: &str) -> String {
    raw.trim()
        .replace('\\', "/")
        .split('/')
        .next_back()
        .unwrap_or(raw)
        .trim()
        .to_string()
}

pub(super) fn normalize_comfyui_sampler(value: Option<&str>) -> String {
    match value.unwrap_or("euler").trim().to_lowercase().as_str() {
        "euler a" | "euler_a" | "euler ancestral" | "euler_ancestral" => {
            "euler_ancestral".to_string()
        }
        "euler" => "euler".to_string(),
        "heun" => "heun".to_string(),
        "heunpp2" => "heunpp2".to_string(),
        "dpm2" | "dpm 2" | "dpm_2" => "dpm_2".to_string(),
        "dpm2 a" | "dpm2_a" | "dpm 2 ancestral" | "dpm_2_ancestral" => {
            "dpm_2_ancestral".to_string()
        }
        "lms" => "lms".to_string(),
        "dpm fast" | "dpm_fast" => "dpm_fast".to_string(),
        "dpm adaptive" | "dpm_adaptive" => "dpm_adaptive".to_string(),
        "dpm++ 2s a" | "dpm++2s_a" | "dpmpp_2s_a" | "dpmpp_2s_ancestral" => {
            "dpmpp_2s_ancestral".to_string()
        }
        "dpm++ sde" | "dpmpp_sde" => "dpmpp_sde".to_string(),
        "dpm++ sde gpu" | "dpmpp_sde_gpu" => "dpmpp_sde_gpu".to_string(),
        "dpm++ 2m" | "dpm++2m" | "dpmpp_2m" => "dpmpp_2m".to_string(),
        "dpm++ 3m sde" | "dpm++3m sde" | "dpmpp_3m_sde" => "dpmpp_3m_sde".to_string(),
        "dpm++ 3m sde gpu" | "dpm++3m sde gpu" | "dpmpp_3m_sde_gpu" => {
            "dpmpp_3m_sde_gpu".to_string()
        }
        "ddpm" => "ddpm".to_string(),
        "lcm" => "lcm".to_string(),
        "ipndm" => "ipndm".to_string(),
        "ipndm_v" => "ipndm_v".to_string(),
        "deis" => "deis".to_string(),
        "ddim" => "ddim".to_string(),
        "uni pc" | "uni_pc" => "uni_pc".to_string(),
        "uni pc bh2" | "uni_pc_bh2" => "uni_pc_bh2".to_string(),
        other => other.to_string(),
    }
}

pub(super) fn normalize_comfyui_scheduler(value: Option<&str>) -> String {
    match value.unwrap_or("karras").trim().to_lowercase().as_str() {
        "default" | "auto" | "karras" => "karras".to_string(),
        "normal" => "normal".to_string(),
        "simple" => "simple".to_string(),
        "sgm uniform" | "sgm_uniform" => "sgm_uniform".to_string(),
        "exponential" => "exponential".to_string(),
        "ddim uniform" | "ddim_uniform" => "ddim_uniform".to_string(),
        "beta" => "beta".to_string(),
        "linear quadratic" | "linear_quadratic" => "linear_quadratic".to_string(),
        "kl optimal" | "kl_optimal" => "kl_optimal".to_string(),
        other => other.to_string(),
    }
}

fn normalize_comfyui_seed(value: Option<i32>) -> u64 {
    match value {
        Some(seed) if seed >= 0 => u64::from(seed.unsigned_abs()),
        _ => rand::random::<u64>(),
    }
}

async fn fetch_comfyui_checkpoints(
    client: &reqwest::Client,
    base_url: &str,
) -> Result<Vec<String>, AppError> {
    let response = client
        .get(format!("{base_url}/models/checkpoints"))
        .send()
        .await
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!("Failed to query ComfyUI checkpoints: {error}"),
        })?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::External {
            request_id: None,
            message: format!("ComfyUI checkpoints request failed: {body}"),
        });
    }

    let payload: serde_json::Value = response.json().await.map_err(|error| AppError::External {
        request_id: None,
        message: format!("Failed to parse ComfyUI checkpoint list: {error}"),
    })?;

    Ok(parse_comfyui_checkpoint_list(&payload))
}

pub(super) fn parse_comfyui_checkpoint_list(payload: &serde_json::Value) -> Vec<String> {
    fn extract_checkpoint_name(value: &serde_json::Value) -> Option<String> {
        if let Some(name) = value.as_str() {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        let object = value.as_object()?;
        for key in ["name", "filename", "path"] {
            if let Some(candidate) = object.get(key).and_then(|entry| entry.as_str()) {
                let trimmed = candidate.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }

        None
    }

    let values = if let Some(items) = payload.as_array() {
        items.iter().collect::<Vec<_>>()
    } else if let Some(items) = payload.get("models").and_then(|value| value.as_array()) {
        items.iter().collect::<Vec<_>>()
    } else if let Some(items) = payload.get("files").and_then(|value| value.as_array()) {
        items.iter().collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .filter_map(extract_checkpoint_name)
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn build_comfyui_workflow(
    prompt: &str,
    negative_prompt: &str,
    checkpoint: &str,
    seed: u64,
    steps: u32,
    cfg_scale: f32,
    width: u32,
    height: u32,
    batch_size: u32,
    sampler: &str,
    scheduler: &str,
) -> serde_json::Value {
    serde_json::json!({
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": cfg_scale,
                "denoise": 1.0,
                "latent_image": ["5", 0],
                "model": ["4", 0],
                "negative": ["7", 0],
                "positive": ["6", 0],
                "sampler_name": sampler,
                "scheduler": scheduler,
                "seed": seed,
                "steps": steps
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": checkpoint
            }
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "batch_size": batch_size,
                "height": height,
                "width": width
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["4", 1],
                "text": prompt
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["4", 1],
                "text": negative_prompt
            }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "Axelate",
                "images": ["8", 0]
            }
        }
    })
}

async fn wait_for_comfyui_images(
    client: &reqwest::Client,
    base_url: &str,
    provider: &str,
    prompt_id: &str,
    image_generation_state: &ImageGenerationState,
) -> Result<Vec<String>, AppError> {
    let deadline = Instant::now() + Duration::from_secs(600);

    loop {
        if image_generation_state
            .is_cancelled(provider, Some(prompt_id))
            .await
        {
            return Err(AppError::External {
                request_id: None,
                message: "Image generation cancelled".to_string(),
            });
        }

        let response = client
            .get(format!("{base_url}/history/{prompt_id}"))
            .send()
            .await
            .map_err(|error| AppError::External {
                request_id: None,
                message: format!("Failed to poll ComfyUI history: {error}"),
            })?;

        if response.status().is_success() {
            let history_body: serde_json::Value =
                response.json().await.map_err(|error| AppError::External {
                    request_id: None,
                    message: format!("Failed to parse ComfyUI history: {error}"),
                })?;

            if let Some(entry) = history_body.get(prompt_id) {
                let images = fetch_comfyui_history_images(client, base_url, entry).await?;
                if !images.is_empty() {
                    return Ok(images);
                }
            }
        }

        if Instant::now() >= deadline {
            return Err(AppError::External {
                request_id: None,
                message: "ComfyUI image generation timed out".to_string(),
            });
        }

        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

async fn fetch_comfyui_history_images(
    client: &reqwest::Client,
    base_url: &str,
    history_entry: &serde_json::Value,
) -> Result<Vec<String>, AppError> {
    let mut images = Vec::new();
    let Some(outputs) = history_entry
        .get("outputs")
        .and_then(|value| value.as_object())
    else {
        return Ok(images);
    };

    for node_output in outputs.values() {
        let Some(node_images) = node_output.get("images").and_then(|value| value.as_array()) else {
            continue;
        };

        for image_meta in node_images {
            let Some(filename) = image_meta.get("filename").and_then(|value| value.as_str()) else {
                continue;
            };

            let subfolder = image_meta
                .get("subfolder")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let image_type = image_meta
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("output");
            let mut image_url =
                reqwest::Url::parse(&format!("{base_url}/view")).map_err(|error| {
                    AppError::External {
                        request_id: None,
                        message: format!("Failed to build ComfyUI image URL: {error}"),
                    }
                })?;
            {
                let mut query = image_url.query_pairs_mut();
                query.append_pair("filename", filename);
                if !subfolder.is_empty() {
                    query.append_pair("subfolder", subfolder);
                }
                query.append_pair("type", image_type);
            }

            let response =
                client
                    .get(image_url)
                    .send()
                    .await
                    .map_err(|error| AppError::External {
                        request_id: None,
                        message: format!("Failed to fetch ComfyUI image: {error}"),
                    })?;

            if !response.status().is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::External {
                    request_id: None,
                    message: format!("ComfyUI image download failed: {body}"),
                });
            }

            let mime_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("image/png")
                .to_string();
            let bytes = response.bytes().await.map_err(|error| AppError::External {
                request_id: None,
                message: format!("Failed to read ComfyUI image bytes: {error}"),
            })?;

            images.push(format!(
                "data:{mime_type};base64,{}",
                STANDARD.encode(bytes)
            ));
        }
    }

    Ok(images)
}

fn extract_comfyui_queue_error(body: &serde_json::Value) -> Option<String> {
    if let Some(error_message) = body.get("error").and_then(|value| value.as_str()) {
        return Some(format!("ComfyUI queue error: {error_message}"));
    }

    let node_errors = body.get("node_errors")?;
    if !node_errors.is_object()
        || node_errors
            .as_object()
            .is_some_and(serde_json::Map::is_empty)
    {
        return None;
    }

    Some(format!("ComfyUI node validation failed: {node_errors}"))
}

async fn apply_image_request_defaults(
    mut request: ImageGenerationRequest,
    settings_service: &SettingsService,
) -> Result<ImageGenerationRequest, AppError> {
    let settings_context = load_image_request_settings_context(&request, settings_service).await?;
    apply_saved_image_defaults(
        &mut request,
        &settings_context.settings,
        &settings_context.settings_key,
    );

    Ok(request)
}

async fn load_image_request_settings_context(
    request: &ImageGenerationRequest,
    settings_service: &SettingsService,
) -> Result<ImageRequestSettingsContext, AppError> {
    Ok(ImageRequestSettingsContext {
        settings: settings_service.get_settings().await?,
        settings_key: request
            .settings_key
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| request.provider.clone()),
    })
}

async fn build_comfyui_request_context(
    request: &ImageGenerationRequest,
    settings_context: &ImageRequestSettingsContext,
    client: &reqwest::Client,
) -> Result<ComfyUiRequestContext, AppError> {
    let base_url = normalize_comfyui_base_url(
        resolve_string_setting(
            &settings_context.settings,
            &settings_context.settings_key,
            &request.provider,
            "base_url",
        )
        .as_deref()
        .unwrap_or("http://127.0.0.1:8188"),
    );

    Ok(ComfyUiRequestContext {
        checkpoint: resolve_comfyui_checkpoint(
            request,
            &settings_context.settings,
            &settings_context.settings_key,
            &base_url,
            client,
        )
        .await?,
        base_url,
        sampler: normalize_comfyui_sampler(request.sampler.as_deref()),
        scheduler: normalize_comfyui_scheduler(request.scheduler.as_deref()),
        seed: normalize_comfyui_seed(request.seed),
        steps: request.steps.unwrap_or(24),
        cfg_scale: request.cfg_scale.unwrap_or(7.0),
        width: request.width.unwrap_or(832),
        height: request.height.unwrap_or(1216),
        batch_size: request.batch_size.unwrap_or(1),
        negative_prompt: request.negative_prompt.clone().unwrap_or_default(),
        prompt_id: uuid::Uuid::new_v4().to_string(),
        client_id: uuid::Uuid::new_v4().to_string(),
    })
}

async fn queue_comfyui_prompt(
    client: &reqwest::Client,
    context: &ComfyUiRequestContext,
    workflow: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let response = client
        .post(format!("{}/prompt", context.base_url))
        .json(&serde_json::json!({
            "prompt": workflow,
            "client_id": context.client_id,
            "prompt_id": context.prompt_id,
        }))
        .send()
        .await
        .map_err(|error| AppError::External {
            request_id: None,
            message: format!("Failed to queue ComfyUI prompt: {error}"),
        })?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::External {
            request_id: None,
            message: format!("ComfyUI queue request failed: {body}"),
        });
    }

    response.json().await.map_err(|error| AppError::External {
        request_id: None,
        message: format!("Failed to parse ComfyUI queue response: {error}"),
    })
}

fn apply_saved_image_defaults(
    request: &mut ImageGenerationRequest,
    settings: &AppSettings,
    settings_key: &str,
) {
    if let Some(prefix) =
        resolve_string_setting(settings, settings_key, &request.provider, "positive_prompt")
    {
        request.prompt = format!("{prefix}, {}", request.prompt);
    }

    request.negative_prompt = request.negative_prompt.take().or_else(|| {
        resolve_string_setting(settings, settings_key, &request.provider, "negative_prompt")
    });
    request.steps = request
        .steps
        .or_else(|| resolve_u32_setting(settings, settings_key, &request.provider, "steps"));
    request.cfg_scale = request
        .cfg_scale
        .or_else(|| resolve_f32_setting(settings, settings_key, &request.provider, "cfg_scale"));
    request.denoising_strength = request.denoising_strength.or_else(|| {
        resolve_f32_setting(
            settings,
            settings_key,
            &request.provider,
            "denoising_strength",
        )
    });
    request.width = request
        .width
        .or_else(|| resolve_u32_setting(settings, settings_key, &request.provider, "width"));
    request.height = request
        .height
        .or_else(|| resolve_u32_setting(settings, settings_key, &request.provider, "height"));
    request.sampler = request
        .sampler
        .take()
        .or_else(|| resolve_string_setting(settings, settings_key, &request.provider, "sampler"));
    request.seed = request
        .seed
        .or_else(|| resolve_i32_setting(settings, settings_key, &request.provider, "seed"));
    request.batch_size = request
        .batch_size
        .or_else(|| resolve_u32_setting(settings, settings_key, &request.provider, "batch_size"));
    request.scheduler = request
        .scheduler
        .take()
        .or_else(|| resolve_string_setting(settings, settings_key, &request.provider, "scheduler"));
    request.clip_skip = request
        .clip_skip
        .or_else(|| resolve_i32_setting(settings, settings_key, &request.provider, "clip_skip"));
}

async fn clear_preview_file(path: &Path) {
    if let Err(error) = tokio::fs::remove_file(path).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::debug!(
            "Failed to clear stale preview file {}: {error}",
            path.display()
        );
    }
}

fn build_generated_image_content(images: &[String]) -> serde_json::Value {
    serde_json::Value::Array(
        images
            .iter()
            .map(|image| {
                serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": image
                    }
                })
            })
            .collect(),
    )
}

pub(super) fn resolve_string_setting(
    settings: &AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<String> {
    resolve_setting_value(settings, settings_key, provider_id, suffix).and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(super) fn resolve_u32_setting(
    settings: &AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<u32> {
    resolve_setting_value(settings, settings_key, provider_id, suffix)
        .and_then(|value| value.parse::<u32>().ok())
}

fn resolve_i32_setting(
    settings: &AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<i32> {
    resolve_setting_value(settings, settings_key, provider_id, suffix)
        .and_then(|value| value.parse::<i32>().ok())
}

pub(super) fn resolve_f32_setting(
    settings: &AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<f32> {
    resolve_setting_value(settings, settings_key, provider_id, suffix)
        .and_then(|value| value.parse::<f32>().ok())
}

fn resolve_setting_value(
    settings: &AppSettings,
    settings_key: &str,
    provider_id: &str,
    suffix: &str,
) -> Option<String> {
    for key in build_setting_candidates(settings_key, suffix) {
        if let Some(value) = settings.extra_settings.get(&key) {
            return Some(value.clone());
        }
    }

    if settings_key != provider_id {
        for key in build_setting_candidates(provider_id, suffix) {
            if let Some(value) = settings.extra_settings.get(&key) {
                return Some(value.clone());
            }
        }
    }

    None
}

fn build_setting_candidates(prefix: &str, suffix: &str) -> [String; 3] {
    [
        format!("{prefix}_{suffix}"),
        format!("{prefix}_{}", suffix.to_lowercase()),
        format!("{prefix}_{}", suffix.replace('_', "")),
    ]
}

fn normalize_sdcpp_sampler(value: Option<&str>) -> String {
    match value.unwrap_or("euler a").trim().to_lowercase().as_str() {
        "euler a" | "euler_a" => "euler_a".to_string(),
        "euler" => "euler".to_string(),
        "heun" => "heun".to_string(),
        "dpm2" => "dpm2".to_string(),
        "dpm++ 2s a" | "dpm++2s_a" | "dpmpp_2s_a" => "dpm++2s_a".to_string(),
        "dpm++ 2m" | "dpm++2m" | "dpmpp_2m" => "dpm++2m".to_string(),
        "dpm++ 2m v2" | "dpm++2mv2" | "dpmpp_2mv2" => "dpm++2mv2".to_string(),
        "ipndm" => "ipndm".to_string(),
        "ipndm_v" => "ipndm_v".to_string(),
        "er sde" | "er_sde" => "er_sde".to_string(),
        "lcm" => "lcm".to_string(),
        "ddim trailing" | "ddim_trailing" => "ddim_trailing".to_string(),
        "tcd" => "tcd".to_string(),
        "res multistep" | "res_multistep" => "res_multistep".to_string(),
        "res 2s" | "res_2s" => "res_2s".to_string(),
        other => other.to_string(),
    }
}

fn normalize_sdcpp_scheduler(value: Option<&str>) -> String {
    match value.unwrap_or("discrete").trim().to_lowercase().as_str() {
        "default" | "normal" | "discrete" => "discrete".to_string(),
        "karras" => "karras".to_string(),
        "exponential" => "exponential".to_string(),
        "ays" => "ays".to_string(),
        "gits" => "gits".to_string(),
        "smoothstep" => "smoothstep".to_string(),
        "sgm uniform" | "sgm_uniform" | "ddim_uniform" => "sgm_uniform".to_string(),
        "simple" => "simple".to_string(),
        "kl optimal" | "kl_optimal" => "kl_optimal".to_string(),
        "lcm" => "lcm".to_string(),
        "bong tangent" | "bong_tangent" => "bong_tangent".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ImageResponseFormat, build_cloud_image_payload, build_sdcpp_native_image_payload,
        parse_generated_images,
    };
    use crate::domain::ai::ImageGenerationRequest;
    use serde_json::json;

    fn make_cloud_request(model: &str) -> ImageGenerationRequest {
        ImageGenerationRequest {
            provider: "gpt-image".to_string(),
            prompt: "draw a cat".to_string(),
            original_prompt: None,
            model: model.to_string(),
            settings_key: None,
            session_id: None,
            steps: None,
            cfg_scale: None,
            denoising_strength: None,
            width: None,
            height: None,
            sampler: None,
            seed: None,
            clip_skip: None,
            negative_prompt: None,
            batch_size: None,
            scheduler: None,
        }
    }

    #[test]
    fn build_cloud_image_payload_uses_image_only_modalities_for_flux_models() {
        let payload =
            build_cloud_image_payload(&make_cloud_request("black-forest-labs/flux.2-max"));

        assert_eq!(payload.get("modalities"), Some(&json!(["image"])));
    }

    #[test]
    fn build_cloud_image_payload_uses_image_only_modalities_for_seedream_models() {
        let payload = build_cloud_image_payload(&make_cloud_request("bytedance-seed/seedream-4.5"));

        assert_eq!(payload.get("modalities"), Some(&json!(["image"])));
    }

    #[test]
    fn build_cloud_image_payload_keeps_text_output_for_gemini_image_models() {
        let payload =
            build_cloud_image_payload(&make_cloud_request("google/gemini-3.1-flash-image-preview"));

        assert_eq!(payload.get("modalities"), Some(&json!(["image", "text"])));
    }

    #[test]
    fn build_cloud_image_payload_keeps_text_output_for_gpt_image_models() {
        let payload = build_cloud_image_payload(&make_cloud_request("openai/gpt-5-image-mini"));

        assert_eq!(payload.get("modalities"), Some(&json!(["image", "text"])));
    }

    #[test]
    fn build_cloud_image_payload_uses_provider_specific_default_model() {
        let payload = build_cloud_image_payload(&ImageGenerationRequest {
            provider: "gpt-image".to_string(),
            model: "default".to_string(),
            ..make_cloud_request("default")
        });

        assert_eq!(payload.get("model"), Some(&json!("openai/gpt-5-image")));

        let payload = build_cloud_image_payload(&ImageGenerationRequest {
            provider: "seedream-image".to_string(),
            model: String::new(),
            ..make_cloud_request("")
        });

        assert_eq!(
            payload.get("model"),
            Some(&json!("bytedance-seed/seedream-4.5"))
        );
    }

    #[test]
    fn parses_stable_diffusion_webui_style_images() {
        let images = parse_generated_images(
            &json!({
                "images": ["ZmFrZQ=="],
                "parameters": {},
                "info": "{}"
            }),
            ImageResponseFormat::SdApi,
        );

        assert_eq!(images, vec!["data:image/png;base64,ZmFrZQ=="]);
    }

    #[test]
    fn builds_native_sdcpp_image_payload() {
        let payload = build_sdcpp_native_image_payload(&ImageGenerationRequest {
            provider: "sdcpp".to_string(),
            prompt: "draw a cat".to_string(),
            original_prompt: None,
            model: "default".to_string(),
            settings_key: None,
            session_id: None,
            steps: Some(30),
            cfg_scale: Some(8.5),
            denoising_strength: Some(0.42),
            width: Some(896),
            height: Some(1152),
            sampler: Some("Euler A".to_string()),
            seed: Some(42),
            clip_skip: Some(2),
            negative_prompt: Some("blurry".to_string()),
            batch_size: Some(1),
            scheduler: Some("Karras".to_string()),
        });

        assert_eq!(payload.get("prompt"), Some(&json!("draw a cat")));
        assert_eq!(payload.get("width"), Some(&json!(896)));
        assert_eq!(
            payload.pointer("/sample_params/sample_steps"),
            Some(&json!(30))
        );
        assert_eq!(
            payload.pointer("/sample_params/sample_method"),
            Some(&json!("euler_a"))
        );
        assert_eq!(
            payload.pointer("/sample_params/scheduler"),
            Some(&json!("karras"))
        );
        assert_eq!(
            payload.pointer("/sample_params/guidance/txt_cfg"),
            Some(&json!(8.5))
        );
        let strength = payload
            .pointer("/sample_params/strength")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or_default();
        assert!((strength - 0.42).abs() < 0.001);
    }

    #[test]
    fn normalizes_sdcpp_er_sde_sampler() {
        assert_eq!(
            build_sdcpp_native_image_payload(&ImageGenerationRequest {
                sampler: Some("ER SDE".to_string()),
                ..make_cloud_request("default")
            })
            .pointer("/sample_params/sample_method"),
            Some(&json!("er_sde"))
        );
    }

    #[test]
    fn parses_sdcpp_webui_result_images() {
        let images = parse_generated_images(
            &json!({
                "kind": "img_gen",
                "result": {
                    "output_format": "webp",
                    "images": [
                        { "b64_json": "ZmFrZQ==" }
                    ]
                }
            }),
            ImageResponseFormat::SdApi,
        );

        assert_eq!(images, vec!["data:image/webp;base64,ZmFrZQ=="]);
    }
}
