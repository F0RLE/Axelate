use crate::models::system::{GpuStats, VramStats};
use nvml_wrapper::Nvml;

/// Collector for GPU and VRAM statistics using NVML
pub struct GpuCollector {
    nvml: Option<Nvml>,
}

impl std::fmt::Debug for GpuCollector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GpuCollector")
            .field("nvml_is_loaded", &self.nvml.is_some())
            .finish()
    }
}

impl Default for GpuCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl GpuCollector {
    /// Initializes the NVML library if possible
    pub fn new() -> Self {
        let nvml = Nvml::init().ok();
        Self { nvml }
    }

    /// Collects current GPU and VRAM statistics
    pub fn collect(&mut self) -> (Option<GpuStats>, Option<VramStats>) {
        let Some(nvml) = &self.nvml else {
            return (None, None);
        };

        let Ok(device) = nvml.device_by_index(0) else {
            return (None, None);
        };

        let name = device.name().unwrap_or_else(|_| "NVIDIA GPU".to_string());
        let utilization = device.utilization_rates().ok();
        let memory = device.memory_info().ok();
        let temp = device
            .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
            .ok();

        #[allow(clippy::cast_precision_loss)]
        let gpu_stats = Some(GpuStats {
            usage: utilization.map_or(0, |u| u.gpu),
            memory_used: memory.as_ref().map_or(0.0, |m| m.used as f64),
            memory_total: memory.as_ref().map_or(0.0, |m| m.total as f64),
            temp: temp.unwrap_or(0),
            name,
        });

        #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
        let vram_stats = memory.map(|m| {
            let used_gb = (m.used as f64 / 1_073_741_824.0) as f32;
            let total_gb = (m.total as f64 / 1_073_741_824.0) as f32;
            VramStats {
                percent: if total_gb > 0.0 {
                    (used_gb / total_gb) * 100.0
                } else {
                    0.0
                },
                used_gb,
                total_gb,
            }
        });

        (gpu_stats, vram_stats)
    }
}
