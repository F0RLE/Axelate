//! GitHub release asset selection for platform-specific module bundles.

use crate::domain::system::hardware_probe::{
    AcceleratorClass, CpuInstructionTier, GpuInfo, probe_gpu_info,
};
use crate::errors::AppError;
use reqwest::Client;
use serde::Deserialize;

/// A single downloadable asset selected from a GitHub release.
#[derive(Clone, Debug)]
pub struct ReleaseAsset {
    /// Human-readable GitHub release asset filename.
    pub name: String,
    /// Direct browser download URL for the selected asset.
    pub download_url: String,
    /// Asset size in bytes as reported by GitHub.
    pub size: u64,
    /// Pinned SHA-256 digest for the asset payload.
    pub sha256: String,
}

/// A platform-compatible bundle of assets selected from a GitHub release.
#[derive(Clone, Debug)]
pub struct ReleaseBundle {
    /// Git tag associated with the selected release.
    pub tag_name: String,
    /// One or more assets required to install the module on the current machine.
    pub assets: Vec<ReleaseAsset>,
}

const RELEASES_PER_PAGE: u8 = 100;

#[derive(Clone, Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Clone, Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Platform {
    os: PlatformOs,
    arch: PlatformArch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct HardwareProfile {
    accelerator: AcceleratorClass,
    cpu_tier: CpuInstructionTier,
    cuda_driver_major: Option<u32>,
    cuda_driver_minor: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PlatformOs {
    Windows,
    Linux,
    Macos,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PlatformArch {
    X64,
    Arm64,
    X86,
    Other,
}

/// Resolves the most compatible GitHub release assets for the current machine.
pub async fn fetch_release_bundle(
    client: &Client,
    repo_url: &str,
    module_id: &str,
) -> Result<ReleaseBundle, AppError> {
    let (owner, repo) = parse_repo(repo_url)?;
    let platform = Platform::current();
    let hardware = HardwareProfile::detect().await;
    let mut page = 1_u32;

    loop {
        let api_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/releases?per_page={RELEASES_PER_PAGE}&page={page}"
        );

        let response = client
            .get(&api_url)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(map_release_fetch_error(
                response.status(),
                &response,
                module_id,
            ));
        }

        let releases: Vec<Release> = response.json().await?;
        if releases.is_empty() {
            break;
        }

        for release in releases {
            if release.draft || release.prerelease {
                continue;
            }

            if let Some(assets) =
                select_release_assets(module_id, platform, hardware, &release.assets)
            {
                return Ok(ReleaseBundle {
                    tag_name: release.tag_name,
                    assets,
                });
            }
        }

        page += 1;
    }

    Err(AppError::NotFound(format!(
        "No compatible release bundle found for module '{module_id}' on this platform"
    )))
}

fn map_release_fetch_error(
    status: reqwest::StatusCode,
    response: &reqwest::Response,
    module_id: &str,
) -> AppError {
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let rate_limit_remaining = response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok());
    let rate_limit_reset = response
        .headers()
        .get("x-ratelimit-reset")
        .and_then(|value| value.to_str().ok());

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || (status == reqwest::StatusCode::FORBIDDEN
            && rate_limit_remaining.is_some_and(|value| value == "0"))
    {
        let retry_hint = retry_after
            .map(|seconds| format!(" Retry after {seconds} seconds."))
            .or_else(|| {
                rate_limit_reset.map(|unix_ts| {
                    format!(" GitHub rate limit resets at unix timestamp {unix_ts}.")
                })
            })
            .unwrap_or_default();

        return AppError::External {
            request_id: None,
            message: format!(
                "GitHub API rate limit reached while fetching releases for '{module_id}'.{retry_hint}"
            ),
        };
    }

    AppError::External {
        request_id: None,
        message: format!("Failed to fetch GitHub releases: {status}"),
    }
}

fn parse_repo(repo_url: &str) -> Result<(String, String), AppError> {
    let trimmed = repo_url.trim_end_matches(".git").trim_end_matches('/');
    let parts: Vec<&str> = trimmed.split('/').collect();

    if parts.len() < 2 {
        return Err(AppError::Validation(format!(
            "Invalid GitHub repository URL: {repo_url}"
        )));
    }

    let repo = parts
        .last()
        .ok_or_else(|| AppError::Validation(format!("Invalid GitHub repository URL: {repo_url}")))?
        .to_string();
    let owner = parts
        .get(parts.len().saturating_sub(2))
        .ok_or_else(|| AppError::Validation(format!("Invalid GitHub repository URL: {repo_url}")))?
        .to_string();

    if owner.is_empty() || repo.is_empty() {
        return Err(AppError::Validation(format!(
            "Invalid GitHub repository URL: {repo_url}"
        )));
    }

    Ok((owner, repo))
}

fn select_release_assets(
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

fn base_main_score(lower: &str) -> i32 {
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

fn cpu_feature_score(lower: &str, cpu_tier: CpuInstructionTier) -> i32 {
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
    async fn detect() -> Self {
        let probe = probe_gpu_info().await;
        Self::from_probe(&probe)
    }

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

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn skips_incomplete_sdcpp_release_and_accepts_complete_previous_bundle() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };

        let incomplete_latest = vec![
            asset("cudart-sd-bin-win-cu12-x64.zip"),
            asset("sd-master-545fac4-bin-Darwin-macOS-15.7.4-arm64.zip"),
        ];
        let complete_previous = vec![
            asset("cudart-sd-bin-win-cu12-x64.zip"),
            asset("sd-master-5265a5e-bin-win-cuda12-x64.zip"),
            asset("sd-master-5265a5e-bin-win-avx2-x64.zip"),
        ];

        assert!(select_release_assets("sdcpp", platform, hardware, &incomplete_latest).is_none());

        let selected = select_release_assets("sdcpp", platform, hardware, &complete_previous);
        assert!(selected.is_some(), "expected a compatible sdcpp bundle");
        let selected = selected.unwrap_or_default();

        assert_eq!(selected.len(), 2);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("cudart-sd-bin-win-cu12-x64.zip")
        );
        assert_eq!(
            selected.get(1).map(|asset| asset.name.as_str()),
            Some("sd-master-5265a5e-bin-win-cuda12-x64.zip")
        );
    }

    #[test]
    fn selects_llamacpp_cuda_bundle_with_matching_runtime() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("cudart-llama-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-avx2-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets);
        assert!(selected.is_some(), "expected a compatible llama.cpp bundle");
        let selected = selected.unwrap_or_default();

        assert_eq!(selected.len(), 2);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("cudart-llama-bin-win-cuda-12.4-x64.zip")
        );
        assert_eq!(
            selected.get(1).map(|asset| asset.name.as_str()),
            Some("llama-b8461-bin-win-cuda-12.4-x64.zip")
        );
    }

    #[test]
    fn prefers_cuda13_bundle_over_cuda12_and_cpu_on_windows_x64() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("cudart-llama-bin-win-cuda-12.4-x64.zip"),
            asset("cudart-llama-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8461-bin-win-cpu-x64.zip"),
            asset("llama-b8461-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8461-bin-win-vulkan-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets);
        assert!(selected.is_some(), "expected a compatible llama.cpp bundle");
        let selected = selected.unwrap_or_default();

        assert_eq!(selected.len(), 2);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("cudart-llama-bin-win-cuda-13.1-x64.zip")
        );
        assert_eq!(
            selected.get(1).map(|asset| asset.name.as_str()),
            Some("llama-b8461-bin-win-cuda-13.1-x64.zip")
        );
    }

    #[test]
    fn never_selects_runtime_only_asset_as_install_bundle() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![asset("cudart-sd-bin-win-cu12-x64.zip")];

        assert!(select_release_assets("sdcpp", platform, hardware, &assets).is_none());
    }

    #[test]
    fn rejects_release_bundle_when_selected_asset_has_no_digest() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset_without_digest("cudart-llama-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-cuda-12.4-x64.zip"),
        ];

        assert!(select_release_assets("llamacpp", platform, hardware, &assets).is_none());
    }

    #[test]
    fn skips_incomplete_windows_cuda_release_when_runtime_pair_is_missing() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("llama-b8726-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8726-bin-win-cpu-x64.zip"),
        ];

        assert!(select_release_assets("llamacpp", platform, hardware, &assets).is_none());
    }

    #[test]
    fn prefers_vulkan_bundle_for_non_nvidia_windows_gpu() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::GenericGpu,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("cudart-sd-bin-win-cu12-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-cuda12-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-vulkan-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-avx2-x64.zip"),
        ];

        let selected = select_release_assets("sdcpp", platform, hardware, &assets)
            .expect("expected compatible sdcpp bundle");

        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("sd-master-560-e8323ca-bin-win-vulkan-x64.zip")
        );
    }

    #[test]
    fn prefers_cpu_bundle_when_no_gpu_acceleration_is_detected() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::CpuOnly,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("cudart-sd-bin-win-cu12-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-cuda12-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-vulkan-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-avx2-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-noavx-x64.zip"),
        ];

        let selected = select_release_assets("sdcpp", platform, hardware, &assets)
            .expect("expected compatible sdcpp bundle");

        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("sd-master-560-e8323ca-bin-win-avx2-x64.zip")
        );
    }

    #[test]
    fn prefers_noavx_bundle_for_baseline_cpu() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::CpuOnly,
            cpu_tier: CpuInstructionTier::Baseline,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("sd-master-560-e8323ca-bin-win-avx-x64.zip"),
            asset("sd-master-560-e8323ca-bin-win-noavx-x64.zip"),
        ];

        let selected = select_release_assets("sdcpp", platform, hardware, &assets)
            .expect("expected compatible sdcpp bundle");

        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("sd-master-560-e8323ca-bin-win-noavx-x64.zip")
        );
    }

    #[test]
    fn noavx_marker_does_not_score_as_avx() {
        let lower = "sd-master-560-e8323ca-bin-win-noavx-x64.zip";

        assert_eq!(base_main_score(lower), 80);
        assert_eq!(cpu_feature_score(lower, CpuInstructionTier::Avx), 300);
    }

    #[test]
    fn prefers_llamacpp_hip_bundle_for_amd_gpu() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::AmdGpu,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("llama-b8724-bin-win-vulkan-x64.zip"),
            asset("llama-b8724-bin-win-hip-radeon-x64.zip"),
            asset("llama-b8724-bin-win-cpu-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets)
            .expect("expected compatible llama.cpp bundle");

        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("llama-b8724-bin-win-hip-radeon-x64.zip")
        );
    }

    #[test]
    fn prefers_llamacpp_sycl_bundle_for_intel_gpu() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::IntelGpu,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("llama-b8724-bin-win-vulkan-x64.zip"),
            asset("llama-b8724-bin-win-sycl-x64.zip"),
            asset("llama-b8724-bin-win-cpu-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets)
            .expect("expected compatible llama.cpp bundle");

        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("llama-b8724-bin-win-sycl-x64.zip")
        );
    }

    #[test]
    fn selects_comfyui_nvidia_portable_release_without_runtime_pairing() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("ComfyUI_windows_portable_amd.7z"),
            asset("ComfyUI_windows_portable_nvidia.7z"),
            asset("ComfyUI_windows_portable_nvidia_cu126.7z"),
        ];

        let selected = select_release_assets("comfyui", platform, hardware, &assets)
            .expect("expected compatible ComfyUI bundle");

        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("ComfyUI_windows_portable_nvidia.7z")
        );
    }

    #[test]
    fn selects_comfyui_cu126_bundle_when_cuda_driver_supports_it() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: Some(12),
            cuda_driver_minor: Some(6),
        };
        let assets = vec![
            asset("ComfyUI_windows_portable_amd.7z"),
            asset("ComfyUI_windows_portable_nvidia.7z"),
            asset("ComfyUI_windows_portable_nvidia_cu126.7z"),
        ];

        let selected = select_release_assets("comfyui", platform, hardware, &assets)
            .expect("expected compatible ComfyUI bundle");

        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("ComfyUI_windows_portable_nvidia_cu126.7z")
        );
    }

    #[test]
    fn selects_comfyui_amd_portable_release() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::AmdGpu,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let assets = vec![
            asset("ComfyUI_windows_portable_amd.7z"),
            asset("ComfyUI_windows_portable_nvidia.7z"),
        ];

        let selected = select_release_assets("comfyui", platform, hardware, &assets)
            .expect("expected compatible ComfyUI bundle");

        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("ComfyUI_windows_portable_amd.7z")
        );
    }

    fn asset(name: &str) -> Asset {
        Asset {
            name: name.to_string(),
            browser_download_url: format!("https://example.com/{name}"),
            size: 1024,
            digest: Some(format!("sha256:{}", "a".repeat(64))),
        }
    }

    fn asset_without_digest(name: &str) -> Asset {
        Asset {
            name: name.to_string(),
            browser_download_url: format!("https://example.com/{name}"),
            size: 1024,
            digest: None,
        }
    }
}
