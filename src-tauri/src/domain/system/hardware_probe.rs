//! Lightweight hardware probe used for runtime bundle selection and settings hints.

use crate::models::system::GpuStats;
use serde_json::Value;
use std::collections::HashSet;
use tokio::process::Command;

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
}

impl GpuInfo {
    /// Converts a probe result into the coarse accelerator class used by selectors.
    pub fn accelerator_class(&self) -> AcceleratorClass {
        match self.backend.as_str() {
            "cuda" => AcceleratorClass::NvidiaCuda,
            "hip" => AcceleratorClass::AmdGpu,
            "sycl" => AcceleratorClass::IntelGpu,
            "vulkan" => {
                let lower = self.name.to_ascii_lowercase();
                if lower.contains("amd") || lower.contains("radeon") {
                    AcceleratorClass::AmdGpu
                } else if lower.contains("intel") || lower.contains("arc") {
                    AcceleratorClass::IntelGpu
                } else if self.detected {
                    AcceleratorClass::GenericGpu
                } else {
                    AcceleratorClass::CpuOnly
                }
            }
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
        _ => default_probe(),
    }
}

fn default_probe() -> GpuInfo {
    GpuInfo {
        detected: false,
        name: "Integrated / No GPU".to_string(),
        cuda: false,
        backend: "cpu".to_string(),
        memory: 0,
    }
}

async fn probe_windows_gpu_names() -> Option<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ])
            .output()
            .await
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let names = stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();

        Some(names)
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
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
    let output = Command::new("sh")
        .args([
            "-c",
            "for f in /sys/class/drm/card*/device/vendor /sys/class/drm/renderD*/device/vendor; do [ -f \"$f\" ] && cat \"$f\"; done",
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    parse_linux_vendor_ids(&String::from_utf8_lossy(&output.stdout))
}

fn gpu_probe_from_names(names: &[String]) -> GpuInfo {
    let primary_name = names
        .iter()
        .max_by_key(|name| gpu_name_priority(name))
        .cloned()
        .or_else(|| names.first().cloned())
        .unwrap_or_else(|| "Integrated / No GPU".to_string());

    let lower = primary_name.to_ascii_lowercase();
    let backend = if lower.contains("nvidia")
        || lower.contains("geforce")
        || lower.contains("quadro")
        || lower.contains("rtx")
        || lower.contains("gtx")
    {
        "cuda"
    } else if lower.contains("amd")
        || lower.contains("radeon")
        || lower.contains("advanced micro devices")
    {
        "hip"
    } else if lower.contains("intel") || lower.contains("arc") {
        "sycl"
    } else if lower.contains("apple")
        || lower.contains("metal")
        || lower.contains("m1")
        || lower.contains("m2")
        || lower.contains("m3")
        || lower.contains("m4")
    {
        "metal"
    } else if is_software_adapter(&primary_name) {
        "cpu"
    } else {
        "vulkan"
    };

    let detected = !is_software_adapter(&primary_name);
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
    }
}

fn gpu_name_priority(name: &str) -> i32 {
    let lower = name.to_ascii_lowercase();
    if is_software_adapter(name) {
        return 0;
    }

    if lower.contains("nvidia")
        || lower.contains("geforce")
        || lower.contains("quadro")
        || lower.contains("rtx")
        || lower.contains("gtx")
    {
        return 1_000;
    }

    if lower.contains("amd") || lower.contains("radeon") || lower.contains("advanced micro devices")
    {
        return 900;
    }

    if lower.contains("apple")
        || lower.contains("metal")
        || lower.contains("m1")
        || lower.contains("m2")
        || lower.contains("m3")
        || lower.contains("m4")
    {
        return 850;
    }

    if lower.contains("intel") && lower.contains("arc") {
        return 800;
    }

    if lower.contains("intel") {
        return 400;
    }

    200
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
        match line.to_ascii_lowercase().as_str() {
            "0x10de" => names.push("NVIDIA GPU".to_string()),
            "0x1002" | "0x1022" => names.push("AMD GPU".to_string()),
            "0x8086" => names.push("Intel GPU".to_string()),
            _ => {}
        }
    }

    normalize_names(names)
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
        assert_eq!(fallback.backend, "cpu");
        assert!(!fallback.detected);
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
    fn merge_probe_with_runtime_stats_updates_name_and_memory() {
        let probe = GpuInfo {
            detected: false,
            name: "Integrated / No GPU".to_string(),
            cuda: false,
            backend: "cuda".to_string(),
            memory: 0,
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
