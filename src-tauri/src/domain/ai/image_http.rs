//! Shared HTTP helpers for image generation adapters.

use std::time::Duration;

use crate::errors::AppError;

pub(super) fn build_image_client(timeout: Duration) -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(timeout)
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(4)
        .build()
        .map_err(|error| AppError::External {
            request_id: None,
            message: error.to_string(),
        })
}

pub(super) async fn parse_image_response_body(
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
