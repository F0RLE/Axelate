//! Tauri-backed engine event emitter

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::ai::image_generation_state::{
    ImageGenerationProgressSnapshot, ImageGenerationState,
};
use crate::domain::engine::events::EngineEventEmitter;
use serde_json::json;
use tauri::Emitter;

/// Emits engine lifecycle events via the Tauri AppHandle.
#[derive(Debug)]
pub struct TauriEngineEmitter {
    handle: tauri::AppHandle,
    image_generation_state: Arc<ImageGenerationState>,
}

impl TauriEngineEmitter {
    /// Creates a new `TauriEngineEmitter` backed by the given AppHandle.
    pub const fn new(
        handle: tauri::AppHandle,
        image_generation_state: Arc<ImageGenerationState>,
    ) -> Self {
        Self {
            handle,
            image_generation_state,
        }
    }
}

fn canonical_image_engine_id(engine_id: &str) -> &str {
    match engine_id {
        "stable-diffusion" => "sdcpp",
        value => value,
    }
}

fn parse_step_totals(line: &str) -> Option<(u32, u32)> {
    for token in line.split_whitespace() {
        let Some((step, total)) = token.split_once('/') else {
            continue;
        };
        let Ok(step) = step.trim().parse::<u32>() else {
            continue;
        };
        let Ok(total) = total
            .trim_matches(|ch: char| !ch.is_ascii_digit())
            .parse::<u32>()
        else {
            continue;
        };
        if total > 0 {
            return Some((step, total));
        }
    }

    None
}

fn parse_percent(line: &str) -> Option<f32> {
    let percent_index = line.find('%')?;
    let prefix = line.get(..percent_index)?;
    let value = prefix.split_whitespace().last()?;
    let parsed = value.parse::<f32>().ok()?;
    if parsed.is_finite() {
        return Some((parsed / 100.0).clamp(0.0, 1.0));
    }

    None
}

fn parse_speed(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let (suffix_start, suffix) = lower
        .find("it/s")
        .map(|index| (index, "it/s"))
        .or_else(|| lower.find("s/it").map(|index| (index, "s/it")))?;
    let bytes = line.as_bytes();
    let mut start = suffix_start;
    while start > 0 {
        let previous = bytes.get(start - 1).copied()?;
        if previous.is_ascii_digit() || previous == b'.' {
            start -= 1;
            continue;
        }
        break;
    }
    if start == suffix_start {
        return None;
    }

    let value = line.get(start..suffix_start)?;
    Some(format!("{value}{suffix}"))
}

fn parse_sdcpp_progress_line(line: &str) -> Option<ImageGenerationProgressSnapshot> {
    let (step, total) =
        parse_step_totals(line).map_or((None, None), |(step, total)| (Some(step), Some(total)));
    let progress = step
        .zip(total)
        .and_then(|(step, total)| {
            let step = step.to_string().parse::<f32>().ok()?;
            let total = total.to_string().parse::<f32>().ok()?;
            Some((step / total).clamp(0.0, 1.0))
        })
        .or_else(|| parse_percent(line));
    let speed = parse_speed(line);

    if progress.is_none() && speed.is_none() {
        return None;
    }

    Some(ImageGenerationProgressSnapshot {
        progress,
        step,
        total,
        speed,
        updated_at_ms: current_time_ms_f64(),
    })
}

fn current_time_ms_f64() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |duration| duration.as_secs_f64() * 1000.0)
}

impl EngineEventEmitter for TauriEngineEmitter {
    fn emit_swapping(&self, from: &str, to: &str) {
        if let Err(error) = self
            .handle
            .emit("ai:engine:swapping", json!({ "from": from, "to": to }))
        {
            tracing::warn!("Failed to emit engine swapping event: {error}");
        }
    }

    fn emit_starting(&self, engine_id: &str) {
        if let Err(error) = self
            .handle
            .emit("ai:engine:starting", json!({ "engine_id": engine_id }))
        {
            tracing::warn!("Failed to emit engine starting event for {engine_id}: {error}");
        }
    }

    fn emit_ready(&self, engine_id: &str, endpoint: &str) {
        if let Err(error) = self.handle.emit(
            "ai:engine:ready",
            json!({ "engine_id": engine_id, "endpoint": endpoint }),
        ) {
            tracing::warn!("Failed to emit engine ready event for {engine_id}: {error}");
        }
    }

    fn emit_error(&self, engine_id: &str, message: &str) {
        if let Err(error) = self.handle.emit(
            "ai:engine:error",
            json!({ "engine_id": engine_id, "message": message }),
        ) {
            tracing::warn!("Failed to emit engine error event for {engine_id}: {error}");
        }
    }

    fn emit_log(&self, engine_id: &str, line: &str) {
        if engine_id == "sdcpp" || engine_id == "stable-diffusion" {
            crate::app::tray::update_background_generation_progress(&self.handle, line);
            if let Some(progress) = parse_sdcpp_progress_line(line) {
                let state = Arc::clone(&self.image_generation_state);
                let provider = canonical_image_engine_id(engine_id).to_string();
                tauri::async_runtime::spawn(async move {
                    state.update_progress(&provider, progress).await;
                });
            }
        }
        if let Err(error) = self.handle.emit(
            "ai:engine:log",
            json!({ "engine_id": engine_id, "line": line }),
        ) {
            tracing::warn!("Failed to emit engine log event for {engine_id}: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_sdcpp_progress_line;

    #[test]
    fn parses_sdcpp_steps_and_seconds_per_iteration() -> Result<(), String> {
        let progress = parse_sdcpp_progress_line("|===> | 6/30 - 140.70s/it\u{1b}[K")
            .ok_or_else(|| "progress".to_string())?;

        assert_eq!(progress.step, Some(6));
        assert_eq!(progress.total, Some(30));
        assert_eq!(progress.progress, Some(0.2));
        assert_eq!(progress.speed.as_deref(), Some("140.70s/it"));
        Ok(())
    }

    #[test]
    fn parses_sdcpp_iterations_per_second() -> Result<(), String> {
        let progress = parse_sdcpp_progress_line("|==============> | 8/28 - 1.03it/s")
            .ok_or_else(|| "progress".to_string())?;

        assert_eq!(progress.step, Some(8));
        assert_eq!(progress.total, Some(28));
        assert_eq!(progress.speed.as_deref(), Some("1.03it/s"));
        Ok(())
    }
}
