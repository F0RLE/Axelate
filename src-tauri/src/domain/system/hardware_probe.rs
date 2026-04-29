//! Lightweight hardware probe used for runtime bundle selection and settings hints.

use crate::models::system::GpuStats;
use nvml_wrapper::{Nvml, cuda_driver_version_major, cuda_driver_version_minor};
use serde_json::Value;
use std::collections::HashSet;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use tokio::process::Command;
use tokio::sync::OnceCell;

static GPU_PROBE_CACHE: OnceCell<GpuInfo> = OnceCell::const_new();

/// Coarse accelerator class used to map systems to release bundle families.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AcceleratorClass {
    /// NVIDIA GPU with CUDA-capable runtime family.
    NvidiaCuda,
    /// AMD GPU family.
    AmdGpu,
    /// Intel GPU family.
    IntelGpu,
    /// Other non-CPU GPU family.
    GenericGpu,
    /// No usable GPU acceleration detected.
    CpuOnly,
    /// Detection failed, so callers should fall back to generic heuristics.
    Unknown,
}

/// Coarse CPU instruction tier used to select compatible CPU release bundles.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CpuInstructionTier {
    /// CPU supports AVX-512 foundation instructions.
    Avx512,
    /// CPU supports AVX2 instructions.
    Avx2,
    /// CPU supports AVX instructions.
    Avx,
    /// No known x86 AVX feature tier is available.
    Baseline,
}

impl CpuInstructionTier {
    /// Detects the best supported CPU instruction tier for the current process.
    pub fn current() -> Self {
        #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
        {
            if std::arch::is_x86_feature_detected!("avx512f") {
                return Self::Avx512;
            }
            if std::arch::is_x86_feature_detected!("avx2") {
                return Self::Avx2;
            }
            if std::arch::is_x86_feature_detected!("avx") {
                return Self::Avx;
            }
        }

        Self::Baseline
    }
}

/// Public system GPU probe result used by the frontend and downloader.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct GpuInfo {
    /// Whether a usable GPU adapter was detected.
    pub detected: bool,
    /// Human-readable adapter name.
    pub name: String,
    /// Whether CUDA-capable NVIDIA hardware was detected.
    pub cuda: bool,
    /// Preferred runtime backend hint (`cuda`, `vulkan`, `cpu`, `hip`, `sycl`).
    pub backend: String,
    /// Total GPU memory in megabytes, when available.
    pub memory: u32,
    /// CUDA driver major version, when available.
    pub cuda_driver_major: Option<u32>,
    /// CUDA driver minor version, when available.
    pub cuda_driver_minor: Option<u32>,
}

impl GpuInfo {
    /// Converts a probe result into the coarse accelerator class used by selectors.
    pub fn accelerator_class(&self) -> AcceleratorClass {
        match self.backend.as_str() {
            "cuda" => AcceleratorClass::NvidiaCuda,
            "hip" => AcceleratorClass::AmdGpu,
            "sycl" => AcceleratorClass::IntelGpu,
            "vulkan" => match gpu_name_brand(&self.name) {
                GpuBrand::Amd => AcceleratorClass::AmdGpu,
                GpuBrand::Intel => AcceleratorClass::IntelGpu,
                _ if self.detected => AcceleratorClass::GenericGpu,
                _ => AcceleratorClass::CpuOnly,
            },
            "cpu" => AcceleratorClass::CpuOnly,
            _ => {
                if self.detected {
                    AcceleratorClass::GenericGpu
                } else {
                    AcceleratorClass::Unknown
                }
            }
        }
    }
}

/// Enriches a coarse GPU probe with live runtime stats when available.
#[allow(
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss
)]
pub fn merge_probe_with_runtime_stats(mut probe: GpuInfo, gpu: Option<&GpuStats>) -> GpuInfo {
    let Some(gpu) = gpu else {
        return probe;
    };

    let gpu_name = gpu.name.clone();
    let is_nvidia = gpu_name.to_ascii_lowercase().contains("nvidia");
    probe.name = gpu_name;
    probe.detected = true;
    probe.cuda = probe.backend == "cuda" || is_nvidia;

    if gpu.memory_total.is_finite() && gpu.memory_total > 0.0 {
        let mb = gpu.memory_total / 1024.0 / 1024.0;
        probe.memory = if mb >= f64::from(u32::MAX) {
            u32::MAX
        } else {
            mb.floor() as u32
        };
    }

    probe
}

/// Probes the current system for a primary GPU and a matching runtime hint.
pub async fn probe_gpu_info() -> GpuInfo {
    GPU_PROBE_CACHE
        .get_or_init(probe_gpu_info_uncached)
        .await
        .clone()
}

async fn probe_gpu_info_uncached() -> GpuInfo {
    #[cfg(target_os = "windows")]
    {
        probe_gpu_from_names(probe_windows_gpu_names().await)
    }

    #[cfg(target_os = "macos")]
    {
        probe_gpu_from_names(probe_macos_gpu_names().await)
    }

    #[cfg(target_os = "linux")]
    {
        let lspci_names = probe_linux_lspci_names().await;
        if lspci_names.as_ref().is_some_and(|names| !names.is_empty()) {
            return probe_gpu_from_names(lspci_names);
        }

        probe_gpu_from_names(probe_linux_drm_names().await)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        default_probe()
    }
}

fn probe_gpu_from_names(names: Option<Vec<String>>) -> GpuInfo {
    match names {
        Some(names) if !names.is_empty() => gpu_probe_from_names(&names),
        _ => nvidia_probe_from_nvml().unwrap_or_else(default_probe),
    }
}

fn default_probe() -> GpuInfo {
    GpuInfo {
        detected: false,
        name: "Integrated / No GPU".to_string(),
        cuda: false,
        backend: "cpu".to_string(),
        memory: 0,
        cuda_driver_major: None,
        cuda_driver_minor: None,
    }
}

async fn probe_windows_gpu_names() -> Option<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(query_windows_gpu_names_wmi)
            .await
            .ok()?
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
#[allow(clippy::manual_let_else)]
fn query_windows_gpu_names_wmi() -> Option<Vec<String>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct VideoController {
        name: Option<String>,
    }

    let connection = match wmi::WMIConnection::new() {
        Ok(connection) => connection,
        Err(_) => return query_nvidia_smi_gpu_names(),
    };
    let controllers: Vec<VideoController> =
        match connection.raw_query("SELECT Name FROM Win32_VideoController") {
            Ok(controllers) => controllers,
            Err(_) => return query_nvidia_smi_gpu_names(),
        };
    let names = controllers
        .into_iter()
        .filter_map(|controller| controller.name)
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();

    normalize_names(names).or_else(query_nvidia_smi_gpu_names)
}

#[cfg(target_os = "macos")]
async fn probe_macos_gpu_names() -> Option<Vec<String>> {
    let output = Command::new("system_profiler")
        .args(["-json", "SPDisplaysDataType"])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    parse_macos_system_profiler_names(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(target_os = "linux")]
async fn probe_linux_lspci_names() -> Option<Vec<String>> {
    let output = Command::new("lspci").args(["-mm"]).output().await.ok()?;
    if !output.status.success() {
        return None;
    }

    parse_linux_lspci_names(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(target_os = "linux")]
async fn probe_linux_drm_names() -> Option<Vec<String>> {
    let mut entries = tokio::fs::read_dir("/sys/class/drm").await.ok()?;
    let mut names = Vec::new();

    while let Ok(Some(entry)) = entries.next_entry().await {
        let filename = entry.file_name().to_string_lossy().to_string();
        if !(filename.starts_with("card") || filename.starts_with("renderD")) {
            continue;
        }

        let vendor_path = entry.path().join("device").join("vendor");
        if let Ok(vendor_id) = tokio::fs::read_to_string(vendor_path).await {
            if let Some(name) = linux_vendor_name(vendor_id.trim()) {
                names.push(name.to_string());
            }
        }
    }

    normalize_names(names)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GpuBrand {
    Nvidia,
    Amd,
    Intel,
    Apple,
    Software,
    Other,
}

fn gpu_probe_from_names(names: &[String]) -> GpuInfo {
    let primary_name = names
        .iter()
        .max_by_key(|name| gpu_name_priority(name))
        .cloned()
        .or_else(|| names.first().cloned())
        .unwrap_or_else(|| "Integrated / No GPU".to_string());

    let brand = gpu_name_brand(&primary_name);
    if brand == GpuBrand::Software {
        if let Some(probe) = nvidia_probe_from_nvml() {
            return probe;
        }
    }

    let backend = preferred_backend_for_gpu_brand(brand);
    let detected = brand != GpuBrand::Software;
    let (cuda_driver_major, cuda_driver_minor) = if backend == "cuda" {
        detect_cuda_driver_version()
    } else {
        (None, None)
    };
    GpuInfo {
        detected,
        name: primary_name,
        cuda: backend == "cuda",
        backend: if detected {
            backend.to_string()
        } else {
            "cpu".to_string()
        },
        memory: 0,
        cuda_driver_major,
        cuda_driver_minor,
    }
}

fn nvidia_probe_from_nvml() -> Option<GpuInfo> {
    let (cuda_driver_major, cuda_driver_minor) = detect_cuda_driver_version();
    cuda_driver_major.map(|major| GpuInfo {
        detected: true,
        name: "NVIDIA CUDA GPU".to_string(),
        cuda: true,
        backend: "cuda".to_string(),
        memory: 0,
        cuda_driver_major: Some(major),
        cuda_driver_minor,
    })
}

const fn preferred_backend_for_gpu_brand(brand: GpuBrand) -> &'static str {
    match brand {
        GpuBrand::Nvidia => "cuda",
        GpuBrand::Amd => "hip",
        GpuBrand::Intel => "sycl",
        GpuBrand::Apple => "metal",
        GpuBrand::Software => "cpu",
        GpuBrand::Other => "vulkan",
    }
}

fn gpu_name_brand(name: &str) -> GpuBrand {
    let lower = name.to_ascii_lowercase();

    if is_software_adapter(name) {
        return GpuBrand::Software;
    }
    if lower.contains("nvidia")
        || lower.contains("geforce")
        || lower.contains("quadro")
        || lower.contains("rtx")
        || lower.contains("gtx")
    {
        return GpuBrand::Nvidia;
    }
    if lower.contains("amd") || lower.contains("radeon") || lower.contains("advanced micro devices")
    {
        return GpuBrand::Amd;
    }
    if lower.contains("intel") || lower.contains("arc") {
        return GpuBrand::Intel;
    }
    if lower.contains("apple")
        || lower.contains("metal")
        || lower.contains("m1")
        || lower.contains("m2")
        || lower.contains("m3")
        || lower.contains("m4")
    {
        return GpuBrand::Apple;
    }

    GpuBrand::Other
}

fn detect_cuda_driver_version() -> (Option<u32>, Option<u32>) {
    let Ok(nvml) = Nvml::init() else {
        return detect_cuda_driver_version_with_nvidia_smi();
    };
    let Ok(version) = nvml.sys_cuda_driver_version() else {
        return detect_cuda_driver_version_with_nvidia_smi();
    };

    let major = u32::try_from(cuda_driver_version_major(version)).ok();
    let minor = u32::try_from(cuda_driver_version_minor(version)).ok();
    (major, minor)
}

fn query_nvidia_smi_gpu_names() -> Option<Vec<String>> {
    let output = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name", "--format=csv,noheader"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    normalize_names(raw.lines().map(str::to_string).collect())
}

fn detect_cuda_driver_version_with_nvidia_smi() -> (Option<u32>, Option<u32>) {
    let output = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=driver_version",
            "--format=csv,noheader,nounits",
        ])
        .output();
    let Ok(output) = output else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let Some(version) = raw
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    else {
        return (None, None);
    };

    parse_nvidia_driver_version(version)
}

fn parse_nvidia_driver_version(version: &str) -> (Option<u32>, Option<u32>) {
    let mut parts = version.split('.');
    let major = parts.next().and_then(|part| part.parse::<u32>().ok());
    let minor = parts.next().and_then(|part| part.parse::<u32>().ok());
    (major, minor)
}

fn gpu_name_priority(name: &str) -> i32 {
    match gpu_name_brand(name) {
        GpuBrand::Software => 0,
        GpuBrand::Nvidia => 1_000,
        GpuBrand::Amd => 900,
        GpuBrand::Apple => 850,
        GpuBrand::Intel if name.to_ascii_lowercase().contains("arc") => 800,
        GpuBrand::Intel => 400,
        GpuBrand::Other => 200,
    }
}

fn is_software_adapter(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("microsoft basic display")
        || lower.contains("basic render")
        || lower.contains("software adapter")
        || lower.contains("llvmpipe")
        || lower.contains("swiftshader")
        || lower.contains("virtio")
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_macos_system_profiler_names(raw: &str) -> Option<Vec<String>> {
    let json: Value = serde_json::from_str(raw).ok()?;
    let entries = json.get("SPDisplaysDataType")?.as_array()?;
    let mut names = Vec::new();

    for entry in entries {
        if let Some(items) = entry.get("spdisplays_ndrvs").and_then(Value::as_array) {
            for item in items {
                if let Some(name) = item.get("_name").and_then(Value::as_str) {
                    names.push(name.trim().to_string());
                }
            }
        }

        if let Some(chipset) = entry.get("spdisplays_vendor").and_then(Value::as_str) {
            names.push(chipset.trim().to_string());
        }
        if let Some(model) = entry.get("sppci_model").and_then(Value::as_str) {
            names.push(model.trim().to_string());
        }
        if let Some(model) = entry.get("spdisplays_model").and_then(Value::as_str) {
            names.push(model.trim().to_string());
        }
    }

    normalize_names(names)
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_linux_lspci_names(raw: &str) -> Option<Vec<String>> {
    let mut names = Vec::new();

    for line in raw.lines() {
        let lower = line.to_ascii_lowercase();
        if !(lower.contains("\"vga compatible controller\"")
            || lower.contains("\"3d controller\"")
            || lower.contains("\"display controller\""))
        {
            continue;
        }

        let quoted = line
            .split('"')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();

        if let Some(vendor) = quoted.get(3) {
            if let Some(device) = quoted.get(5) {
                names.push(format!("{vendor} {device}"));
            } else {
                names.push((*vendor).to_string());
            }
        } else {
            names.push(line.trim().to_string());
        }
    }

    normalize_names(names)
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_linux_vendor_ids(raw: &str) -> Option<Vec<String>> {
    let mut names = Vec::new();

    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(name) = linux_vendor_name(line) {
            names.push(name.to_string());
        }
    }

    normalize_names(names)
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_vendor_name(vendor_id: &str) -> Option<&'static str> {
    match vendor_id.to_ascii_lowercase().as_str() {
        "0x10de" => Some("NVIDIA GPU"),
        "0x1002" | "0x1022" => Some("AMD GPU"),
        "0x8086" => Some("Intel GPU"),
        _ => None,
    }
}

#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
fn normalize_names(names: Vec<String>) -> Option<Vec<String>> {
    let mut seen = HashSet::new();
    let names = names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .filter(|name| seen.insert(name.to_ascii_lowercase()))
        .collect::<Vec<_>>();

    if names.is_empty() { None } else { Some(names) }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::indexing_slicing)]
mod tests {
    use super::*;

    #[test]
    fn classifies_windows_gpu_names() {
        let nvidia = gpu_probe_from_names(&[String::from("NVIDIA GeForce RTX 4090")]);
        assert_eq!(nvidia.backend, "cuda");
        assert!(nvidia.cuda);

        let amd = gpu_probe_from_names(&[String::from("AMD Radeon RX 7900 XTX")]);
        assert_eq!(amd.backend, "hip");

        let intel = gpu_probe_from_names(&[String::from("Intel Arc A770")]);
        assert_eq!(intel.backend, "sycl");

        let fallback = gpu_probe_from_names(&[String::from("Microsoft Basic Display Adapter")]);
        if fallback.detected {
            assert_eq!(fallback.backend, "cuda");
            assert!(fallback.cuda);
        } else {
            assert_eq!(fallback.backend, "cpu");
            assert!(!fallback.detected);
        }
    }

    #[test]
    fn parses_linux_lspci_machine_readable_output() {
        let parsed = parse_linux_lspci_names(
            r#"00:02.0 "VGA compatible controller" "Intel Corporation" "Arc A770"
01:00.0 "3D controller" "NVIDIA Corporation" "AD102 [GeForce RTX 4090]""#,
        )
        .expect("expected gpu names");

        assert_eq!(parsed[0], "Arc A770");
        assert!(parsed[1].contains("GeForce RTX 4090"));
    }

    #[test]
    fn parses_linux_vendor_ids_as_fallback() {
        let parsed = parse_linux_vendor_ids("0x8086\n0x10de\n").expect("expected vendor names");
        assert_eq!(parsed[0], "Intel GPU");
        assert_eq!(parsed[1], "NVIDIA GPU");
    }

    #[test]
    fn parses_macos_system_profiler_json() {
        let parsed = parse_macos_system_profiler_names(
            r#"{"SPDisplaysDataType":[{"sppci_model":"Apple M3 Max","spdisplays_model":"Apple M3 Max","spdisplays_ndrvs":[{"_name":"Apple M3 Max"}]}]}"#,
        )
        .expect("expected names");

        assert_eq!(parsed[0], "Apple M3 Max");
    }

    #[test]
    fn prefers_discrete_gpu_over_integrated_adapter() {
        let probe = gpu_probe_from_names(&[
            String::from("Intel(R) UHD Graphics 770"),
            String::from("NVIDIA GeForce RTX 4070"),
        ]);

        assert_eq!(probe.name, "NVIDIA GeForce RTX 4070");
        assert_eq!(probe.backend, "cuda");
    }

    #[test]
    fn nvml_fallback_is_used_when_windows_gpu_names_are_unavailable() {
        let probe = probe_gpu_from_names(None);
        if probe.detected {
            assert_eq!(probe.backend, "cuda");
            assert!(probe.cuda);
        } else {
            assert_eq!(probe.backend, "cpu");
        }
    }

    #[test]
    fn parses_nvidia_smi_driver_version() {
        assert_eq!(parse_nvidia_driver_version("566.36"), (Some(566), Some(36)));
        assert_eq!(parse_nvidia_driver_version("580"), (Some(580), None));
        assert_eq!(parse_nvidia_driver_version("bad"), (None, None));
    }

    #[test]
    fn merge_probe_with_runtime_stats_updates_name_and_memory() {
        let probe = GpuInfo {
            detected: false,
            name: "Integrated / No GPU".to_string(),
            cuda: false,
            backend: "cuda".to_string(),
            memory: 0,
            cuda_driver_major: None,
            cuda_driver_minor: None,
        };
        let gpu = GpuStats {
            usage: 0,
            memory_used: 0.0,
            memory_total: 8.0 * 1024.0 * 1024.0 * 1024.0,
            temp: 0,
            name: "NVIDIA GeForce RTX 4070".to_string(),
        };

        let merged = merge_probe_with_runtime_stats(probe, Some(&gpu));
        assert!(merged.detected);
        assert_eq!(merged.name, "NVIDIA GeForce RTX 4070");
        assert_eq!(merged.memory, 8192);
        assert!(merged.cuda);
    }
}
