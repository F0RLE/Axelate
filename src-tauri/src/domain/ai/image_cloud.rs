//! Cloud image generation through OpenAI-compatible image models.

use std::time::Duration;

use super::image_http::{build_image_client, parse_image_response_body};
use super::image_payload::build_cloud_image_payload;
use super::image_provider_adapter;
use super::image_response::parse_cloud_generated_images;
use super::types::ImageGenerationRequest;
use crate::errors::AppError;
use crate::infrastructure::crypto::secure_storage::SecureStorage;

pub(super) fn is_cloud_image_provider(provider: &str) -> bool {
    image_provider_adapter::is_cloud_image_provider(provider)
}

pub(super) async fn process_cloud_image_request(
    request: &ImageGenerationRequest,
) -> Result<Vec<String>, AppError> {
    let api_key = SecureStorage::get_key_async("cloud_api_key".to_string())
        .await?
        .filter(|value| !value.trim().is_empty());

    // Legacy fallback for users who stored keys under the old name
    let api_key = match api_key {
        Some(key) => key,
        None => SecureStorage::get_key_async("openrouter_api_key".to_string())
            .await?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::Validation("Cloud API key is missing".to_string()))?,
    };

    let client = build_image_client(Duration::from_mins(3))?;
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
    let images = parse_cloud_generated_images(&body);
    if images.is_empty() {
        return Err(AppError::External {
            request_id: None,
            message: "Cloud image provider returned no images".to_string(),
        });
    }

    Ok(images)
}
