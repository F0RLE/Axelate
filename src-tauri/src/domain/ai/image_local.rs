//! Local image engine dispatch for sd.cpp and OpenAI-compatible image APIs.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::ai_dispatch::{LocalEngineAccess, active_local_engine_status, build_engine_config};
use super::ai_service::stop_conflicting_local_engine;
use super::image_http::{build_image_client, parse_image_response_body};
use super::image_payload::{build_local_image_payload, build_sdcpp_native_image_payload};
use super::image_response::{
    ImageResponseFormat, parse_generated_images, parse_sdcpp_generated_images,
    summarize_image_response_shape,
};
use super::types::ImageGenerationRequest;
use crate::domain::ai::ImageGenerationState;
use crate::domain::engine::manager::{EngineManager, resolve_sdcpp_preview_path};
use crate::domain::engine::types::{Capability, EngineDefinition};
use crate::errors::AppError;

struct PreparedImageDispatch {
    base_url: String,
    request_url: String,
    api: LocalImageApi,
    response_format: ImageResponseFormat,
    preview_path: Option<PathBuf>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LocalImageApi {
    SdcppNative,
    OpenAiCompatible,
}

pub(super) async fn process_local_image_request(
    request: &ImageGenerationRequest,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
    local_engine_access: LocalEngineAccess,
) -> Result<Vec<String>, AppError> {
    let dispatch =
        prepare_local_image_dispatch(request, engine_manager, local_engine_access).await?;
    image_generation_state
        .begin(&request.provider, &dispatch.base_url, None)
        .await;

    let result =
        execute_local_image_request(request, dispatch, engine_manager, image_generation_state)
            .await;
    image_generation_state.clear(&request.provider, None).await;

    result
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
    definition: &EngineDefinition,
) -> Result<(String, Option<PathBuf>), AppError> {
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
    engine_manager: &EngineManager,
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
            engine_manager,
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
    engine_manager: &EngineManager,
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
        engine_manager,
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
    engine_manager: &EngineManager,
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

        let response = match client.get(&job_url).send().await {
            Ok(response) => response,
            Err(error) => {
                let message = format!("Failed to poll stable-diffusion.cpp job: {error}");
                engine_manager
                    .stop_slot_after_error(Capability::Image, &message)
                    .await;
                return Err(AppError::External {
                    request_id: None,
                    message,
                });
            }
        };
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
