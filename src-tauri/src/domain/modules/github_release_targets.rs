use crate::domain::system::hardware_probe::AcceleratorClass;

use super::github_releases::{HardwareProfile, ReleaseAsset, ReleaseComputeTarget};

pub(super) const fn recommended_release_target(
    cpu: Option<&super::github_releases::ReleaseDownloadVariant>,
    gpu: Option<&super::github_releases::ReleaseDownloadVariant>,
    hardware: HardwareProfile,
) -> ReleaseComputeTarget {
    if gpu.is_some() && has_real_gpu_accelerator(hardware) {
        return ReleaseComputeTarget::Gpu;
    }
    if cpu.is_some() {
        return ReleaseComputeTarget::Cpu;
    }
    if gpu.is_some() {
        return ReleaseComputeTarget::Gpu;
    }
    ReleaseComputeTarget::Cpu
}

pub(super) fn release_assets_match_target(
    assets: &[ReleaseAsset],
    target: ReleaseComputeTarget,
) -> bool {
    match target {
        ReleaseComputeTarget::Auto => true,
        ReleaseComputeTarget::Both => {
            release_assets_match_target(assets, ReleaseComputeTarget::Gpu)
                && release_assets_match_target(assets, ReleaseComputeTarget::Cpu)
        }
        ReleaseComputeTarget::Gpu => assets
            .iter()
            .filter(|asset| !is_runtime_asset_name(&asset.name))
            .any(|asset| is_gpu_asset_name(&asset.name)),
        ReleaseComputeTarget::Cpu => assets
            .iter()
            .filter(|asset| !is_runtime_asset_name(&asset.name))
            .any(|asset| is_cpu_asset_name(&asset.name)),
    }
}

pub(super) const fn hardware_for_target(
    hardware: HardwareProfile,
    target: ReleaseComputeTarget,
) -> HardwareProfile {
    match target {
        ReleaseComputeTarget::Auto | ReleaseComputeTarget::Both => hardware,
        ReleaseComputeTarget::Gpu => {
            if matches!(
                hardware.accelerator,
                AcceleratorClass::CpuOnly | AcceleratorClass::Unknown
            ) {
                HardwareProfile {
                    accelerator: AcceleratorClass::GenericGpu,
                    cpu_tier: hardware.cpu_tier,
                    cuda_driver_major: None,
                    cuda_driver_minor: None,
                }
            } else {
                hardware
            }
        }
        ReleaseComputeTarget::Cpu => HardwareProfile {
            accelerator: AcceleratorClass::CpuOnly,
            cpu_tier: hardware.cpu_tier,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        },
    }
}

fn is_runtime_asset_name(name: &str) -> bool {
    name.to_ascii_lowercase().starts_with("cudart-")
}

pub(super) fn is_gpu_asset_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    is_gpu_asset_name_lower(&lower)
}

pub(super) fn is_gpu_asset_name_lower(lower: &str) -> bool {
    release_asset_tokens(lower).any(|token| {
        token == "cuda"
            || token.starts_with("cuda12")
            || token.starts_with("cuda13")
            || token.starts_with("cu12")
            || token.starts_with("cu13")
            || token == "metal"
            || token == "vulkan"
            || token == "hip"
            || token == "rocm"
            || token == "sycl"
            || token == "openvino"
            || token == "nvidia"
            || token == "amd"
            || token == "radeon"
    })
}

pub(super) fn is_cpu_asset_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let mut has_cpu_token = false;
    let mut has_os_or_arch_token = false;
    let mut has_unknown_accelerator_token = false;
    for token in release_asset_tokens(&lower) {
        if token == "cpu"
            || token == "avx"
            || token == "avx2"
            || token == "avx512"
            || token == "noavx"
        {
            has_cpu_token = true;
        }
        if matches!(
            token,
            "linux"
                | "windows"
                | "win"
                | "darwin"
                | "macos"
                | "osx"
                | "x86"
                | "x86_64"
                | "x64"
                | "amd64"
                | "arm64"
                | "aarch64"
        ) {
            has_os_or_arch_token = true;
        }
        if token == "metal" || token == "npu" || token == "xpu" || token.starts_with("rtx") {
            has_unknown_accelerator_token = true;
        }
    }

    (has_cpu_token || has_os_or_arch_token)
        && !has_unknown_accelerator_token
        && !is_gpu_asset_name_lower(&lower)
}

fn release_asset_tokens(name: &str) -> impl Iterator<Item = &str> {
    name.split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
}

const fn has_real_gpu_accelerator(hardware: HardwareProfile) -> bool {
    !matches!(
        hardware.accelerator,
        AcceleratorClass::CpuOnly | AcceleratorClass::Unknown
    )
}
