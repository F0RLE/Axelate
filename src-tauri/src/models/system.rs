use serde::Serialize;
use specta::Type;

/// Complete system statistics snapshot
#[derive(Debug, Clone, Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    /// CPU usage and information
    pub cpu: CpuStats,
    /// RAM usage and availability
    pub ram: RamStats,
    /// GPU usage (if available)
    pub gpu: Option<GpuStats>,
    /// VRAM usage (if GPU present)
    pub vram: Option<VramStats>,
    /// Disk I/O statistics
    pub disk: DiskStats,
    /// Network I/O statistics
    pub network: NetworkStats,
    /// Current process ID
    pub pid: u32,
    /// CPU usage of the current process (0-100)
    pub app_cpu: f32,
    /// Memory used by the current process (bytes)
    pub app_memory: f64,
}

/// GPU (Graphics Processing Unit) statistics
#[derive(Debug, Clone, Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuStats {
    /// GPU usage percentage (0-100)
    pub usage: u32,
    /// Memory currently used (bytes)
    pub memory_used: f64,
    /// Total available memory (bytes)
    pub memory_total: f64,
    /// GPU temperature (Celsius)
    pub temp: u32,
    /// GPU model name
    pub name: String,
}

/// VRAM (Video RAM) statistics
#[derive(Debug, Clone, Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct VramStats {
    /// VRAM usage percentage (0-100)
    pub percent: f32,
    /// VRAM currently used (GB)
    pub used_gb: f32,
    /// Total VRAM capacity (GB)
    pub total_gb: f32,
}

/// CPU (Central Processing Unit) statistics
#[derive(Debug, Clone, Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuStats {
    /// CPU usage percentage (0-100)
    pub percent: f32,
    /// Number of logical cores
    pub cores: u32,
    /// CPU model name
    pub name: String,
}

/// RAM (Random Access Memory) statistics
#[derive(Debug, Clone, Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct RamStats {
    /// RAM usage percentage (0-100)
    pub percent: f32,
    /// RAM currently used (GB)
    pub used_gb: f32,
    /// Total RAM capacity (GB)
    pub total_gb: f32,
    /// RAM available for allocation (GB)
    pub available_gb: f32,
}

/// Disk I/O (Input/Output) statistics
#[derive(Debug, Clone, Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskStats {
    /// Read speed (bytes/sec)
    pub read_rate: f64,
    /// Write speed (bytes/sec)
    pub write_rate: f64,
    /// Disk utilization percentage (0-100)
    pub utilization: f32,
    /// Total disk capacity (GB)
    pub total_gb: f32,
    /// Disk space currently used (GB)
    pub used_gb: f32,
    /// Disk activity percentage (0-100)
    pub activity_percent: f32,
}

/// Network I/O statistics
#[derive(Debug, Clone, Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    /// Download speed (bytes/sec)
    pub download_rate: f64,
    /// Upload speed (bytes/sec)
    pub upload_rate: f64,
    /// Total bytes received since boot
    pub total_received: f64,
    /// Total bytes sent since boot
    pub total_sent: f64,
    /// Network utilization percentage (0-100)
    pub utilization: f32,
    /// Network activity percentage (0-100)
    pub activity_percent: f32,
}
