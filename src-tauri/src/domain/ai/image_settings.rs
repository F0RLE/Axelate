//! Saved image generation settings resolution.

use super::types::ImageGenerationRequest;
use crate::errors::AppError;
use crate::infrastructure::config::settings::SettingsService;
use crate::models::AppSettings;

struct ImageRequestSettingsContext {
    settings: AppSettings,
    settings_key: String,
}

pub(super) async fn apply_image_request_defaults(
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
