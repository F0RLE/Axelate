use std::path::PathBuf;

use super::types::{EngineComputeMode, EngineConfig};

fn is_qwen_model(model_path: Option<&str>) -> bool {
    model_path.is_some_and(|path| path.to_ascii_lowercase().contains("qwen"))
}

fn has_arg(args: &[String], candidates: &[&str]) -> bool {
    args.iter().any(|arg| {
        candidates.iter().any(|candidate| {
            arg == candidate
                || arg
                    .strip_prefix(candidate)
                    .is_some_and(|suffix| suffix.starts_with('='))
        })
    })
}

fn push_arg_if_missing(
    args: &mut Vec<String>,
    existing_args: &[String],
    candidates: &[&str],
    value: Option<&str>,
) {
    if has_arg(args, candidates) || has_arg(existing_args, candidates) {
        return;
    }

    let Some(candidate) = candidates.first() else {
        return;
    };

    args.push((*candidate).to_string());
    if let Some(value) = value {
        args.push(value.to_string());
    }
}

fn extract_arg_value(args: &[String], candidates: &[&str]) -> Option<String> {
    for (index, arg) in args.iter().enumerate() {
        for candidate in candidates {
            if arg == candidate {
                if let Some(value) = args.get(index + 1) {
                    return Some(value.clone());
                }
            }

            let prefix = format!("{candidate}=");
            if let Some(value) = arg.strip_prefix(&prefix) {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn push_llamacpp_compute_args(args: &mut Vec<String>, config: &EngineConfig) {
    match config.compute_mode {
        EngineComputeMode::Gpu => {
            args.push("-ngl".to_string());
            args.push("all".to_string());
        }
        EngineComputeMode::Cpu => {
            args.push("--device".to_string());
            args.push("none".to_string());
            args.push("-ngl".to_string());
            args.push("0".to_string());
        }
    }
}

fn push_sdcpp_compute_args(args: &mut Vec<String>, config: &EngineConfig) {
    if config.compute_mode != EngineComputeMode::Cpu {
        return;
    }

    push_arg_if_missing(args, &config.extra_args, &["--offload-to-cpu"], None);
    push_arg_if_missing(args, &config.extra_args, &["--clip-on-cpu"], None);
    push_arg_if_missing(args, &config.extra_args, &["--vae-on-cpu"], None);
}

/// Resolves the explicit stable-diffusion.cpp preview output path from extra arguments.
pub fn resolve_sdcpp_preview_path(extra_args: &[String]) -> Option<PathBuf> {
    extract_arg_value(extra_args, &["--preview-path"]).map(PathBuf::from)
}

pub(super) fn sdcpp_preview_enabled(extra_args: &[String]) -> bool {
    extract_arg_value(extra_args, &["--preview"])
        .is_none_or(|value| !value.trim().eq_ignore_ascii_case("none"))
}

pub(super) fn build_sdcpp_args(config: &EngineConfig, port: u16) -> Vec<String> {
    let mut args = vec!["--listen-port".to_string(), port.to_string()];

    if let Some(model_path) = config.model_path.as_deref() {
        args.push("--model".to_string());
        args.push(model_path.to_string());
    }

    push_sdcpp_compute_args(&mut args, config);
    args.extend(config.extra_args.clone());
    args
}

pub(super) fn build_llamacpp_args(config: &EngineConfig, port: u16) -> Vec<String> {
    let effective_context_size = config.context_size.max(4096);
    let mut args = vec![
        "--port".to_string(),
        port.to_string(),
        "--ctx-size".to_string(),
        effective_context_size.to_string(),
    ];
    push_llamacpp_compute_args(&mut args, config);

    push_arg_if_missing(
        &mut args,
        &config.extra_args,
        &["--parallel", "-np"],
        Some("1"),
    );
    push_arg_if_missing(
        &mut args,
        &config.extra_args,
        &["--reasoning", "-rea"],
        Some("off"),
    );

    if is_qwen_model(config.model_path.as_deref()) {
        push_arg_if_missing(&mut args, &config.extra_args, &["--jinja"], None);
        push_arg_if_missing(
            &mut args,
            &config.extra_args,
            &["--reasoning-format"],
            Some("deepseek"),
        );
        push_arg_if_missing(&mut args, &config.extra_args, &["--no-context-shift"], None);
        push_arg_if_missing(&mut args, &config.extra_args, &["--flash-attn"], Some("on"));
    }

    args
}
