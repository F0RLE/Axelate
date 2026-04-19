use crate::domain::system::hardware_probe::{
    AcceleratorClass, CpuInstructionTier, GpuInfo, probe_gpu_info,
};

use super::github_releases::{
    Asset, HardwareProfile, Platform, PlatformArch, PlatformOs, ReleaseAsset,
};

pub(super) async fn detect_hardware_profile() -> HardwareProfile {
    let probe = probe_gpu_info().await;
    HardwareProfile::from_probe(&probe)
}

pub(super) fn current_platform() -> Platform {
    Platform::current()
}

pub(super) fn select_release_assets(
    module_id: &str,
    platform: Platform,
    hardware: HardwareProfile,
    assets: &[Asset],
) -> Option<Vec<ReleaseAsset>> {
    let runtime_candidates = runtime_assets(module_id, platform, assets);
    let main_candidates = main_assets(module_id, platform, hardware, assets);

    if main_candidates.is_empty() {
        return None;
    }

    if module_id != "comfyui"
        && platform.os == PlatformOs::Windows
        && hardware.accelerator == AcceleratorClass::NvidiaCuda
    {
        let has_cuda_main = main_candidates.iter().copied().any(|idx| {
            assets
                .get(idx)
                .and_then(|asset| detect_cuda_track(&asset.name))
                .is_some()
        });

        for main_idx in &main_candidates {
            let main = assets.get(*main_idx)?;
            if let Some(cuda_track) = detect_cuda_track(&main.name)
                && let Some(runtime_idx) = runtime_candidates.iter().copied().find(|idx| {
                    assets
                        .get(*idx)
                        .is_some_and(|asset| detect_cuda_track(&asset.name) == Some(cuda_track))
                })
            {
                return Some(vec![
                    asset_to_release_asset(assets.get(runtime_idx)?)?,
                    asset_to_release_asset(main)?,
                ]);
            }

            if detect_cuda_track(&main.name).is_some() {
                continue;
            }

            if !has_cuda_main {
                return Some(vec![asset_to_release_asset(main)?]);
            }
        }

        if has_cuda_main {
            return None;
        }
    }

    let selected_main = main_candidates.first().copied()?;
    Some(vec![asset_to_release_asset(assets.get(selected_main)?)?])
}

fn runtime_assets(module_id: &str, platform: Platform, assets: &[Asset]) -> Vec<usize> {
    let mut indices: Vec<usize> = assets
        .iter()
        .enumerate()
        .filter(|(_, asset)| {
            is_runtime_asset(module_id, &asset.name)
                && platform_matches(module_id, platform, &asset.name)
        })
        .map(|(idx, _)| idx)
        .collect();

    indices.sort_by_key(|idx| {
        std::cmp::Reverse(
            assets
                .get(*idx)
                .map_or(i32::MIN, |asset| runtime_score(&asset.name)),
        )
    });
    indices
}

fn main_assets(
    module_id: &str,
    platform: Platform,
    hardware: HardwareProfile,
    assets: &[Asset],
) -> Vec<usize> {
    let mut indices: Vec<usize> = assets
        .iter()
        .enumerate()
        .filter(|(_, asset)| {
            is_main_asset(module_id, &asset.name)
                && platform_matches(module_id, platform, &asset.name)
        })
        .map(|(idx, _)| idx)
        .collect();

    indices.sort_by_key(|idx| {
        std::cmp::Reverse(assets.get(*idx).map_or(i32::MIN, |asset| {
            main_score(module_id, &asset.name, hardware)
        }))
    });
    indices
}

fn parse_sha256_digest(digest: Option<&str>) -> Option<String> {
    let value = digest?.trim();
    let hash = value.strip_prefix("sha256:")?;
    if hash.len() != 64 || !hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }

    Some(hash.to_ascii_lowercase())
}

fn asset_to_release_asset(asset: &Asset) -> Option<ReleaseAsset> {
    Some(ReleaseAsset {
        name: asset.name.clone(),
        download_url: asset.browser_download_url.clone(),
        size: asset.size,
        sha256: parse_sha256_digest(asset.digest.as_deref())?,
    })
}

fn is_runtime_asset(module_id: &str, name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if !is_archive_asset(&lower) {
        return false;
    }

    match module_id {
        "sdcpp" => lower.starts_with("cudart-sd-"),
        "llamacpp" => lower.starts_with("cudart-llama-"),
        _ => lower.starts_with("cudart-"),
    }
}

fn is_main_asset(module_id: &str, name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if !is_archive_asset(&lower) || lower.contains("source code") {
        return false;
    }

    match module_id {
        "sdcpp" => lower.starts_with("sd-") && lower.contains("-bin-"),
        "llamacpp" => lower.starts_with("llama-") && lower.contains("-bin-"),
        "comfyui" => lower.starts_with("comfyui_windows_portable_"),
        _ => !lower.starts_with("cudart-"),
    }
}

fn is_archive_asset(lower_name: &str) -> bool {
    lower_name.ends_with(".tar.gz")
        || std::path::Path::new(lower_name)
            .extension()
            .is_some_and(|ext| {
                ext.eq_ignore_ascii_case("zip")
                    || ext.eq_ignore_ascii_case("tgz")
                    || ext.eq_ignore_ascii_case("7z")
            })
}

fn platform_matches(module_id: &str, platform: Platform, name: &str) -> bool {
    let lower = name.to_ascii_lowercase();

    os_matches(platform.os, &lower) && arch_matches(module_id, platform.arch, &lower)
}

fn os_matches(os: PlatformOs, lower_name: &str) -> bool {
    match os {
        PlatformOs::Windows => lower_name.contains("win"),
        PlatformOs::Linux => lower_name.contains("linux") || lower_name.contains("ubuntu"),
        PlatformOs::Macos => lower_name.contains("darwin") || lower_name.contains("macos"),
        PlatformOs::Other => true,
    }
}

fn arch_matches(module_id: &str, arch: PlatformArch, lower_name: &str) -> bool {
    match arch {
        PlatformArch::X64 => {
            lower_name.contains("x64")
                || lower_name.contains("x86_64")
                || lower_name.contains("amd64")
                || (module_id == "comfyui"
                    && !lower_name.contains("arm64")
                    && !lower_name.contains("aarch64")
                    && !lower_name.contains("-x86")
                    && !lower_name.contains("_x86"))
        }
        PlatformArch::Arm64 => lower_name.contains("arm64") || lower_name.contains("aarch64"),
        PlatformArch::X86 => lower_name.contains("-x86") || lower_name.contains("_x86"),
        PlatformArch::Other => true,
    }
}

fn main_score(module_id: &str, name: &str, hardware: HardwareProfile) -> i32 {
    let lower = name.to_ascii_lowercase();
    if module_id == "comfyui" {
        return comfyui_main_score(&lower, hardware);
    }

    let mut score = base_main_score(&lower);

    match hardware.accelerator {
        AcceleratorClass::NvidiaCuda => {
            if detect_cuda_track(&lower).is_some() {
                score += 1_000;
            }
            if lower.contains("vulkan")
                || lower.contains("rocm")
                || lower.contains("hip")
                || lower.contains("sycl")
                || lower.contains("openvino")
            {
                score -= 200;
            }
        }
        AcceleratorClass::AmdGpu => {
            if module_id == "llamacpp" && (lower.contains("hip") || lower.contains("rocm")) {
                score += 1_300;
            } else if lower.contains("vulkan") {
                score += 800;
            }
            if detect_cuda_track(&lower).is_some()
                || lower.contains("sycl")
                || lower.contains("openvino")
            {
                score -= 500;
            }
        }
        AcceleratorClass::IntelGpu => {
            if module_id == "llamacpp" && (lower.contains("sycl") || lower.contains("openvino")) {
                score += 1_300;
            } else if lower.contains("vulkan") {
                score += 800;
            }
            if detect_cuda_track(&lower).is_some()
                || lower.contains("hip")
                || lower.contains("rocm")
            {
                score -= 500;
            }
        }
        AcceleratorClass::GenericGpu => {
            if lower.contains("vulkan") {
                score += 1_000;
            }
            if lower.contains("sycl") || lower.contains("openvino") {
                score += 300;
            }
            if detect_cuda_track(&lower).is_some()
                || lower.contains("hip")
                || lower.contains("rocm")
            {
                score -= 500;
            }
        }
        AcceleratorClass::CpuOnly => {
            if detect_cuda_track(&lower).is_some()
                || lower.contains("vulkan")
                || lower.contains("rocm")
                || lower.contains("hip")
                || lower.contains("sycl")
                || lower.contains("openvino")
            {
                score -= 1_000;
            }

            score += cpu_feature_score(&lower, hardware.cpu_tier);
        }
        AcceleratorClass::Unknown => {}
    }

    score
}

fn comfyui_main_score(lower: &str, hardware: HardwareProfile) -> i32 {
    let mut score = 0;

    if lower.contains("portable") {
        score += 50;
    }

    match hardware.accelerator {
        AcceleratorClass::NvidiaCuda => {
            if lower.contains("nvidia_cu126") {
                if hardware.supports_cuda_at_least(12, 6) {
                    score += 1_500;
                } else {
                    score -= 1_500;
                }
            } else if lower.contains("nvidia") {
                score += 1_300;
            } else {
                score -= 1_000;
            }
        }
        AcceleratorClass::AmdGpu => {
            if lower.contains("amd") {
                score += 1_300;
            } else {
                score -= 1_000;
            }
        }
        _ => {
            if lower.contains("nvidia") || lower.contains("amd") {
                score -= 800;
            }
        }
    }

    score
}

pub(super) fn base_main_score(lower: &str) -> i32 {
    let mut score = 0;
    if let Some(cuda_track) = detect_cuda_track(lower) {
        score += match cuda_track {
            "cuda13" => 500,
            "cuda12" => 450,
            _ => 400,
        };
    }

    if lower.contains("vulkan") {
        score += 250;
    }
    if lower.contains("rocm") {
        score += 220;
    }
    if has_avx2_marker(lower) {
        score += 160;
    }
    if has_avx512_marker(lower) {
        score += 140;
    }
    if has_avx_marker(lower) {
        score += 120;
    }
    if lower.contains("noavx") {
        score += 80;
    }

    score
}

pub(super) fn cpu_feature_score(lower: &str, cpu_tier: CpuInstructionTier) -> i32 {
    match cpu_tier {
        CpuInstructionTier::Avx512 if has_avx512_marker(lower) => 700,
        CpuInstructionTier::Avx512 if has_avx2_marker(lower) => 600,
        CpuInstructionTier::Avx512 if has_avx_marker(lower) => 500,
        CpuInstructionTier::Avx2 if has_avx2_marker(lower) => 700,
        CpuInstructionTier::Avx2 if has_avx_marker(lower) => 600,
        CpuInstructionTier::Avx if has_avx_marker(lower) => 700,
        CpuInstructionTier::Avx512 | CpuInstructionTier::Avx2 | CpuInstructionTier::Avx
            if lower.contains("noavx") || lower.contains("cpu") =>
        {
            300
        }
        CpuInstructionTier::Baseline if lower.contains("noavx") || lower.contains("cpu") => 700,
        _ => 0,
    }
}

fn has_avx512_marker(lower: &str) -> bool {
    lower.contains("avx512")
}

fn has_avx2_marker(lower: &str) -> bool {
    lower.contains("avx2")
}

fn has_avx_marker(lower: &str) -> bool {
    lower.contains("avx") && !lower.contains("noavx")
}

fn runtime_score(name: &str) -> i32 {
    match detect_cuda_track(name) {
        Some("cuda13") => 200,
        Some("cuda12") => 180,
        Some(_) => 160,
        None => 0,
    }
}

fn detect_cuda_track(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();

    if lower.contains("cuda-12") || lower.contains("cuda12") || lower.contains("cu12") {
        return Some("cuda12");
    }

    if lower.contains("cuda-13") || lower.contains("cuda13") || lower.contains("cu13") {
        return Some("cuda13");
    }

    None
}

impl Platform {
    fn current() -> Self {
        let os = if cfg!(target_os = "windows") {
            PlatformOs::Windows
        } else if cfg!(target_os = "linux") {
            PlatformOs::Linux
        } else if cfg!(target_os = "macos") {
            PlatformOs::Macos
        } else {
            PlatformOs::Other
        };

        let arch = match std::env::consts::ARCH {
            "x86_64" | "amd64" => PlatformArch::X64,
            "aarch64" | "arm64" => PlatformArch::Arm64,
            "x86" | "i686" => PlatformArch::X86,
            _ => PlatformArch::Other,
        };

        Self { os, arch }
    }
}

impl HardwareProfile {
    fn from_probe(probe: &GpuInfo) -> Self {
        Self {
            accelerator: probe.accelerator_class(),
            cpu_tier: CpuInstructionTier::current(),
            cuda_driver_major: probe.cuda_driver_major,
            cuda_driver_minor: probe.cuda_driver_minor,
        }
    }

    const fn supports_cuda_at_least(&self, major: u32, minor: u32) -> bool {
        match (self.cuda_driver_major, self.cuda_driver_minor) {
            (Some(driver_major), Some(driver_minor)) => {
                driver_major > major || (driver_major == major && driver_minor >= minor)
            }
            _ => false,
        }
    }
}
