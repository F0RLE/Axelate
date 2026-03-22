//! GitHub release asset selection for platform-specific module bundles.

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
}

/// A platform-compatible bundle of assets selected from a GitHub release.
#[derive(Clone, Debug)]
pub struct ReleaseBundle {
    /// Git tag associated with the selected release.
    pub tag_name: String,
    /// One or more assets required to install the module on the current machine.
    pub assets: Vec<ReleaseAsset>,
}

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
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Platform {
    os: PlatformOs,
    arch: PlatformArch,
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
    let api_url = format!("https://api.github.com/repos/{owner}/{repo}/releases?per_page=8");

    let response = client
        .get(&api_url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(AppError::External {
            request_id: None,
            message: format!("Failed to fetch GitHub releases: {}", response.status()),
        });
    }

    let releases: Vec<Release> = response.json().await?;
    let platform = Platform::current();

    for release in releases {
        if release.draft || release.prerelease {
            continue;
        }

        if let Some(assets) = select_release_assets(module_id, platform, &release.assets) {
            return Ok(ReleaseBundle {
                tag_name: release.tag_name,
                assets,
            });
        }
    }

    Err(AppError::NotFound(format!(
        "No compatible release bundle found for module '{module_id}' on this platform"
    )))
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
    assets: &[Asset],
) -> Option<Vec<ReleaseAsset>> {
    let runtime_candidates = runtime_assets(module_id, platform, assets);
    let main_candidates = main_assets(module_id, platform, assets);

    if main_candidates.is_empty() {
        return None;
    }

    if platform.os == PlatformOs::Windows {
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
                    asset_to_release_asset(assets.get(runtime_idx)?),
                    asset_to_release_asset(main),
                ]);
            }
        }
    }

    let non_cuda_main = main_candidates.iter().copied().find(|idx| {
        assets
            .get(*idx)
            .is_some_and(|asset| detect_cuda_track(&asset.name).is_none())
    });

    let selected_main = non_cuda_main.or_else(|| main_candidates.first().copied())?;
    Some(vec![asset_to_release_asset(assets.get(selected_main)?)])
}

fn runtime_assets(module_id: &str, platform: Platform, assets: &[Asset]) -> Vec<usize> {
    let mut indices: Vec<usize> = assets
        .iter()
        .enumerate()
        .filter(|(_, asset)| {
            is_runtime_asset(module_id, &asset.name) && platform_matches(platform, &asset.name)
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

fn main_assets(module_id: &str, platform: Platform, assets: &[Asset]) -> Vec<usize> {
    let mut indices: Vec<usize> = assets
        .iter()
        .enumerate()
        .filter(|(_, asset)| {
            is_main_asset(module_id, &asset.name) && platform_matches(platform, &asset.name)
        })
        .map(|(idx, _)| idx)
        .collect();

    indices.sort_by_key(|idx| {
        std::cmp::Reverse(
            assets
                .get(*idx)
                .map_or(i32::MIN, |asset| main_score(&asset.name)),
        )
    });
    indices
}

fn asset_to_release_asset(asset: &Asset) -> ReleaseAsset {
    ReleaseAsset {
        name: asset.name.clone(),
        download_url: asset.browser_download_url.clone(),
        size: asset.size,
    }
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
        _ => !lower.starts_with("cudart-"),
    }
}

fn is_archive_asset(lower_name: &str) -> bool {
    lower_name.ends_with(".tar.gz")
        || std::path::Path::new(lower_name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip") || ext.eq_ignore_ascii_case("tgz"))
}

fn platform_matches(platform: Platform, name: &str) -> bool {
    let lower = name.to_ascii_lowercase();

    os_matches(platform.os, &lower) && arch_matches(platform.arch, &lower)
}

fn os_matches(os: PlatformOs, lower_name: &str) -> bool {
    match os {
        PlatformOs::Windows => lower_name.contains("win"),
        PlatformOs::Linux => lower_name.contains("linux") || lower_name.contains("ubuntu"),
        PlatformOs::Macos => lower_name.contains("darwin") || lower_name.contains("macos"),
        PlatformOs::Other => true,
    }
}

fn arch_matches(arch: PlatformArch, lower_name: &str) -> bool {
    match arch {
        PlatformArch::X64 => {
            lower_name.contains("x64")
                || lower_name.contains("x86_64")
                || lower_name.contains("amd64")
        }
        PlatformArch::Arm64 => lower_name.contains("arm64") || lower_name.contains("aarch64"),
        PlatformArch::X86 => lower_name.contains("-x86") || lower_name.contains("_x86"),
        PlatformArch::Other => true,
    }
}

fn main_score(name: &str) -> i32 {
    let lower = name.to_ascii_lowercase();
    let mut score = 0;

    if let Some(cuda_track) = detect_cuda_track(&lower) {
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
    if lower.contains("avx2") {
        score += 160;
    }
    if lower.contains("avx512") {
        score += 140;
    }
    if lower.contains("avx") {
        score += 120;
    }
    if lower.contains("noavx") {
        score += 80;
    }

    score
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_incomplete_sdcpp_release_and_accepts_complete_previous_bundle() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
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

        assert!(select_release_assets("sdcpp", platform, &incomplete_latest).is_none());

        let selected = select_release_assets("sdcpp", platform, &complete_previous)
            .expect("expected a compatible sdcpp bundle");

        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].name, "cudart-sd-bin-win-cu12-x64.zip");
        assert_eq!(selected[1].name, "sd-master-5265a5e-bin-win-cuda12-x64.zip");
    }

    #[test]
    fn selects_llamacpp_cuda_bundle_with_matching_runtime() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let assets = vec![
            asset("cudart-llama-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-avx2-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, &assets)
            .expect("expected a compatible llama.cpp bundle");

        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].name, "cudart-llama-bin-win-cuda-12.4-x64.zip");
        assert_eq!(selected[1].name, "llama-b8461-bin-win-cuda-12.4-x64.zip");
    }

    #[test]
    fn prefers_cuda13_bundle_over_cuda12_and_cpu_on_windows_x64() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let assets = vec![
            asset("cudart-llama-bin-win-cuda-12.4-x64.zip"),
            asset("cudart-llama-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8461-bin-win-cpu-x64.zip"),
            asset("llama-b8461-bin-win-cuda-12.4-x64.zip"),
            asset("llama-b8461-bin-win-cuda-13.1-x64.zip"),
            asset("llama-b8461-bin-win-vulkan-x64.zip"),
        ];

        let selected = select_release_assets("llamacpp", platform, &assets)
            .expect("expected a compatible llama.cpp bundle");

        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].name, "cudart-llama-bin-win-cuda-13.1-x64.zip");
        assert_eq!(selected[1].name, "llama-b8461-bin-win-cuda-13.1-x64.zip");
    }

    #[test]
    fn never_selects_runtime_only_asset_as_install_bundle() {
        let platform = Platform {
            os: PlatformOs::Windows,
            arch: PlatformArch::X64,
        };
        let assets = vec![asset("cudart-sd-bin-win-cu12-x64.zip")];

        assert!(select_release_assets("sdcpp", platform, &assets).is_none());
    }

    fn asset(name: &str) -> Asset {
        Asset {
            name: name.to_string(),
            browser_download_url: format!("https://example.com/{name}"),
            size: 1024,
        }
    }
}
