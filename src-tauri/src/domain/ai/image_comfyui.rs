use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::time::{Duration, Instant};

use super::image_http::build_image_client;
use super::image_settings::resolve_string_setting;
use super::types::ImageGenerationRequest;
use crate::domain::ai::ImageGenerationState;
use crate::errors::AppError;
use crate::infrastructure::config::settings::SettingsService;
use crate::models::AppSettings;

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

pub(super) async fn process_comfyui_request(
    request: &ImageGenerationRequest,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
) -> Result<Vec<String>, AppError> {
    let settings_context = load_image_request_settings_context(request, settings_service).await?;
    let client = build_image_client(Duration::from_mins(2))?;
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

    if let Some(saved_checkpoint) = resolve_string_setting(settings, settings_key, "checkpoint") {
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

async fn wait_for_comfyui_images(
    client: &reqwest::Client,
    base_url: &str,
    provider: &str,
    prompt_id: &str,
    image_generation_state: &ImageGenerationState,
) -> Result<Vec<String>, AppError> {
    let deadline = Instant::now() + Duration::from_mins(10);

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
