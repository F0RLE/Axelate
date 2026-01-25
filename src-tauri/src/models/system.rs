use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub cpu: CpuStats,
    pub ram: RamStats,
    pub gpu: Option<GpuStats>,
    pub vram: Option<VramStats>,
    pub disk: DiskStats,
    pub network: NetworkStats,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct GpuStats {
    pub usage: u32,
    pub memory_used: u64,
    pub memory_total: u64,
    pub temp: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VramStats {
    pub percent: f32,
    pub used_gb: f32,
    pub total_gb: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CpuStats {
    pub percent: f32,
    pub cores: usize,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RamStats {
    pub percent: f32,
    pub used_gb: f32,
    pub total_gb: f32,
    pub available_gb: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskStats {
    pub read_rate: f64,
    pub write_rate: f64,
    pub utilization: f32,
    pub total_gb: f32,
    pub used_gb: f32,
    pub activity_percent: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkStats {
    pub download_rate: f64,
    pub upload_rate: f64,
    pub total_received: u64,
    pub total_sent: u64,
    pub utilization: f32,
    pub activity_percent: f32,
}
