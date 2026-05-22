#![allow(clippy::expect_used)]

use super::auth;
use super::http::{
    find_header_end, json_error, json_response, parse_header_line, parse_header_lines,
    parse_json_body, read_http_request, status_for_app_error, status_text,
};
use super::routing::{
    agent_provider_summary, backend_provider_id, ensure_launcher_client, ensure_module_route_owner,
    merge_json_settings, model_api_id, modules_visible_to_client, parse_agent_logs_query,
    parse_module_action, resolve_session_id, selected_module_from_api_provider,
    selected_module_from_catalog_item, selected_module_from_runtime_module,
    selection_category_for_runtime_module, tier_rank,
};
use super::types::{AuthorizedClient, IntegrationTextRequest, ModuleContextApiResponse};
use crate::domain::modules::controller::ModuleAction;
use crate::errors::AppError;
use crate::models::{
    AiModel, ApiModelConfig, ModelStats, ModelTier, Module, ModuleItem, ProviderType,
    SelectedModule,
};
use std::collections::HashMap;
use std::io::Write;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::time::Duration;

fn model_with_api_ids() -> AiModel {
    AiModel {
        id: "ui-model".to_string(),
        desc_key: String::new(),
        name: "Model".to_string(),
        desc: String::new(),
        tier: ModelTier::Strong,
        model_size: None,
        release_date: None,
        context_window: None,
        max_output_tokens: None,
        pricing: None,
        stats: ModelStats {
            speed: 1,
            logic: 2,
            creative: 3,
        },
        capabilities: None,
        api_models: Some(ApiModelConfig {
            text: Some("api-text".to_string()),
            image: Some("api-image".to_string()),
        }),
    }
}

#[test]
fn parses_http_header_lines_case_insensitively() {
    let (key, value) = parse_header_line("Authorization: Bearer abc").expect("header");
    assert_eq!(key, "authorization");
    assert_eq!(value, "Bearer abc");
}

#[test]
fn rejects_malformed_http_header_lines() {
    let error = parse_header_lines(["Host: localhost", "broken header"].into_iter())
        .expect_err("malformed header must fail");

    assert!(error.contains("Malformed HTTP header line"));
}

#[test]
fn rejects_duplicate_content_length_headers() {
    let error = parse_header_lines(["Content-Length: 1", "content-length: 2"].into_iter())
        .expect_err("duplicate content-length must fail");

    assert_eq!(error, "Duplicate content-length header");
}

#[test]
fn finds_standard_http_header_separator() {
    assert_eq!(find_header_end(b"GET / HTTP/1.1\r\n\r\n"), Some(14));
}

#[test]
fn authorization_accepts_bearer_token() {
    let mut headers = HashMap::new();
    headers.insert(
        "authorization".to_string(),
        format!("Bearer {}", super::api_token()),
    );
    assert!(auth::is_authorized(&headers));

    headers.insert(
        "authorization".to_string(),
        format!("bearer {}", super::api_token()),
    );
    assert!(auth::is_authorized(&headers));
}

#[test]
fn authorization_accepts_explicit_agent_token() {
    let token = "agent-token-123456789012345678901234567890";

    assert!(auth::agent_api_token_matches(token, Some(token)));
    assert!(!auth::agent_api_token_matches("wrong-token", Some(token)));
    assert!(!auth::agent_api_token_matches("short", Some("short")));
    assert!(!auth::agent_api_token_matches(token, None));
}

#[test]
fn authorization_rejects_old_header_token() {
    let mut headers = HashMap::new();
    headers.insert(
        "x-axelate-token".to_string(),
        super::api_token().to_string(),
    );

    assert!(!auth::is_authorized(&headers));
}

#[test]
fn authorization_maps_module_tokens_to_module_owner() {
    let token = auth::issue_module_api_token("sample-module").expect("module token");
    let mut headers = HashMap::new();
    headers.insert("authorization".to_string(), format!("Bearer {token}"));

    assert_eq!(
        auth::authorize_request(&headers),
        Some(AuthorizedClient::Module("sample-module".to_string()))
    );
    assert!(
        ensure_module_route_owner(
            &AuthorizedClient::Module("sample-module".to_string()),
            "sample-module"
        )
        .is_ok()
    );
    assert!(matches!(
        ensure_module_route_owner(
            &AuthorizedClient::Module("sample-module".to_string()),
            "other-module"
        ),
        Err(AppError::PermissionDenied(_))
    ));
}

#[test]
fn launcher_wide_agent_state_requires_launcher_client() {
    assert!(ensure_launcher_client(&AuthorizedClient::Launcher).is_ok());
    assert!(matches!(
        ensure_launcher_client(&AuthorizedClient::Module("sample-module".to_string())),
        Err(AppError::PermissionDenied(_))
    ));
}

#[test]
fn agent_logs_query_defaults_and_clamps_limit() {
    let defaults = parse_agent_logs_query("/v1/agent/logs").expect("defaults");
    assert_eq!(defaults.view_id, None);
    assert!(defaults.since.abs() < f64::EPSILON);
    assert_eq!(defaults.limit, 200);

    let parsed = parse_agent_logs_query("/v1/agent/logs?viewId=engine:sdcpp&since=12.5&limit=5000")
        .expect("query");
    assert_eq!(parsed.view_id.as_deref(), Some("engine:sdcpp"));
    assert!((parsed.since - 12.5).abs() < f64::EPSILON);
    assert_eq!(parsed.limit, 1000);
}

#[test]
fn agent_logs_query_rejects_invalid_since_and_limit() {
    assert!(parse_agent_logs_query("/v1/agent/logs?since=-1").is_err());
    assert!(parse_agent_logs_query("/v1/agent/logs?since=inf").is_err());
    assert!(parse_agent_logs_query("/v1/agent/logs?limit=0").is_err());
}

#[test]
fn issuing_new_module_token_invalidates_previous_token() {
    let old_token = auth::issue_module_api_token("rotating-module").expect("old token");
    let new_token = auth::issue_module_api_token("rotating-module").expect("new token");
    let mut headers = HashMap::new();

    headers.insert("authorization".to_string(), format!("Bearer {old_token}"));
    assert_eq!(auth::authorize_request(&headers), None);

    headers.insert("authorization".to_string(), format!("Bearer {new_token}"));
    assert_eq!(
        auth::authorize_request(&headers),
        Some(AuthorizedClient::Module("rotating-module".to_string()))
    );
}

#[test]
fn module_requests_default_to_module_scoped_session() {
    assert_eq!(
        resolve_session_id(None, &AuthorizedClient::Module("sample-module".to_string())),
        Some("integration:sample-module".to_string())
    );
    assert_eq!(
        resolve_session_id(
            Some(" explicit-session "),
            &AuthorizedClient::Module("sample-module".to_string())
        ),
        Some("explicit-session".to_string())
    );
}

#[test]
fn launcher_requests_without_session_do_not_use_ui_state() {
    assert_eq!(resolve_session_id(None, &AuthorizedClient::Launcher), None);
}

#[test]
fn authorization_rejects_malformed_bearer_values() {
    let mut headers = HashMap::new();
    headers.insert(
        "authorization".to_string(),
        format!("Bearer {} extra", super::api_token()),
    );
    assert!(!auth::is_authorized(&headers));

    headers.insert(
        "authorization".to_string(),
        format!("Token {}", super::api_token()),
    );
    assert!(!auth::is_authorized(&headers));
}

#[test]
fn maps_ui_model_id_to_capability_api_model() {
    let model = model_with_api_ids();
    assert_eq!(model_api_id(&model, "text").as_deref(), Some("api-text"));
    assert_eq!(model_api_id(&model, "image").as_deref(), Some("api-image"));
}

#[test]
fn maps_custom_ui_provider_ids_to_backend_providers() {
    assert_eq!(backend_provider_id("custom-text"), "gpt");
    assert_eq!(backend_provider_id("custom-image"), "gpt-image");
    assert_eq!(backend_provider_id("llamacpp"), "llamacpp");
}

#[test]
fn parses_text_request_without_prompt_when_messages_are_present() {
    let request = super::types::HttpRequest {
        method: "POST".to_string(),
        path: "/v1/ai/text".to_string(),
        headers: HashMap::new(),
        body: br#"{"messages":[{"id":"m1","role":"user","content":"hello"}]}"#.to_vec(),
    };

    let payload: IntegrationTextRequest = parse_json_body(&request).expect("payload");

    assert!(payload.prompt.is_none());
    assert_eq!(payload.messages.expect("messages").len(), 1);
}

#[test]
fn parses_module_settings_request_as_json_object() {
    let request = super::types::HttpRequest {
        method: "PUT".to_string(),
        path: "/v1/modules/sample/settings".to_string(),
        headers: HashMap::new(),
        body: br#"{"enabled":true,"threshold":3}"#.to_vec(),
    };

    let settings: HashMap<String, serde_json::Value> =
        parse_json_body(&request).expect("settings object");

    assert_eq!(
        settings.get("enabled").and_then(serde_json::Value::as_bool),
        Some(true)
    );
    assert_eq!(
        settings
            .get("threshold")
            .and_then(serde_json::Value::as_i64),
        Some(3)
    );
}

#[test]
fn rejects_module_settings_request_when_body_is_not_object() {
    let request = super::types::HttpRequest {
        method: "PUT".to_string(),
        path: "/v1/modules/sample/settings".to_string(),
        headers: HashMap::new(),
        body: br#"["not","an","object"]"#.to_vec(),
    };

    let error = parse_json_body::<HashMap<String, serde_json::Value>>(&request).expect_err("array");

    assert!(matches!(error, AppError::Validation(_)));
}

#[test]
fn patch_settings_merge_nested_objects_without_dropping_existing_keys() {
    let mut settings = HashMap::from([
        (
            "notifications".to_string(),
            serde_json::json!({
                "enabled": true,
                "channels": { "chat": true, "logs": true }
            }),
        ),
        ("theme".to_string(), serde_json::json!("dark")),
    ]);
    let updates = HashMap::from([
        (
            "notifications".to_string(),
            serde_json::json!({ "channels": { "logs": false } }),
        ),
        ("theme".to_string(), serde_json::json!("light")),
    ]);

    merge_json_settings(&mut settings, updates);

    assert_eq!(
        settings.get("notifications"),
        Some(&serde_json::json!({
            "enabled": true,
            "channels": { "chat": true, "logs": false }
        }))
    );
    assert_eq!(settings.get("theme"), Some(&serde_json::json!("light")));
}

#[test]
fn module_context_response_uses_public_camel_case_contract() {
    let response = serde_json::to_value(ModuleContextApiResponse {
        ok: true,
        api_version: "1",
        module_id: "sample".to_string(),
        module_dir: "module".to_string(),
        runtime_dir: "runtime".to_string(),
        module_runtime_dir: "module-runtime".to_string(),
        module_log_dir: "logs".to_string(),
        http_api_base: "http://127.0.0.1:3000".to_string(),
    })
    .expect("context response");

    assert_eq!(
        response
            .get("apiVersion")
            .and_then(serde_json::Value::as_str),
        Some("1")
    );
    assert_eq!(
        response.get("moduleId").and_then(serde_json::Value::as_str),
        Some("sample")
    );
    assert_eq!(
        response
            .get("moduleRuntimeDir")
            .and_then(serde_json::Value::as_str),
        Some("module-runtime")
    );
    assert_eq!(
        response
            .get("httpApiBase")
            .and_then(serde_json::Value::as_str),
        Some("http://127.0.0.1:3000")
    );
}

#[test]
fn apply_process_env_sets_documented_integration_contract() {
    let module_id = "sample";
    let mut command = tokio::process::Command::new("sample-command");
    super::apply_process_env(&mut command, module_id).expect("process env");

    let envs = command
        .as_std()
        .get_envs()
        .filter_map(|(key, value)| {
            Some((
                key.to_string_lossy().to_string(),
                value?.to_string_lossy().to_string(),
            ))
        })
        .collect::<HashMap<_, _>>();

    assert_eq!(
        envs.get("AXELATE_INTEGRATION_API_VERSION")
            .map(String::as_str),
        Some("1")
    );
    assert_eq!(
        envs.get("AXELATE_MODULE_ID").map(String::as_str),
        Some(module_id)
    );
    assert!(envs.contains_key("AXELATE_HTTP_API_BASE"));
    let token = envs
        .get("AXELATE_HTTP_API_TOKEN")
        .expect("module API token");
    let headers = HashMap::from([("authorization".to_string(), format!("Bearer {token}"))]);
    assert_eq!(
        auth::authorize_request(&headers),
        Some(AuthorizedClient::Module(module_id.to_string()))
    );
    assert!(envs.contains_key("AXELATE_MODULE_DIR"));
    assert!(envs.contains_key("AXELATE_RUNTIME_DIR"));
    assert!(envs.contains_key("AXELATE_MODULE_RUNTIME_DIR"));
    assert!(envs.contains_key("AXELATE_MODULE_LOG_DIR"));
}

#[test]
fn ranks_model_tiers_for_default_selection() {
    assert!(tier_rank(&ModelTier::Strong) > tier_rank(&ModelTier::Medium));
    assert_eq!(status_text(404), "Not Found");
}

#[test]
fn module_action_parser_accepts_integration_routes_only() {
    assert_eq!(
        parse_module_action("start").expect("start"),
        ModuleAction::Start
    );
    assert_eq!(
        parse_module_action("stop").expect("stop"),
        ModuleAction::Stop
    );
    assert_eq!(
        parse_module_action("restart").expect("restart"),
        ModuleAction::Restart
    );
    assert!(matches!(
        parse_module_action("install"),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn loopback_guard_rejects_missing_or_remote_peers() {
    assert!(auth::is_loopback_peer(Some(
        "127.0.0.1:3000".parse().expect("loopback socket")
    )));
    assert!(auth::is_loopback_peer(Some(
        "[::1]:3000".parse().expect("ipv6 loopback socket")
    )));
    assert!(!auth::is_loopback_peer(None));
    assert!(!auth::is_loopback_peer(Some(
        "192.168.1.10:3000".parse().expect("remote socket")
    )));
}

#[test]
fn json_response_helpers_preserve_status_and_error_shape() {
    let ok = json_response(200, serde_json::json!({ "ok": true }));
    let error = json_error(401, "denied");

    assert_eq!(ok.status, 200);
    assert_eq!(
        ok.body.get("ok").and_then(serde_json::Value::as_bool),
        Some(true)
    );
    assert_eq!(error.status, 401);
    assert_eq!(
        error.body.get("error").and_then(serde_json::Value::as_str),
        Some("denied")
    );
}

#[test]
fn selected_module_from_catalog_preserves_localized_metadata() {
    let module = ModuleItem {
        id: "llamacpp".to_string(),
        name_key: "ui.module.llamacpp".to_string(),
        desc_key: "ui.module.llamacpp.desc".to_string(),
        name: "llama.cpp".to_string(),
        desc: "Local text engine".to_string(),
        icon: "cpu".to_string(),
        preview: None,
        type_name: "local".to_string(),
        dl_type: None,
        capabilities: vec!["text".to_string()],
        binary: Some("llama-server".to_string()),
        repo_url: None,
        expected_hash: None,
        coming_soon: false,
        managed_externally: false,
        version: "1.0.0".to_string(),
        installed: true,
        raw_config_schema: None,
        config_schema: None,
    };

    let selected = selected_module_from_catalog_item(&module);

    assert_eq!(selected.id, "llamacpp");
    assert_eq!(selected.name_key.as_deref(), Some("ui.module.llamacpp"));
    assert_eq!(
        selected.desc_key.as_deref(),
        Some("ui.module.llamacpp.desc")
    );
    assert_eq!(selected.type_, "local");
}

#[test]
fn module_tokens_only_see_their_own_module_in_list_route() {
    fn module(id: &str) -> Module {
        Module {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            version: String::new(),
            author: String::new(),
            category: "service".to_string(),
            icon: String::new(),
            preview: None,
            path: String::new(),
            installed: true,
            local: true,
            enabled: false,
            status: None,
            is_deletable: true,
            config: HashMap::new(),
            config_schema: None,
            settings_ui: None,
        }
    }

    let visible = modules_visible_to_client(
        vec![module("owned-module"), module("other-module")],
        &AuthorizedClient::Module("owned-module".to_string()),
    );

    assert_eq!(visible.len(), 1);
    assert_eq!(
        visible.first().map(|module| module.id.as_str()),
        Some("owned-module")
    );
}

#[test]
fn selected_module_from_api_provider_maps_provider_type() {
    let provider = crate::models::ApiProvider {
        id: "cloud".to_string(),
        name: "Cloud".to_string(),
        desc_key: Some("ui.module.cloud.desc".to_string()),
        description: Some("Cloud provider".to_string()),
        icon: Some("cloud".to_string()),
        provider_type: Some(ProviderType::Openai),
        base_url: Some("https://api.example.test/v1".to_string()),
        api_key_env: None,
        models: None,
        capabilities: None,
        model_aliases: None,
    };
    let local = crate::models::ApiProvider {
        provider_type: Some(ProviderType::Local),
        ..provider.clone()
    };

    let selected_cloud: SelectedModule = selected_module_from_api_provider(&provider);
    let selected_local = selected_module_from_api_provider(&local);

    assert_eq!(selected_cloud.type_, "api");
    assert_eq!(selected_cloud.desc, "Cloud provider");
    assert_eq!(selected_local.type_, "local");
}

#[test]
fn runtime_module_selection_maps_service_modules_to_services_card() {
    let module = Module {
        id: "telegram-parser".to_string(),
        name: "Telegram Parser".to_string(),
        description: "Reads exports".to_string(),
        version: "1.0.0".to_string(),
        author: "Axelate".to_string(),
        category: "service".to_string(),
        icon: "box".to_string(),
        preview: None,
        path: String::new(),
        installed: true,
        local: true,
        enabled: false,
        status: Some("running".to_string()),
        is_deletable: true,
        config: HashMap::new(),
        config_schema: None,
        settings_ui: None,
    };

    let selected = selected_module_from_runtime_module(&module);

    assert_eq!(selection_category_for_runtime_module(&module), "services");
    assert_eq!(selected.id, "telegram-parser");
    assert_eq!(selected.name, "Telegram Parser");
    assert_eq!(selected.type_, "local");
    assert_eq!(selected.desc, "Reads exports");
}

#[test]
fn runtime_module_selection_maps_ai_modules_to_text_slot() {
    let module = Module {
        id: "local-agent".to_string(),
        name: "Local Agent".to_string(),
        description: "AI module".to_string(),
        version: "1.0.0".to_string(),
        author: "Axelate".to_string(),
        category: "AI".to_string(),
        icon: "cpu".to_string(),
        preview: None,
        path: String::new(),
        installed: true,
        local: true,
        enabled: false,
        status: Some("running".to_string()),
        is_deletable: true,
        config: HashMap::new(),
        config_schema: None,
        settings_ui: None,
    };

    assert_eq!(selection_category_for_runtime_module(&module), "ai_text");
}

#[test]
fn agent_provider_summary_does_not_expose_secret_or_endpoint_fields() {
    let provider = crate::models::ApiProvider {
        id: "custom-text".to_string(),
        name: "Custom Text".to_string(),
        desc_key: None,
        description: Some("Custom provider".to_string()),
        icon: Some("AI".to_string()),
        provider_type: Some(ProviderType::OpenaiCompatible),
        base_url: Some("https://api.example.test/v1".to_string()),
        api_key_env: Some("CUSTOM_TEXT_API_KEY".to_string()),
        models: Some(vec![model_with_api_ids()]),
        capabilities: Some(vec!["text".to_string()]),
        model_aliases: None,
    };

    let summary = serde_json::to_value(agent_provider_summary(&provider)).expect("summary");

    assert_eq!(
        summary.get("id").and_then(serde_json::Value::as_str),
        Some("custom-text")
    );
    assert!(summary.get("baseUrl").is_none());
    assert!(summary.get("apiKeyEnv").is_none());
    assert_eq!(
        summary
            .get("models")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len),
        Some(1)
    );
}

#[test]
fn maps_app_errors_to_http_status_codes() {
    assert_eq!(
        status_for_app_error(&AppError::Validation("bad input".to_string())),
        400
    );
    assert_eq!(
        status_for_app_error(&AppError::NotFound("missing".to_string())),
        404
    );
    assert_eq!(
        status_for_app_error(&AppError::PermissionDenied("denied".to_string())),
        403
    );
    assert_eq!(status_for_app_error(&AppError::Io("disk".to_string())), 500);
}

#[test]
fn rejects_http_body_larger_than_limit_before_waiting_for_body() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
    let addr = listener.local_addr().expect("local addr");
    let client = std::thread::spawn(move || {
        let mut stream = TcpStream::connect(addr).expect("connect test listener");
        write!(
            stream,
            "POST /v1/ai/text HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
            super::http::MAX_REQUEST_BYTES + 1
        )
        .expect("write request");
    });

    let (mut stream, _) = listener.accept().expect("accept test client");
    let error = read_http_request(&mut stream).expect_err("oversized body must fail");
    client.join().expect("client thread");

    assert_eq!(error, "HTTP request body is too large");
}

#[test]
fn reads_headers_without_waiting_for_full_body() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
    let addr = listener.local_addr().expect("local addr");
    let client = std::thread::spawn(move || {
        let mut stream = TcpStream::connect(addr).expect("connect test listener");
        stream
            .write_all(b"POST /v1/ai/text HTTP/1.1\r\nContent-Length: 8\r\n\r\nabc")
            .expect("write partial request");
        std::thread::sleep(Duration::from_millis(200));
        stream.shutdown(Shutdown::Write).expect("shutdown write");
    });

    let (mut stream, _) = listener.accept().expect("accept test client");
    let request = super::http::read_http_request_head(&mut stream).expect("request head");

    assert_eq!(request.path, "/v1/ai/text");
    assert_eq!(request.body, b"abc");
    let error = super::http::complete_http_request_body(&mut stream, request)
        .expect_err("remaining body should still be required");
    client.join().expect("client thread");
    assert!(error.contains("expected 8 bytes, got 3"));
}

#[test]
fn rejects_http_body_shorter_than_content_length() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
    let addr = listener.local_addr().expect("local addr");
    let client = std::thread::spawn(move || {
        let mut stream = TcpStream::connect(addr).expect("connect test listener");
        stream
            .write_all(b"POST /v1/ai/text HTTP/1.1\r\nContent-Length: 8\r\n\r\nabc")
            .expect("write request");
        stream.shutdown(Shutdown::Write).expect("shutdown write");
    });

    let (mut stream, _) = listener.accept().expect("accept test client");
    let error = read_http_request(&mut stream).expect_err("truncated body must fail");
    client.join().expect("client thread");

    assert!(error.contains("expected 8 bytes, got 3"));
}

#[test]
fn rejects_malformed_http_request_line() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
    let addr = listener.local_addr().expect("local addr");
    let client = std::thread::spawn(move || {
        let mut stream = TcpStream::connect(addr).expect("connect test listener");
        stream
            .write_all(b"GET /v1/health HTTP/1.1 extra\r\n\r\n")
            .expect("write request");
        stream.shutdown(Shutdown::Write).expect("shutdown write");
    });

    let (mut stream, _) = listener.accept().expect("accept test client");
    let error = read_http_request(&mut stream).expect_err("bad request line must fail");
    client.join().expect("client thread");

    assert_eq!(error, "HTTP request line has too many parts");
}
