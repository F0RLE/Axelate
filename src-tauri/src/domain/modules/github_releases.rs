use crate::errors::AppError;
use reqwest::Client;
use serde::Deserialize;

fn has_cuda_hint(name: &str) -> bool {
    let hints = [
        "cuda",
        "cu12",
        "cu11",
        "cuda12",
        "cuda11",
        "cuda-",
        "cuda_",
        "cudart",
    ];

    hints.iter().any(|hint| name.contains(hint))
}

/// Represents a GitHub Release
#[derive(Deserialize, Debug)]
pub struct Release {
    /// The tag name of the release (e.g. "v1.0.0")
    pub tag_name: String,
    /// List of downloadable assets attached to the release
    pub assets: Vec<Asset>,
}

/// Represents a single asset in a GitHub release
#[derive(Deserialize, Debug)]
pub struct Asset {
    /// Filename of the asset
    pub name: String,
    /// Direct URL to download the asset
    pub browser_download_url: String,
}

/// Fetches the latest release for a GitHub repository and returns the best asset URL.
/// `repo_url` should be the base URL, e.g. "https://github.com/ggml-org/llama.cpp"
pub async fn fetch_latest_release(client: &Client, repo_url: &str) -> Result<String, AppError> {
    let mut parts: Vec<&str> = repo_url
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .split('/')
        .collect();

    if parts.len() < 2 {
        return Err(AppError::Validation(format!(
            "Invalid GitHub URL: {repo_url}"
        )));
    }

    let repo = parts.pop().ok_or_else(|| AppError::Validation(format!("Invalid GitHub URL: {repo_url}")))?;
    let owner = parts.pop().ok_or_else(|| AppError::Validation(format!("Invalid GitHub URL: {repo_url}")))?;

    let api_url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
    tracing::info!("Fetching latest release from: {api_url}");

    let response = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| AppError::External {
            request_id: None,
            message: format!("Failed to fetch release API: {e}"),
        })?;

    if !response.status().is_success() {
        return Err(AppError::External {
            request_id: None,
            message: format!("Release API returned status: {}", response.status()),
        });
    }

    let release: Release = response.json().await.map_err(|e| AppError::External {
        request_id: None,
        message: format!("Failed to parse release JSON: {e}"),
    })?;

    if release.assets.is_empty() {
        return Err(AppError::NotFound(format!(
            "No assets found in latest release {}",
            release.tag_name
        )));
    }

    // Determine target OS and Architecture
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    tracing::info!("Matching assets for OS: {os}, Arch: {arch}");

    // Scoring system to find the best matching asset
    let mut best_asset: Option<&Asset> = None;
    let mut highest_score = 0;

    for asset in &release.assets {
        let name = asset.name.to_lowercase();
        let mut score = 0;

        // 1. OS Match
        match os {
            "windows" => {
                if name.contains("win") || name.contains("windows") {
                    score += 10;
                    if std::path::Path::new(&name).extension().is_some_and(|ext| ext.eq_ignore_ascii_case("zip")) {
                        score += 5;
                    }
                    if has_cuda_hint(&name) {
                        score += 8; // Prefer CUDA builds on Windows when available
                        if name.contains("12.") || name.contains("12-") || name.contains("12_") {
                            score += 2; // Slight preference for CUDA 12-era builds
                        }
                    } else if name.contains("vulkan") {
                        score += 4; // Good fallback
                    } else {
                        score += 1; // Generic/CPU
                    }
                } else {
                    continue; // Skip non-windows
                }
            }
            "linux" => {
                if name.contains("linux") || name.contains("ubuntu") {
                    score += 10;
                    if std::path::Path::new(&name).extension().is_some_and(|ext| ext.eq_ignore_ascii_case("tar.gz") || ext.eq_ignore_ascii_case("tgz")) {
                        score += 5;
                    }
                    if name.contains("cuda") || name.contains("rocm") {
                        score += 4; // Prefer GPU if available
                    }
                } else {
                    continue;
                }
            }
            "macos" => {
                if name.contains("mac") || name.contains("darwin") || name.contains("apple") {
                    score += 10;
                } else {
                    continue;
                }
            }
            _ => continue, // Unknown OS, skip
        }

        // 2. Arch Match
        match arch {
            "x86_64" => {
                if name.contains("x64") || name.contains("x86_64") || name.contains("amd64") {
                    score += 10;
                }
            }
            "aarch64" => {
                if name.contains("arm64") || name.contains("aarch64") {
                    score += 10;
                }
            }
            _ => {}
        }

        if score > highest_score {
            highest_score = score;
            best_asset = Some(asset);
        }
    }

    if let Some(asset) = best_asset {
        tracing::info!(
            "Selected remote asset: {} (Score: {})",
            asset.name,
            highest_score
        );
        Ok(asset.browser_download_url.clone())
    } else {
        Err(AppError::NotFound(format!(
            "No suitable release binary found for OS: {os}, Arch: {arch} in release {}",
            release.tag_name
        )))
    }
}
