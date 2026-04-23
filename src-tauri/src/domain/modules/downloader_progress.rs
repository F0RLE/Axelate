use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize, Debug)]
pub struct DownloadProgress {
    pub module_id: String,
    pub status: String,
    pub progress: f32,
    pub message: String,
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ProgressSnapshot {
    pub downloaded: u64,
    pub total: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct AggregateDownloadContext {
    pub completed_bytes_before: u64,
    pub total_bytes: u64,
}

#[derive(Clone, Copy)]
pub struct DownloadProgressReporter<'a> {
    pub app: &'a AppHandle,
    pub module_id: &'a str,
    pub aggregate_context: Option<AggregateDownloadContext>,
}

#[derive(Clone, Copy)]
pub struct ProgressEvent<'a> {
    pub app: &'a AppHandle,
    pub module_id: &'a str,
    pub status: &'a str,
    pub message: &'a str,
    pub progress: f32,
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DownloadResult {
    pub asset_downloaded: u64,
    pub snapshot: ProgressSnapshot,
    pub interruption: Option<DownloadInterruption>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DownloadInterruption {
    Cancelled,
    Paused,
}

impl DownloadInterruption {
    pub const fn as_error_message(self) -> &'static str {
        match self {
            Self::Cancelled => "Download cancelled",
            Self::Paused => "Download paused",
        }
    }
}

impl DownloadProgressReporter<'_> {
    pub fn snapshot(self, asset_downloaded: u64, asset_total: u64) -> ProgressSnapshot {
        build_progress_snapshot(asset_downloaded, asset_total, self.aggregate_context)
    }

    pub fn emit_download(
        self,
        asset_downloaded: u64,
        asset_total: u64,
        speed: u64,
    ) -> ProgressSnapshot {
        let snapshot = self.snapshot(asset_downloaded, asset_total);
        emit_progress(ProgressEvent {
            app: self.app,
            module_id: self.module_id,
            status: "downloading",
            message: "Downloading...",
            progress: compute_progress(snapshot),
            downloaded: snapshot.downloaded,
            total: snapshot.total,
            speed,
        });
        snapshot
    }
}

#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
pub fn calculate_speed(window_bytes: u64, elapsed_secs: f64) -> u64 {
    if !(elapsed_secs.is_finite()) || elapsed_secs <= 0.0 {
        return 0;
    }

    (window_bytes as f64 / elapsed_secs).round() as u64
}

pub fn build_progress_snapshot(
    asset_downloaded: u64,
    asset_total: u64,
    aggregate_context: Option<AggregateDownloadContext>,
) -> ProgressSnapshot {
    if let Some(context) = aggregate_context {
        return ProgressSnapshot {
            downloaded: context.completed_bytes_before + asset_downloaded,
            total: context.total_bytes,
        };
    }

    ProgressSnapshot {
        downloaded: asset_downloaded,
        total: asset_total.max(asset_downloaded),
    }
}

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
pub fn compute_progress(snapshot: ProgressSnapshot) -> f32 {
    if snapshot.total > 0 {
        (snapshot.downloaded as f64 / snapshot.total as f64) as f32
    } else {
        -1.0
    }
}

pub fn combine_progress_phases(base: f32, span: f32, progress: f32) -> f32 {
    if progress.is_sign_negative() {
        return -1.0;
    }

    span.mul_add(progress, base).clamp(0.0, 1.0)
}

fn overall_progress_bytes(snapshot: Option<ProgressSnapshot>) -> (u64, u64) {
    snapshot.map_or((0, 0), |snapshot| (snapshot.downloaded, snapshot.total))
}

pub fn emit_verifying_progress(
    app: &AppHandle,
    module_id: &str,
    phase_progress: f32,
    snapshot: Option<ProgressSnapshot>,
    speed: u64,
) {
    let (downloaded, total) = overall_progress_bytes(snapshot);
    emit_progress(ProgressEvent {
        app,
        module_id,
        status: "verifying",
        message: "Verifying Integrity...",
        progress: phase_progress,
        downloaded,
        total,
        speed,
    });
}

pub fn emit_extraction_progress(
    app: &AppHandle,
    module_id: &str,
    message: &str,
    progress: f32,
    snapshot: Option<ProgressSnapshot>,
    speed: u64,
) {
    let (downloaded, total) = overall_progress_bytes(snapshot);
    emit_progress(ProgressEvent {
        app,
        module_id,
        status: "extracting",
        message,
        progress,
        downloaded,
        total,
        speed,
    });
}

pub fn emit_progress(event: ProgressEvent<'_>) {
    let _ = event.app.emit(
        "download_progress",
        DownloadProgress {
            module_id: event.module_id.to_string(),
            status: event.status.to_string(),
            progress: event.progress,
            message: event.message.to_string(),
            downloaded: event.downloaded,
            total: event.total,
            speed: event.speed,
        },
    );
}
