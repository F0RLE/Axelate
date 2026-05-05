//! GitHub release asset selection for platform-specific module bundles.

use crate::errors::AppError;
use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use specta::Type;

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

/// User-facing compute target for release package selection.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseComputeTarget {
    /// Let Axelate choose the best compatible package for this machine.
    #[default]
    Auto,
    /// Prefer a GPU package, for example CUDA, Vulkan, HIP, or SYCL.
    Gpu,
    /// Prefer a CPU package.
    Cpu,
}

/// Explicit release package selection passed from the frontend.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
pub struct ReleaseDownloadSelection {
    /// GitHub release tag to download. `None` means the newest compatible release.
    pub tag_name: Option<String>,
    /// Compute target selected by the user.
    #[serde(default)]
    pub compute_target: ReleaseComputeTarget,
}

/// User-visible release download options for a single module.
#[derive(Clone, Debug, Serialize, Type)]
pub struct ReleaseDownloadOptions {
    /// Module identifier these options belong to.
    pub module_id: String,
    /// GitHub release versions in newest-first order.
    pub versions: Vec<ReleaseDownloadVersion>,
}

/// User-visible package choices for a GitHub release version.
#[derive(Clone, Debug, Serialize, Type)]
pub struct ReleaseDownloadVersion {
    /// GitHub release tag.
    pub tag_name: String,
    /// GitHub release publish timestamp when available.
    pub published_at: Option<String>,
    /// CPU package choice for this release, when compatible.
    pub cpu: Option<ReleaseDownloadVariant>,
    /// GPU package choice for this release, when compatible.
    pub gpu: Option<ReleaseDownloadVariant>,
    /// Recommended package target for this machine.
    pub recommended: ReleaseComputeTarget,
}

/// User-visible package variant for one compute target.
#[derive(Clone, Debug, Serialize, Type)]
pub struct ReleaseDownloadVariant {
    /// Compute target represented by this variant.
    pub compute_target: ReleaseComputeTarget,
    /// Asset filenames that will be downloaded.
    pub assets: Vec<String>,
    /// Combined download size in bytes.
    pub total_size: u64,
}

const RELEASES_PER_PAGE: u8 = 100;
const MAX_RELEASE_DOWNLOAD_OPTIONS: usize = 50;
const GITHUB_API_USER_AGENT: &str = "Axelate";

#[derive(Clone, Debug, Deserialize)]
struct Release {
    tag_name: String,
    published_at: Option<String>,
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
    selection: Option<&ReleaseDownloadSelection>,
) -> Result<ReleaseBundle, AppError> {
    let repo_ref = parse_repo(repo_url)?;
    let platform = current_platform();
    let hardware = detect_hardware_profile().await;
    tracing::info!(
        "Selecting release bundle for {module_id}: platform={:?}, hardware={:?}",
        platform,
        hardware
    );
    let mut page = 1_u32;

    loop {
        let releases = fetch_release_page(client, &repo_ref, module_id, page).await?;
        if releases.is_empty() {
            break;
        }

        if let Some(bundle) =
            find_compatible_release_bundle(module_id, platform, hardware, releases, selection)
        {
            tracing::info!(
                "Selected release bundle for {module_id}: tag={} assets={}",
                bundle.tag_name,
                bundle
                    .assets
                    .iter()
                    .map(|asset| asset.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            return Ok(bundle);
        }

        page += 1;
    }

    Err(AppError::NotFound(format!(
        "No compatible release bundle found for module '{module_id}' on this platform"
    )))
}

/// Returns user-visible release choices for the current machine.
pub async fn fetch_release_download_options(
    client: &Client,
    repo_url: &str,
    module_id: &str,
) -> Result<ReleaseDownloadOptions, AppError> {
    let repo_ref = parse_repo(repo_url)?;
    let platform = current_platform();
    let hardware = detect_hardware_profile().await;
    let mut page = 1_u32;
    let mut versions = Vec::new();

    loop {
        let releases = fetch_release_page(client, &repo_ref, module_id, page).await?;
        if releases.is_empty() {
            break;
        }

        versions.extend(release_download_versions(
            module_id, platform, hardware, releases,
        ));
        if versions.len() >= MAX_RELEASE_DOWNLOAD_OPTIONS {
            versions.truncate(MAX_RELEASE_DOWNLOAD_OPTIONS);
            break;
        }
        page += 1;
    }

    Ok(ReleaseDownloadOptions {
        module_id: module_id.to_string(),
        versions,
    })
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
        .header(header::ACCEPT, "application/vnd.github+json")
        .header(header::USER_AGENT, GITHUB_API_USER_AGENT)
        .send()
        .await?;

    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY && page > 1 {
            tracing::warn!(
                "GitHub release pagination stopped for {module_id} at page {page}: {}",
                response.status()
            );
            return Ok(Vec::new());
        }
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
    selection: Option<&ReleaseDownloadSelection>,
) -> Option<ReleaseBundle> {
    let selected_tag = selection
        .and_then(|selection| selection.tag_name.as_deref())
        .filter(|tag| !tag.trim().is_empty());
    let selected_target = selection.map_or(ReleaseComputeTarget::Auto, |selection| {
        selection.compute_target
    });
    let selected_hardware = hardware_for_target(hardware, selected_target);

    releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
        .filter(|release| selected_tag.is_none_or(|tag| release.tag_name == tag))
        .find_map(|release| {
            let assets =
                select_release_assets(module_id, platform, selected_hardware, &release.assets)?;
            if selected_target != ReleaseComputeTarget::Auto
                && !release_assets_match_target(&assets, selected_target)
            {
                return None;
            }
            Some(ReleaseBundle {
                tag_name: release.tag_name,
                assets,
            })
        })
}

fn release_download_version(
    module_id: &str,
    platform: Platform,
    hardware: HardwareProfile,
    release: Release,
) -> Option<ReleaseDownloadVersion> {
    let cpu = select_release_assets(
        module_id,
        platform,
        hardware_for_target(hardware, ReleaseComputeTarget::Cpu),
        &release.assets,
    )
    .and_then(|assets| release_download_variant(ReleaseComputeTarget::Cpu, assets));
    let gpu = select_release_assets(
        module_id,
        platform,
        hardware_for_target(hardware, ReleaseComputeTarget::Gpu),
        &release.assets,
    )
    .and_then(|assets| release_download_variant(ReleaseComputeTarget::Gpu, assets));

    if cpu.is_none() && gpu.is_none() {
        return None;
    }

    let recommended = if gpu.is_some() && has_real_gpu_accelerator(hardware) {
        ReleaseComputeTarget::Gpu
    } else {
        ReleaseComputeTarget::Cpu
    };

    Some(ReleaseDownloadVersion {
        tag_name: release.tag_name,
        published_at: release.published_at,
        cpu,
        gpu,
        recommended,
    })
}

fn release_download_versions(
    module_id: &str,
    platform: Platform,
    hardware: HardwareProfile,
    releases: Vec<Release>,
) -> Vec<ReleaseDownloadVersion> {
    releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
        .filter_map(|release| release_download_version(module_id, platform, hardware, release))
        .collect()
}

fn release_download_variant(
    compute_target: ReleaseComputeTarget,
    assets: Vec<ReleaseAsset>,
) -> Option<ReleaseDownloadVariant> {
    if assets.is_empty() {
        return None;
    }
    if !release_assets_match_target(&assets, compute_target) {
        return None;
    }

    let total_size = assets
        .iter()
        .fold(0_u64, |acc, asset| acc.saturating_add(asset.size));

    Some(ReleaseDownloadVariant {
        compute_target,
        assets: assets.into_iter().map(|asset| asset.name).collect(),
        total_size,
    })
}

fn release_assets_match_target(assets: &[ReleaseAsset], target: ReleaseComputeTarget) -> bool {
    match target {
        ReleaseComputeTarget::Auto => true,
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

fn is_runtime_asset_name(name: &str) -> bool {
    name.to_ascii_lowercase().starts_with("cudart-")
}

fn is_gpu_asset_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    is_gpu_asset_name_lower(&lower)
}

fn is_gpu_asset_name_lower(lower: &str) -> bool {
    lower.contains("cuda")
        || lower.contains("cu12")
        || lower.contains("cu13")
        || lower.contains("vulkan")
        || lower.contains("hip")
        || lower.contains("rocm")
        || lower.contains("sycl")
        || lower.contains("openvino")
        || lower.contains("nvidia")
        || lower.contains("amd")
}

fn is_cpu_asset_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("cpu")
        || lower.contains("avx")
        || lower.contains("noavx")
        || !is_gpu_asset_name_lower(&lower)
}

const fn has_real_gpu_accelerator(hardware: HardwareProfile) -> bool {
    !matches!(
        hardware.accelerator,
        crate::domain::system::hardware_probe::AcceleratorClass::CpuOnly
            | crate::domain::system::hardware_probe::AcceleratorClass::Unknown
    )
}

const fn hardware_for_target(
    hardware: HardwareProfile,
    target: ReleaseComputeTarget,
) -> HardwareProfile {
    match target {
        ReleaseComputeTarget::Auto => hardware,
        ReleaseComputeTarget::Gpu => {
            if matches!(
                hardware.accelerator,
                crate::domain::system::hardware_probe::AcceleratorClass::CpuOnly
                    | crate::domain::system::hardware_probe::AcceleratorClass::Unknown
            ) {
                HardwareProfile {
                    accelerator:
                        crate::domain::system::hardware_probe::AcceleratorClass::GenericGpu,
                    cpu_tier: hardware.cpu_tier,
                    cuda_driver_major: None,
                    cuda_driver_minor: None,
                }
            } else {
                hardware
            }
        }
        ReleaseComputeTarget::Cpu => HardwareProfile {
            accelerator: crate::domain::system::hardware_probe::AcceleratorClass::CpuOnly,
            cpu_tier: hardware.cpu_tier,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        },
    }
}

fn parse_repo(repo_url: &str) -> Result<RepoRef, AppError> {
    let trimmed = repo_url
        .trim()
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/');
    if trimmed.contains("://")
        && !trimmed.starts_with("https://github.com/")
        && !trimmed.starts_with("http://github.com/")
        && !trimmed.starts_with("https://www.github.com/")
        && !trimmed.starts_with("http://www.github.com/")
    {
        return Err(invalid_repo_url(repo_url));
    }
    let path = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("https://www.github.com/"))
        .or_else(|| trimmed.strip_prefix("http://www.github.com/"))
        .or_else(|| trimmed.strip_prefix("github.com/"))
        .or_else(|| trimmed.strip_prefix("www.github.com/"))
        .or_else(|| trimmed.strip_prefix("git@github.com:"))
        .unwrap_or(trimmed);
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();

    let owner = parts
        .first()
        .ok_or_else(|| invalid_repo_url(repo_url))?
        .to_string();
    let repo = parts
        .get(1)
        .ok_or_else(|| invalid_repo_url(repo_url))?
        .trim_end_matches(".git")
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
    fn parse_repo_uses_owner_and_repo_from_github_urls_with_extra_path() {
        let parsed = parse_repo("https://github.com/ggml-org/llama.cpp/releases/latest")
            .expect("valid GitHub URL should parse");

        assert_eq!(parsed.owner, "ggml-org");
        assert_eq!(parsed.repo, "llama.cpp");
    }

    #[test]
    fn parse_repo_supports_git_suffix_and_shorthand() {
        let parsed = parse_repo("ggml-org/llama.cpp.git").expect("valid shorthand should parse");

        assert_eq!(parsed.owner, "ggml-org");
        assert_eq!(parsed.repo, "llama.cpp");
    }

    #[test]
    fn parse_repo_supports_github_host_without_scheme() {
        let parsed =
            parse_repo("github.com/ggml-org/llama.cpp").expect("valid host shorthand should parse");

        assert_eq!(parsed.owner, "ggml-org");
        assert_eq!(parsed.repo, "llama.cpp");
    }

    #[test]
    fn parse_repo_rejects_non_github_urls() {
        let parsed = parse_repo("https://example.com/ggml-org/llama.cpp");

        assert!(parsed.is_err());
    }

    #[test]
    fn windows_selection_does_not_treat_darwin_assets_as_windows() {
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
        let assets = vec![asset("llama-b9028-bin-darwin-x64.tar.gz")];

        assert!(select_release_assets("llamacpp", platform, hardware, &assets).is_none());
    }

    #[test]
    fn uppercase_sha256_digest_is_accepted() {
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
        let assets = vec![Asset {
            name: "llama-b9028-bin-win-cpu-x64.zip".to_string(),
            browser_download_url: "https://example.com/llama.zip".to_string(),
            size: 1024,
            digest: Some(format!("SHA256:{}", "A".repeat(64))),
        }];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets)
            .expect("uppercase SHA256 prefix should be accepted");

        assert_eq!(
            selected.first().map(|asset| asset.sha256.as_str()),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
    }

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
    fn treats_cuda_runtime_version_as_cuda_track_support() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::NvidiaCuda,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: Some(13),
            cuda_driver_minor: Some(2),
        };
        let assets = vec![
            asset("cudart-llama-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8971-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8971-bin-win-vulkan-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, hardware, &assets)
            .expect("expected cuda runtime version to support cuda asset selection");

        assert_eq!(selected.len(), 2);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("cudart-llama-bin-win-cuda-13.1-x64.zip")
        );
        assert_eq!(
            selected.get(1).map(|asset| asset.name.as_str()),
            Some("llama-b8971-bin-win-cuda-13.1-x64.zip")
        );
    }

    #[test]
    fn explicit_release_selection_respects_cpu_target() {
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
        let releases = vec![Release {
            tag_name: "b8971".to_string(),
            published_at: Some("2026-04-29T10:00:00Z".to_string()),
            draft: false,
            prerelease: false,
            assets: vec![
                asset("cudart-llama-bin-win-cuda-13.1-x64.zip"),
                asset("llama-b8971-bin-win-cuda-13.1-x64.zip"),
                asset("llama-b8971-bin-win-cpu-x64.zip"),
            ],
        }];
        let selection = ReleaseDownloadSelection {
            tag_name: Some("b8971".to_string()),
            compute_target: ReleaseComputeTarget::Cpu,
        };

        let bundle = find_compatible_release_bundle(
            "llamacpp",
            platform,
            hardware,
            releases,
            Some(&selection),
        )
        .expect("expected explicit CPU release bundle");

        assert_eq!(bundle.assets.len(), 1);
        assert_eq!(
            bundle.assets.first().map(|asset| asset.name.as_str()),
            Some("llama-b8971-bin-win-cpu-x64.zip")
        );
    }

    #[test]
    fn explicit_release_selection_respects_gpu_target() {
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
        let releases = vec![Release {
            tag_name: "b8971".to_string(),
            published_at: Some("2026-04-29T10:00:00Z".to_string()),
            draft: false,
            prerelease: false,
            assets: vec![
                asset("cudart-llama-bin-win-cuda-13.1-x64.zip"),
                asset("llama-b8971-bin-win-cuda-13.1-x64.zip"),
                asset("llama-b8971-bin-win-cpu-x64.zip"),
            ],
        }];
        let selection = ReleaseDownloadSelection {
            tag_name: Some("b8971".to_string()),
            compute_target: ReleaseComputeTarget::Gpu,
        };

        let bundle = find_compatible_release_bundle(
            "llamacpp",
            platform,
            hardware,
            releases,
            Some(&selection),
        )
        .expect("expected explicit GPU release bundle");

        assert_eq!(bundle.assets.len(), 2);
        assert_eq!(
            bundle.assets.first().map(|asset| asset.name.as_str()),
            Some("cudart-llama-bin-win-cuda-13.1-x64.zip")
        );
        assert_eq!(
            bundle.assets.get(1).map(|asset| asset.name.as_str()),
            Some("llama-b8971-bin-win-cuda-13.1-x64.zip")
        );
    }

    #[test]
    fn release_download_versions_keeps_compatible_older_release_options() {
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
        let releases = vec![
            Release {
                tag_name: "draft".to_string(),
                published_at: None,
                draft: true,
                prerelease: false,
                assets: vec![asset("llama-draft-bin-win-cpu-x64.zip")],
            },
            Release {
                tag_name: "linux-only".to_string(),
                published_at: None,
                draft: false,
                prerelease: false,
                assets: vec![asset("llama-linux-bin-linux-cpu-x64.zip")],
            },
            Release {
                tag_name: "older-compatible".to_string(),
                published_at: Some("2026-04-29T10:00:00Z".to_string()),
                draft: false,
                prerelease: false,
                assets: vec![asset("llama-older-bin-win-cpu-x64.zip")],
            },
        ];

        let versions = release_download_versions("llamacpp", platform, hardware, releases);

        assert_eq!(versions.len(), 1);
        assert_eq!(
            versions.first().map(|version| version.tag_name.as_str()),
            Some("older-compatible")
        );
        assert!(
            versions
                .first()
                .and_then(|version| version.cpu.as_ref())
                .is_some()
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
    fn falls_back_when_windows_cuda_runtime_pair_is_missing() {
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

        let selected = select_release_assets("llamacpp", platform, hardware, &assets)
            .expect("expected CPU fallback when CUDA runtime pair is missing");

        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected.first().map(|asset| asset.name.as_str()),
            Some("llama-b8726-bin-win-cpu-x64.zip")
        );
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
    fn current_sdcpp_release_names_build_cpu_and_gpu_options() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::Unknown,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let releases = vec![Release {
            tag_name: "master-593-3d6064b".to_string(),
            published_at: Some("2026-04-29T10:00:00Z".to_string()),
            draft: false,
            prerelease: false,
            assets: vec![
                asset("cudart-sd-bin-win-cu12-x64.zip"),
                asset("sd-master-3d6064b-bin-win-avx-x64.zip"),
                asset("sd-master-3d6064b-bin-win-avx2-x64.zip"),
                asset("sd-master-3d6064b-bin-win-avx512-x64.zip"),
                asset("sd-master-3d6064b-bin-win-cuda12-x64.zip"),
                asset("sd-master-3d6064b-bin-win-noavx-x64.zip"),
                asset("sd-master-3d6064b-bin-win-rocm-x64.zip"),
                asset("sd-master-3d6064b-bin-win-vulkan-x64.zip"),
            ],
        }];

        let versions = release_download_versions("sdcpp", platform, hardware, releases);

        assert_eq!(versions.len(), 1);
        let version = versions.first().expect("expected sdcpp options");
        assert_eq!(version.recommended, ReleaseComputeTarget::Cpu);
        assert_eq!(
            version.cpu.as_ref().and_then(|cpu| cpu.assets.first()),
            Some(&"sd-master-3d6064b-bin-win-avx2-x64.zip".to_string())
        );
        assert_eq!(
            version.gpu.as_ref().and_then(|gpu| gpu.assets.first()),
            Some(&"sd-master-3d6064b-bin-win-vulkan-x64.zip".to_string())
        );
    }

    #[test]
    fn current_llamacpp_release_names_build_cpu_and_gpu_options() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let hardware = HardwareProfile {
            accelerator: AcceleratorClass::Unknown,
            cpu_tier: CpuInstructionTier::Avx2,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let releases = vec![Release {
            tag_name: "b8981".to_string(),
            published_at: Some("2026-04-29T10:00:00Z".to_string()),
            draft: false,
            prerelease: false,
            assets: vec![
                asset("cudart-llama-bin-win-cuda-12.4-x64.zip"),
                asset("cudart-llama-bin-win-cuda-13.1-x64.zip"),
                asset("llama-b8981-bin-win-cpu-x64.zip"),
                asset("llama-b8981-bin-win-cuda-12.4-x64.zip"),
                asset("llama-b8981-bin-win-cuda-13.1-x64.zip"),
                asset("llama-b8981-bin-win-hip-radeon-x64.zip"),
                asset("llama-b8981-bin-win-sycl-x64.zip"),
                asset("llama-b8981-bin-win-vulkan-x64.zip"),
            ],
        }];

        let versions = release_download_versions("llamacpp", platform, hardware, releases);

        assert_eq!(versions.len(), 1);
        let version = versions.first().expect("expected llama.cpp options");
        assert_eq!(version.recommended, ReleaseComputeTarget::Cpu);
        assert_eq!(
            version.cpu.as_ref().and_then(|cpu| cpu.assets.first()),
            Some(&"llama-b8981-bin-win-cpu-x64.zip".to_string())
        );
        assert_eq!(
            version.gpu.as_ref().and_then(|gpu| gpu.assets.first()),
            Some(&"llama-b8981-bin-win-vulkan-x64.zip".to_string())
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
