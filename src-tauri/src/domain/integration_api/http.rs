//! Low-level HTTP request/response parsing for the local integration API.

use super::types::{HttpRequest, HttpResponse};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub(super) const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[cfg(test)]
pub(super) fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let request = read_http_request_head(stream)?;
    complete_http_request_body(stream, request)
}

pub(super) fn read_http_request_head(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Failed to configure read timeout: {error}"))?;

    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("Failed to read request: {error}"))?;
        if read == 0 {
            return Err("HTTP request ended before headers completed".to_string());
        }
        let read_chunk = chunk
            .get(..read)
            .ok_or_else(|| "Internal HTTP read buffer range is invalid".to_string())?;
        buffer.extend_from_slice(read_chunk);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("HTTP request is too large".to_string());
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let header_bytes = buffer
        .get(..header_end)
        .ok_or_else(|| "Internal HTTP header range is invalid".to_string())?;
    let header_text = std::str::from_utf8(header_bytes)
        .map_err(|error| format!("Invalid HTTP header encoding: {error}"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "HTTP request line is missing".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "HTTP method is missing".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "HTTP path is missing".to_string())?
        .to_string();
    let version = request_parts
        .next()
        .ok_or_else(|| "HTTP version is missing".to_string())?;
    if request_parts.next().is_some() {
        return Err("HTTP request line has too many parts".to_string());
    }
    if !version.starts_with("HTTP/") {
        return Err(format!("Unsupported HTTP version: {version}"));
    }

    let headers = parse_header_lines(lines)?;
    let content_length = headers.get("content-length").map_or(Ok(0_usize), |value| {
        value
            .parse::<usize>()
            .map_err(|error| format!("Invalid content-length: {error}"))
    })?;
    if content_length > MAX_REQUEST_BYTES {
        return Err("HTTP request body is too large".to_string());
    }

    let body_start = header_end
        .checked_add(4)
        .ok_or_else(|| "Internal HTTP body offset overflowed".to_string())?;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    body.truncate(content_length);

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

pub(super) fn complete_http_request_body(
    stream: &mut TcpStream,
    mut request: HttpRequest,
) -> Result<HttpRequest, String> {
    let content_length = request
        .headers
        .get("content-length")
        .map_or(Ok(0_usize), |value| {
            value
                .parse::<usize>()
                .map_err(|error| format!("Invalid content-length: {error}"))
        })?;
    if content_length > MAX_REQUEST_BYTES {
        return Err("HTTP request body is too large".to_string());
    }
    let mut chunk = [0_u8; 4096];
    while request.body.len() < content_length {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("Failed to read request body: {error}"))?;
        if read == 0 {
            return Err(format!(
                "HTTP request body ended before content-length was reached: expected {content_length} bytes, got {}",
                request.body.len()
            ));
        }
        let read_chunk = chunk
            .get(..read)
            .ok_or_else(|| "Internal HTTP body buffer range is invalid".to_string())?;
        request.body.extend_from_slice(read_chunk);
        if request.body.len() > MAX_REQUEST_BYTES {
            return Err("HTTP request body is too large".to_string());
        }
    }
    request.body.truncate(content_length);

    Ok(request)
}

pub(super) fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

pub(super) fn parse_header_line(line: &str) -> Option<(String, String)> {
    let (name, value) = line.split_once(':')?;
    Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
}

pub(super) fn parse_header_lines<'a>(
    lines: impl Iterator<Item = &'a str>,
) -> Result<HashMap<String, String>, String> {
    let mut headers = HashMap::new();

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        let Some((name, value)) = parse_header_line(line) else {
            return Err(format!("Malformed HTTP header line: {line}"));
        };

        if name.is_empty() {
            return Err("HTTP header name is empty".to_string());
        }

        if name == "content-length" && headers.contains_key("content-length") {
            return Err("Duplicate content-length header".to_string());
        }

        headers.insert(name, value);
    }

    Ok(headers)
}

pub(super) fn write_http_response(
    stream: &mut TcpStream,
    response: &HttpResponse,
) -> Result<(), std::io::Error> {
    let body = serde_json::to_vec(&response.body)?;
    let status_text = status_text(response.status);
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        status_text,
        body.len()
    )?;
    stream.write_all(&body)?;
    stream.flush()
}

pub(super) const fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Unknown",
    }
}

pub(super) fn write_response_or_log(stream: &mut TcpStream, response: &HttpResponse) {
    if let Err(error) = write_http_response(stream, response) {
        tracing::warn!("Failed to write launcher HTTP API response: {error}");
    }
}

pub(super) const fn json_response(status: u16, body: serde_json::Value) -> HttpResponse {
    HttpResponse { status, body }
}

pub(super) fn json_error(status: u16, error: &str) -> HttpResponse {
    HttpResponse {
        status,
        body: serde_json::json!({ "ok": false, "error": error }),
    }
}

pub(super) const fn status_for_app_error(error: &crate::errors::AppError) -> u16 {
    use crate::errors::AppError;
    match error {
        AppError::Validation(_) | AppError::Config(_) => 400,
        AppError::NotFound(_) => 404,
        AppError::PermissionDenied(_) | AppError::FrontendSecretForbidden(_) => 403,
        AppError::Io(_)
        | AppError::Serialization(_)
        | AppError::External { .. }
        | AppError::Internal { .. } => 500,
    }
}

pub(super) fn parse_json_body<T: for<'de> serde::Deserialize<'de>>(
    request: &HttpRequest,
) -> Result<T, crate::errors::AppError> {
    serde_json::from_slice(&request.body).map_err(|error| {
        crate::errors::AppError::Validation(format!("Invalid JSON request body: {error}"))
    })
}

pub(super) fn request_path(request: &HttpRequest) -> &str {
    request.path.split('?').next().unwrap_or(&request.path)
}
