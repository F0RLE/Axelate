use std::fs::File;
use std::io::Write;
use std::time::Duration;

use tokio::io::AsyncRead;
use tracing::{info, warn};

use crate::domain::system::ports::{
    ENGINE_LOCAL_PORT_RANGE, LocalPortPurpose,
    find_available_local_port as find_reserved_local_port,
};
use crate::errors::AppError;

use super::events::EngineEventEmitter;

fn is_progress_log_line(line: &str) -> bool {
    line.contains("it/s") || line.contains("s/it") || line.contains('%')
}

pub(super) fn find_available_local_port(
    preferred_port: u16,
    engine_id: &str,
) -> Result<u16, AppError> {
    find_reserved_local_port(
        preferred_port,
        ENGINE_LOCAL_PORT_RANGE,
        LocalPortPurpose::Engine(engine_id),
    )
}

pub(super) fn classify_engine_start_failure(log: &str) -> Option<String> {
    let normalized = log.to_ascii_lowercase();

    if normalized.contains("out of memory")
        || normalized.contains("cudamalloc failed")
        || normalized.contains("failed to allocate compute")
    {
        return Some(
            "Not enough memory to start the local model. Reduce context size, switch compute mode, or use a smaller model."
                .to_string(),
        );
    }

    if normalized.contains("paging file is too small")
        || normalized.contains("cannot allocate memory")
        || normalized.contains("bad_alloc")
    {
        return Some(
            "Not enough system memory to start the local model. Close other apps or use a smaller model."
                .to_string(),
        );
    }

    None
}

fn write_engine_log_line(file: &mut File, line: &str) {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S");
    let _ = writeln!(file, "{timestamp} [INFO] {}", line.trim());
}

pub(super) async fn diagnose_engine_start_failure(stderr_path: &std::path::Path) -> Option<String> {
    let raw = tokio::fs::read_to_string(stderr_path).await.ok()?;
    classify_engine_start_failure(&raw)
}

pub(super) fn spawn_log_reader<R>(
    mut stream: R,
    mut file: Option<File>,
    emitter: std::sync::Arc<dyn EngineEventEmitter>,
    engine_id: String,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;

        let mut buf = [0u8; 1024];
        let mut current_line = String::new();

        while let Ok(n) = stream.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let Some(bytes) = buf.get(..n) else {
                break;
            };
            let chunk = String::from_utf8_lossy(bytes);
            for c in chunk.chars() {
                if c == '\n' || c == '\r' {
                    if !current_line.is_empty() {
                        if let Some(ref mut f) = file {
                            write_engine_log_line(f, &current_line);
                        }
                        let trimmed = current_line.trim();
                        if is_progress_log_line(trimmed) {
                            emitter.emit_log(&engine_id, trimmed);
                        }
                        current_line.clear();
                    }
                } else {
                    current_line.push(c);
                }
            }
        }

        if !current_line.is_empty() {
            let trimmed = current_line.trim();
            if is_progress_log_line(trimmed) {
                emitter.emit_log(&engine_id, trimmed);
            }
        }
    });
}

pub(super) async fn wait_for_health(endpoint: &str) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let health_endpoints = [
        format!("{endpoint}/health"),
        format!("{endpoint}/v1/models"),
        format!("{endpoint}/"),
    ];

    let max_attempts = 120;
    let interval = Duration::from_millis(500);

    for attempt in 1..=max_attempts {
        for health_url in &health_endpoints {
            match client.get(health_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    info!(attempt, url = %health_url, "Engine health check passed");
                    return Ok(());
                }
                Ok(resp) => {
                    if attempt % 20 == 0 {
                        warn!(attempt, url = %health_url, status = %resp.status(), "Health check polling...");
                    }
                }
                Err(_) => {}
            }
        }
        tokio::time::sleep(interval).await;
    }

    Err(AppError::External {
        request_id: None,
        message: format!(
            "Engine health check timed out after {max_attempts} attempts (60s). Check engine logs for details."
        ),
    })
}

pub(super) async fn is_endpoint_healthy(endpoint: &str) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(900))
        .build()
    else {
        return false;
    };

    for health_url in [
        format!("{endpoint}/health"),
        format!("{endpoint}/v1/models"),
        format!("{endpoint}/"),
    ] {
        if matches!(client.get(&health_url).send().await, Ok(resp) if resp.status().is_success()) {
            return true;
        }
    }

    false
}
