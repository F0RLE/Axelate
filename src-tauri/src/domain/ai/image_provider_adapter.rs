//! Image provider routing for cloud, local, and native engine protocols.

use crate::domain::ai::ImageGenerationState;
use crate::domain::engine::manager::EngineManager;
use crate::domain::engine::types::Capability;
use crate::errors::AppError;

const COMFYUI_PROVIDER_ID: &str = "comfyui";
const SDCPP_PROVIDER_ID: &str = "sdcpp";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LocalImageProtocol {
    SdcppNative,
    OpenAiCompatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ImageProviderRoute {
    CloudOpenRouter,
    ComfyUi,
    Local(LocalImageProtocol),
}

pub(super) fn route_for_image_provider(provider: &str) -> ImageProviderRoute {
    match provider {
        "gemini-image" | "gpt-image" | "seedream-image" => ImageProviderRoute::CloudOpenRouter,
        COMFYUI_PROVIDER_ID => ImageProviderRoute::ComfyUi,
        SDCPP_PROVIDER_ID => ImageProviderRoute::Local(LocalImageProtocol::SdcppNative),
        _ => ImageProviderRoute::Local(LocalImageProtocol::OpenAiCompatible),
    }
}

pub(super) fn is_cloud_image_provider(provider: &str) -> bool {
    route_for_image_provider(provider) == ImageProviderRoute::CloudOpenRouter
}

pub(super) fn local_image_protocol(provider: &str) -> Option<LocalImageProtocol> {
    match route_for_image_provider(provider) {
        ImageProviderRoute::Local(protocol) => Some(protocol),
        ImageProviderRoute::CloudOpenRouter | ImageProviderRoute::ComfyUi => None,
    }
}

/// Cancels the active image-generation job for the selected provider.
pub async fn cancel_image_provider_generation(
    provider: &str,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
) -> Result<(), AppError> {
    match route_for_image_provider(provider) {
        ImageProviderRoute::ComfyUi => cancel_comfyui_job(provider, image_generation_state).await,
        ImageProviderRoute::Local(LocalImageProtocol::SdcppNative) => {
            cancel_sdcpp_job(provider, engine_manager, image_generation_state).await
        }
        ImageProviderRoute::Local(LocalImageProtocol::OpenAiCompatible) => {
            image_generation_state.cancel(provider).await;
            engine_manager.stop_slot(Capability::Image).await
        }
        ImageProviderRoute::CloudOpenRouter => {
            image_generation_state.cancel(provider).await;
            Ok(())
        }
    }
}

async fn cancel_comfyui_job(
    provider: &str,
    image_generation_state: &ImageGenerationState,
) -> Result<(), AppError> {
    if let Some(job) = image_generation_state.cancel(provider).await {
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/interrupt", job.base_url.trim_end_matches('/')))
            .send()
            .await
            .map_err(|error| AppError::External {
                request_id: None,
                message: format!("Failed to interrupt ComfyUI job: {error}"),
            })?;

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
    image_generation_state: &ImageGenerationState,
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
            .await
            .map_err(|error| AppError::External {
                request_id: None,
                message: format!("Failed to cancel stable-diffusion.cpp job: {error}"),
            })?;

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

#[cfg(test)]
mod tests {
    use super::{
        ImageProviderRoute, LocalImageProtocol, local_image_protocol, route_for_image_provider,
    };

    #[test]
    fn routes_native_image_protocols_by_adapter() {
        assert_eq!(
            route_for_image_provider("sdcpp"),
            ImageProviderRoute::Local(LocalImageProtocol::SdcppNative)
        );
        assert_eq!(
            local_image_protocol("custom-image-engine"),
            Some(LocalImageProtocol::OpenAiCompatible)
        );
    }

    #[test]
    fn routes_non_local_image_adapters() {
        assert_eq!(
            route_for_image_provider("comfyui"),
            ImageProviderRoute::ComfyUi
        );
        assert_eq!(
            route_for_image_provider("gpt-image"),
            ImageProviderRoute::CloudOpenRouter
        );
    }
}
