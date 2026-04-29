use std::path::PathBuf;

use super::types::{EngineComputeMode, EngineConfig};

const SDCPP_UNSUPPORTED_FLAGS: [&str; 4] = [
    "--diffusion-on-cpu",
    "--vae-on-gpu",
    "--clip-on-gpu",
    "--control-net-on-gpu",
];
const SDCPP_SERVER_UNSUPPORTED_FLAGS: [&str; 3] =
    ["--preview", "--preview-path", "--preview-interval"];

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

fn sdcpp_extra_args(config: &EngineConfig) -> Vec<String> {
    config
        .extra_args
        .iter()
        .filter(|arg| {
            !SDCPP_UNSUPPORTED_FLAGS.iter().any(|flag| {
                arg.as_str() == *flag
                    || arg
                        .strip_prefix(flag)
                        .is_some_and(|suffix| suffix.starts_with('='))
            }) && !SDCPP_SERVER_UNSUPPORTED_FLAGS.iter().any(|flag| {
                arg.as_str() == *flag
                    || arg
                        .strip_prefix(flag)
                        .is_some_and(|suffix| suffix.starts_with('='))
            })
        })
        .cloned()
        .collect()
}

/// Resolves the explicit stable-diffusion.cpp preview output path from extra arguments.
pub const fn resolve_sdcpp_preview_path(extra_args: &[String]) -> Option<PathBuf> {
    let _ = extra_args;
    None
}

pub(super) const fn sdcpp_preview_enabled(extra_args: &[String]) -> bool {
    let _ = extra_args;
    false
}

pub(super) fn build_sdcpp_args(config: &EngineConfig, port: u16) -> Vec<String> {
    let mut args = vec!["--listen-port".to_string(), port.to_string()];
    let extra_args = sdcpp_extra_args(config);

    if let Some(model_path) = config.model_path.as_deref() {
        args.push("--model".to_string());
        args.push(model_path.to_string());
    }

    args.extend(extra_args);
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
    args.extend(config.extra_args.clone());
    args
}
