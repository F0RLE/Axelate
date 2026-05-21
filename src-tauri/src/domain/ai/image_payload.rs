//! Image generation payload normalization.

use super::types::ImageGenerationRequest;

pub(super) fn build_sdcpp_native_image_payload(
    request: &ImageGenerationRequest,
) -> serde_json::Value {
    serde_json::json!({
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt.clone().unwrap_or_default(),
        "clip_skip": request.clip_skip.unwrap_or(-1),
        "width": request.width.unwrap_or(512),
        "height": request.height.unwrap_or(512),
        "seed": request.seed.unwrap_or(-1),
        "batch_count": request.batch_size.unwrap_or(1),
        "strength": request.denoising_strength.unwrap_or(0.75),
        "sample_params": {
            "scheduler": normalize_sdcpp_scheduler(request.scheduler.as_deref()),
            "sample_method": normalize_sdcpp_sampler(request.sampler.as_deref()),
            "sample_steps": request.steps.unwrap_or(20),
            "guidance": {
                "txt_cfg": request.cfg_scale.unwrap_or(7.0)
            }
        },
        "output_format": "png",
        "output_compression": 100
    })
}

pub(super) fn build_local_image_payload(request: &ImageGenerationRequest) -> serde_json::Value {
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

pub(super) fn build_cloud_image_payload(request: &ImageGenerationRequest) -> serde_json::Value {
    let model = resolve_cloud_image_model(request);
    let mut payload = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": request.prompt
            }
        ],
        "modalities": resolve_cloud_modalities(model)
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

    if let Some(image_config) = build_cloud_image_config(request)
        && let Some(payload_object) = payload.as_object_mut()
    {
        payload_object.insert("image_config".to_string(), image_config);
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

fn resolve_cloud_modalities(model: &str) -> &'static [&'static str] {
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

fn build_cloud_image_config(request: &ImageGenerationRequest) -> Option<serde_json::Value> {
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

fn normalize_sdcpp_sampler(value: Option<&str>) -> String {
    match value.unwrap_or("euler a").trim().to_lowercase().as_str() {
        "dpm++ 2m" | "dpmpp_2m" => "dpm++2m".to_string(),
        "dpm++ 2m v2" | "dpm++2m v2" | "dpm++2m_v2" | "dpmpp_2m_v2" => "dpm++2mv2".to_string(),
        "dpm++ 2s a" | "dpmpp_2s_a" => "dpm++2s_a".to_string(),
        "euler a" | "euler_a" => "euler_a".to_string(),
        "er sde" | "er_sde" => "er_sde".to_string(),
        "res 2s" | "res_2s" => "res_2s".to_string(),
        "res multistep" | "res_multistep" => "res_multistep".to_string(),
        "ddim trailing" | "ddim_trailing" => "ddim_trailing".to_string(),
        other => other.replace(' ', "_"),
    }
}

fn normalize_sdcpp_scheduler(value: Option<&str>) -> String {
    match value.unwrap_or("discrete").trim().to_lowercase().as_str() {
        "sgm uniform" | "sgm_uniform" => "sgm_uniform".to_string(),
        "kl optimal" | "kl_optimal" => "kl_optimal".to_string(),
        "bong tangent" | "bong_tangent" => "bong_tangent".to_string(),
        other => other.replace(' ', "_"),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_cloud_image_payload, build_sdcpp_native_image_payload};
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
            .get("strength")
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
    fn normalizes_sdcpp_dpmpp_2m_v2_sampler_to_official_name() {
        assert_eq!(
            build_sdcpp_native_image_payload(&ImageGenerationRequest {
                sampler: Some("DPM++ 2M v2".to_string()),
                ..make_cloud_request("default")
            })
            .pointer("/sample_params/sample_method"),
            Some(&json!("dpm++2mv2"))
        );
    }
}
