use std::path::{Path, PathBuf};

use crate::errors::AppError;

use super::types::{EngineComputeMode, EngineConfig};

fn is_qwen_model(model_path: Option<&str>) -> bool {
    model_path.is_some_and(|path| path.to_ascii_lowercase().contains("qwen"))
}

fn is_qwen_image_model(model_path: Option<&str>) -> bool {
    model_path.is_some_and(|path| {
        let normalized = path.replace('\\', "/").to_ascii_lowercase();
        normalized.contains("qwen-image") || normalized.contains("qwen_image")
    })
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

/// Resolves the explicit stable-diffusion.cpp preview output path from extra arguments.
pub fn resolve_sdcpp_preview_path(extra_args: &[String]) -> Option<PathBuf> {
    extract_arg_value(extra_args, &["--preview-path"]).map(PathBuf::from)
}

pub(super) fn sdcpp_preview_enabled(extra_args: &[String]) -> bool {
    extract_arg_value(extra_args, &["--preview"])
        .is_none_or(|value| !value.trim().eq_ignore_ascii_case("none"))
}

fn find_companion_model_file(
    model_path: &Path,
    stems: &[&str],
    extensions: &[&str],
) -> Option<String> {
    let model_dir = model_path.parent()?;
    let mut entries = std::fs::read_dir(model_dir)
        .ok()?
        .flatten()
        .collect::<Vec<_>>();
    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();

        if extensions.iter().all(|candidate| extension != *candidate) {
            continue;
        }

        if stems.iter().any(|stem| file_name.contains(stem)) {
            return Some(path.to_string_lossy().to_string());
        }
    }

    None
}

fn resolve_qwen_image_support_file(
    model_path: &Path,
    extra_args: &[String],
    arg_names: &[&str],
    stems: &[&str],
    extensions: &[&str],
) -> Option<String> {
    extract_arg_value(extra_args, arg_names)
        .or_else(|| find_companion_model_file(model_path, stems, extensions))
}

fn qwen_image_requirements_error(model_path: &str) -> AppError {
    AppError::Validation(format!(
        "Qwen Image model '{model_path}' needs companion files for stable-diffusion.cpp. Place 'qwen_image_vae.safetensors' and 'Qwen2.5-VL-7B-Instruct*.gguf' next to the selected model, or pass '--vae' and '--llm' in Extra Arguments."
    ))
}

pub(super) fn build_sdcpp_args(config: &EngineConfig, port: u16) -> Result<Vec<String>, AppError> {
    let mut args = vec!["--listen-port".to_string(), port.to_string()];

    if let Some(model_path) = config.model_path.as_deref() {
        if is_qwen_image_model(Some(model_path)) {
            let model_path_buf = Path::new(model_path);
            let vae_path = resolve_qwen_image_support_file(
                model_path_buf,
                &config.extra_args,
                &["--vae"],
                &["qwen_image_vae", "qwen-image-vae"],
                &["safetensors"],
            );
            let llm_path = resolve_qwen_image_support_file(
                model_path_buf,
                &config.extra_args,
                &["--llm"],
                &["qwen2.5-vl", "qwen2_5_vl", "qwen25-vl", "qwen25_vl"],
                &["gguf"],
            );

            if vae_path.is_none() || llm_path.is_none() {
                return Err(qwen_image_requirements_error(model_path));
            }

            args.push("--diffusion-model".to_string());
            args.push(model_path.to_string());
            push_arg_if_missing(
                &mut args,
                &config.extra_args,
                &["--vae"],
                vae_path.as_deref(),
            );
            push_arg_if_missing(
                &mut args,
                &config.extra_args,
                &["--llm"],
                llm_path.as_deref(),
            );
        } else {
            args.push("--model".to_string());
            args.push(model_path.to_string());
        }
    }

    args.extend(config.extra_args.clone());
    Ok(args)
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
