//! Shared state for active image-generation jobs.
//!
//! Keeps the current image request metadata so cancellation can route to the
//! correct backend without introducing process-global mutable state.

use tokio::sync::Mutex;

fn provider_matches(active: &str, candidate: &str) -> bool {
    active == candidate
        || matches!(
            (active, candidate),
            ("sdcpp", "stable-diffusion") | ("stable-diffusion", "sdcpp")
        )
}

/// Latest progress parsed from a local image engine log line.
#[derive(Debug, Clone, Default)]
pub struct ImageGenerationProgressSnapshot {
    /// Current progress normalized to `0.0..=1.0`.
    pub progress: Option<f32>,
    /// Current sampling step.
    pub step: Option<u32>,
    /// Total sampling steps.
    pub total: Option<u32>,
    /// Latest reported generation speed, for example `1.07s/it`.
    pub speed: Option<String>,
    /// Wall-clock update timestamp in Unix milliseconds.
    pub updated_at_ms: f64,
}

/// Active in-flight image-generation job metadata.
#[derive(Debug, Clone, Default)]
pub struct ActiveImageJob {
    /// Backend/provider identifier (for example `sdcpp` or `comfyui`).
    pub provider: String,
    /// Base URL used by the current request.
    pub base_url: String,
    /// Backend prompt/job identifier when available.
    pub prompt_id: Option<String>,
    /// Whether cancellation was requested for this job.
    pub cancelled: bool,
    /// Latest parsed progress from engine logs.
    pub progress: Option<ImageGenerationProgressSnapshot>,
}

/// Concurrency-safe holder for the active image job.
#[derive(Debug, Default)]
pub struct ImageGenerationState {
    inner: Mutex<Option<ActiveImageJob>>,
}

impl ImageGenerationState {
    /// Creates an empty image-generation state store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Marks a new image job as active.
    pub async fn begin(&self, provider: &str, base_url: &str, prompt_id: Option<String>) {
        let mut guard = self.inner.lock().await;
        *guard = Some(ActiveImageJob {
            provider: provider.to_string(),
            base_url: base_url.to_string(),
            prompt_id,
            cancelled: false,
            progress: None,
        });
    }

    /// Stores the latest progress snapshot for the active provider job.
    pub async fn update_progress(&self, provider: &str, progress: ImageGenerationProgressSnapshot) {
        let mut guard = self.inner.lock().await;
        let Some(job) = guard.as_mut() else {
            return;
        };

        if provider_matches(&job.provider, provider) {
            job.progress = Some(progress);
        }
    }

    /// Returns the latest progress snapshot for an active provider job.
    pub async fn latest_progress(&self, provider: &str) -> Option<ImageGenerationProgressSnapshot> {
        let guard = self.inner.lock().await;
        let job = guard.as_ref()?;
        if provider_matches(&job.provider, provider) {
            return job.progress.clone();
        }

        None
    }

    /// Updates the prompt identifier for the current active job.
    pub async fn update_prompt_id(&self, provider: &str, prompt_id: String) {
        let mut guard = self.inner.lock().await;
        let Some(job) = guard.as_mut() else {
            return;
        };

        if provider_matches(&job.provider, provider) {
            job.prompt_id = Some(prompt_id);
        }
    }

    /// Returns the active job for the specified provider and marks it as cancelled.
    pub async fn cancel(&self, provider: &str) -> Option<ActiveImageJob> {
        let mut guard = self.inner.lock().await;
        let job = guard.as_mut()?;
        if !provider_matches(&job.provider, provider) {
            return None;
        }

        job.cancelled = true;
        Some(job.clone())
    }

    /// Checks whether cancellation was requested for the active provider job.
    pub async fn is_cancelled(&self, provider: &str, prompt_id: Option<&str>) -> bool {
        let guard = self.inner.lock().await;
        let Some(job) = guard.as_ref() else {
            return false;
        };

        if !provider_matches(&job.provider, provider) || !job.cancelled {
            return false;
        }

        match (job.prompt_id.as_deref(), prompt_id) {
            (Some(active_prompt_id), Some(candidate)) => active_prompt_id == candidate,
            (_, None) | (None, Some(_)) => true,
        }
    }

    /// Clears the active job if it matches the provider and optional prompt id.
    pub async fn clear(&self, provider: &str, prompt_id: Option<&str>) {
        let mut guard = self.inner.lock().await;
        let Some(job) = guard.as_ref() else {
            return;
        };

        if !provider_matches(&job.provider, provider) {
            return;
        }

        let prompt_matches = match (job.prompt_id.as_deref(), prompt_id) {
            (Some(active_prompt_id), Some(candidate)) => active_prompt_id == candidate,
            (_, None) | (None, Some(_)) => true,
        };

        if prompt_matches {
            *guard = None;
        }
    }
}
