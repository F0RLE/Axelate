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
const SDCPP_LAUNCHER_ONLY_PREVIEW_FLAG: &str = "--sdcpp-preview";

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
    match config.compute_mode {
        EngineComputeMode::Gpu => {}
        EngineComputeMode::Cpu => {
            args.push("--clip-on-cpu".to_string());
            args.push("--vae-on-cpu".to_string());
        }
    }
}

fn sdcpp_extra_args(config: &EngineConfig) -> Vec<String> {
    let unsupported_flags = SDCPP_UNSUPPORTED_FLAGS
        .iter()
        .chain(SDCPP_SERVER_UNSUPPORTED_FLAGS.iter())
        .copied()
        .chain(std::iter::once(SDCPP_LAUNCHER_ONLY_PREVIEW_FLAG))
        .collect::<Vec<_>>();
    let mut filtered = Vec::new();
    let mut index = 0;

    while let Some(arg) = config.extra_args.get(index) {
        let should_skip = unsupported_flags.iter().any(|flag| {
            arg.as_str() == *flag
                || arg
                    .strip_prefix(flag)
                    .is_some_and(|suffix| suffix.starts_with('='))
        });

        if should_skip {
            let skip_value = unsupported_flags.contains(&arg.as_str())
                && config
                    .extra_args
                    .get(index + 1)
                    .is_some_and(|next| !next.starts_with('-'));
            index += if skip_value { 2 } else { 1 };
            continue;
        }

        filtered.push(arg.clone());
        index += 1;
    }

    filtered
}

/// Resolves the explicit stable-diffusion.cpp preview output path from extra arguments.
pub fn resolve_sdcpp_preview_path(extra_args: &[String]) -> Option<PathBuf> {
    let mut index = 0;
    while let Some(arg) = extra_args.get(index) {
        if let Some(path) = arg
            .strip_prefix(SDCPP_LAUNCHER_ONLY_PREVIEW_FLAG)
            .and_then(|suffix| suffix.strip_prefix('='))
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(PathBuf::from(path));
        }

        if arg == SDCPP_LAUNCHER_ONLY_PREVIEW_FLAG
            && let Some(path) = extra_args
                .get(index + 1)
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && !value.starts_with('-'))
        {
            return Some(PathBuf::from(path));
        }

        index += 1;
    }

    None
}

pub(super) fn sdcpp_preview_enabled(extra_args: &[String]) -> bool {
    resolve_sdcpp_preview_path(extra_args).is_some()
        || extra_args.iter().any(|arg| {
            arg == SDCPP_LAUNCHER_ONLY_PREVIEW_FLAG
                || arg
                    .strip_prefix(SDCPP_LAUNCHER_ONLY_PREVIEW_FLAG)
                    .is_some_and(|suffix| suffix.starts_with('='))
        })
}

pub(super) fn build_sdcpp_args(config: &EngineConfig, port: u16) -> Vec<String> {
    let mut args = vec!["--listen-port".to_string(), port.to_string()];
    let extra_args = sdcpp_extra_args(config);
    push_sdcpp_compute_args(&mut args, config);

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
