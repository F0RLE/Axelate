//! Shared state for active image-generation jobs.
//!
//! Keeps the current image request metadata so cancellation can route to the
//! correct backend without introducing process-global mutable state.

use tokio::sync::Mutex;

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
        });
    }

    /// Updates the prompt identifier for the current active job.
    pub async fn update_prompt_id(&self, provider: &str, prompt_id: String) {
        let mut guard = self.inner.lock().await;
        let Some(job) = guard.as_mut() else {
            return;
        };

        if job.provider == provider {
            job.prompt_id = Some(prompt_id);
        }
    }

    /// Returns the active job for the specified provider and marks it as cancelled.
    pub async fn cancel(&self, provider: &str) -> Option<ActiveImageJob> {
        let mut guard = self.inner.lock().await;
        let job = guard.as_mut()?;
        if job.provider != provider {
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

        if job.provider != provider || !job.cancelled {
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

        if job.provider != provider {
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
