//! Shared HTTP helpers for AI provider adapters.
//!
//! Mirrors the Open WebUI idea of keeping transport concerns separate from
//! provider routing and response normalization.

use reqwest::{Client, StatusCode};

pub(super) fn build_provider_client() -> Client {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .pool_max_idle_per_host(8)
        .build()
        .unwrap_or_else(|_| Client::new())
}

pub(super) const fn should_retry_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

pub(super) fn should_retry_error(error: &reqwest::Error) -> bool {
    error.is_connect() || error.is_timeout()
}

pub(super) fn retry_delay(attempt: u32, status: StatusCode) -> std::time::Duration {
    let capped_attempt = attempt.max(1);
    let base_ms = if status == StatusCode::TOO_MANY_REQUESTS {
        700u64
    } else {
        350u64
    };
    let backoff_multiplier = 2u64.saturating_pow(capped_attempt.saturating_sub(1));
    let jitter_ms = rand::random_range(0..150u64);
    let delay_ms = base_ms
        .saturating_mul(backoff_multiplier)
        .saturating_add(jitter_ms);

    std::time::Duration::from_millis(delay_ms)
}
