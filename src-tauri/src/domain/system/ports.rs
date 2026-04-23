use std::net::{SocketAddr, TcpListener};
use std::ops::RangeInclusive;

use crate::errors::AppError;

/// Reserved localhost range for the launcher's own HTTP server and adjacent services.
pub const LAUNCHER_LOCAL_PORT_RANGE: RangeInclusive<u16> = 3000..=3099;

/// Reserved localhost range for managed local engines.
pub const ENGINE_LOCAL_PORT_RANGE: RangeInclusive<u16> = 8081..=8199;

/// Logical owner of a local port allocation.
#[derive(Debug, Clone, Copy)]
pub enum LocalPortPurpose<'a> {
    /// Launcher-owned local HTTP API server.
    LauncherHttp,
    /// Managed local engine process.
    Engine(&'a str),
}

impl LocalPortPurpose<'_> {
    fn label(self) -> String {
        match self {
            Self::LauncherHttp => "launcher HTTP server".to_string(),
            Self::Engine(engine_id) => format!("engine '{engine_id}'"),
        }
    }
}

/// Returns the first free localhost port inside the allowed range, preferring the requested port.
pub fn find_available_local_port(
    preferred_port: u16,
    allowed_range: RangeInclusive<u16>,
    purpose: LocalPortPurpose<'_>,
) -> Result<u16, AppError> {
    let range_start = *allowed_range.start();
    let range_end = *allowed_range.end();
    let clamped_preferred = preferred_port.clamp(range_start, range_end);

    for candidate in iterate_candidates(clamped_preferred, allowed_range) {
        if TcpListener::bind(("127.0.0.1", candidate)).is_ok() {
            return Ok(candidate);
        }
    }

    Err(AppError::Config(format!(
        "No free localhost port available for {} in range {}-{} (preferred {})",
        purpose.label(),
        range_start,
        range_end,
        preferred_port
    )))
}

/// Binds a Tokio listener on the first free localhost port inside the allowed range.
pub async fn bind_available_local_listener(
    preferred_port: u16,
    allowed_range: RangeInclusive<u16>,
    purpose: LocalPortPurpose<'_>,
) -> Result<tokio::net::TcpListener, AppError> {
    let range_start = *allowed_range.start();
    let range_end = *allowed_range.end();
    let clamped_preferred = preferred_port.clamp(range_start, range_end);

    for candidate in iterate_candidates(clamped_preferred, allowed_range) {
        let address = SocketAddr::from(([127, 0, 0, 1], candidate));
        if let Ok(listener) = tokio::net::TcpListener::bind(address).await {
            return Ok(listener);
        }
    }

    Err(AppError::Config(format!(
        "No free localhost port available for {} in range {}-{} (preferred {})",
        purpose.label(),
        range_start,
        range_end,
        preferred_port
    )))
}

fn iterate_candidates(
    preferred_port: u16,
    allowed_range: RangeInclusive<u16>,
) -> impl Iterator<Item = u16> {
    let start = *allowed_range.start();
    let end = *allowed_range.end();
    (preferred_port..=end).chain(start..preferred_port)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::{
        ENGINE_LOCAL_PORT_RANGE, LAUNCHER_LOCAL_PORT_RANGE, LocalPortPurpose,
        bind_available_local_listener, find_available_local_port,
    };
    use std::net::TcpListener;

    #[test]
    fn finds_preferred_port_inside_engine_range() {
        let port = 8084;
        let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
        drop(listener);

        let selected = find_available_local_port(
            port,
            ENGINE_LOCAL_PORT_RANGE,
            LocalPortPurpose::Engine("llamacpp"),
        )
        .unwrap();

        assert_eq!(selected, port);
    }

    #[test]
    fn clamps_preferred_port_into_allowed_range() {
        let selected = find_available_local_port(
            65_000,
            LAUNCHER_LOCAL_PORT_RANGE,
            LocalPortPurpose::LauncherHttp,
        )
        .unwrap();

        assert!(LAUNCHER_LOCAL_PORT_RANGE.contains(&selected));
    }

    #[tokio::test]
    async fn binds_listener_inside_launcher_range() {
        let listener = bind_available_local_listener(
            3000,
            LAUNCHER_LOCAL_PORT_RANGE,
            LocalPortPurpose::LauncherHttp,
        )
        .await
        .unwrap();

        let port = listener.local_addr().unwrap().port();
        assert!(LAUNCHER_LOCAL_PORT_RANGE.contains(&port));
    }
}
