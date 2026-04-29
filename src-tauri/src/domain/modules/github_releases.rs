//! GitHub release asset selection for platform-specific module bundles.

use crate::errors::AppError;
use reqwest::Client;
use serde::Deserialize;

use super::github_release_selection::{
    current_platform, detect_hardware_profile, select_release_assets,
};

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
pub(super) struct Asset {
    pub(super) name: String,
    pub(super) browser_download_url: String,
    pub(super) size: u64,
    pub(super) digest: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct Platform {
    pub(super) os: PlatformOs,
    pub(super) arch: PlatformArch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct HardwareProfile {
    pub(super) accelerator: crate::domain::system::hardware_probe::AcceleratorClass,
    pub(super) cpu_tier: crate::domain::system::hardware_probe::CpuInstructionTier,
    pub(super) cuda_driver_major: Option<u32>,
    pub(super) cuda_driver_minor: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PlatformOs {
    Windows,
    Linux,
    Macos,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PlatformArch {
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
    let repo_ref = parse_repo(repo_url)?;
    let platform = current_platform();
    let hardware = detect_hardware_profile().await;
    let mut page = 1_u32;

    loop {
        let releases = fetch_release_page(client, &repo_ref, module_id, page).await?;
        if releases.is_empty() {
            break;
        }

        if let Some(bundle) =
            find_compatible_release_bundle(module_id, platform, hardware, releases)
        {
            return Ok(bundle);
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

#[derive(Clone, Debug)]
struct RepoRef {
    owner: String,
    repo: String,
}

impl RepoRef {
    fn releases_api_url(&self, page: u32) -> String {
        format!(
            "https://api.github.com/repos/{}/{}/releases?per_page={RELEASES_PER_PAGE}&page={page}",
            self.owner, self.repo
        )
    }
}

async fn fetch_release_page(
    client: &Client,
    repo_ref: &RepoRef,
    module_id: &str,
    page: u32,
) -> Result<Vec<Release>, AppError> {
    let response = client
        .get(repo_ref.releases_api_url(page))
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

    Ok(response.json().await?)
}

fn find_compatible_release_bundle(
    module_id: &str,
    platform: Platform,
    hardware: HardwareProfile,
    releases: Vec<Release>,
) -> Option<ReleaseBundle> {
    releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
        .find_map(|release| {
            let assets = select_release_assets(module_id, platform, hardware, &release.assets)?;
            Some(ReleaseBundle {
                tag_name: release.tag_name,
                assets,
            })
        })
}

fn parse_repo(repo_url: &str) -> Result<RepoRef, AppError> {
    let trimmed = repo_url.trim_end_matches(".git").trim_end_matches('/');
    let parts: Vec<&str> = trimmed.split('/').collect();

    if parts.len() < 2 {
        return Err(invalid_repo_url(repo_url));
    }

    let repo = parts
        .last()
        .ok_or_else(|| invalid_repo_url(repo_url))?
        .to_string();
    let owner = parts
        .get(parts.len().saturating_sub(2))
        .ok_or_else(|| invalid_repo_url(repo_url))?
        .to_string();

    if owner.is_empty() || repo.is_empty() {
        return Err(invalid_repo_url(repo_url));
    }

    Ok(RepoRef { owner, repo })
}

fn invalid_repo_url(repo_url: &str) -> AppError {
    AppError::Validation(format!("Invalid GitHub repository URL: {repo_url}"))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::domain::modules::github_release_selection::{base_main_score, cpu_feature_score};
    use crate::domain::system::hardware_probe::{AcceleratorClass, CpuInstructionTier};

    #[test]
    fn skips_incomplete_sdcpp_release_and_accepts_complete_previous_bundle() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: Some(580),
            cuda_driver_minor: Some(0),
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
            cuda_driver_major: Some(580),
            cuda_driver_minor: Some(0),
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
            cuda_driver_major: Some(580),
            cuda_driver_minor: Some(0),
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
    fn prefers_cuda12_when_cuda_driver_version_is_unknown() {
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
            asset("llama-b8461-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8461-bin-win-cpu-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets)
            .expect("expected a compatible llama.cpp bundle");

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
    fn falls_back_to_cpu_when_only_unsupported_cuda_track_is_available() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: Some(550),
            cuda_driver_minor: Some(0),
        };
        let assets = vec![
            asset("cudart-llama-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8461-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8461-bin-win-cpu-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets)
            .expect("expected CPU fallback when CUDA 13 is unsupported");

        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("llama-b8461-bin-win-cpu-x64.zip")
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
            cuda_driver_major: Some(580),
            cuda_driver_minor: Some(0),
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
