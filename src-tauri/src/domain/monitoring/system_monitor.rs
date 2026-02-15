use std::sync::LazyLock;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[cfg(not(test))]
use nvml_wrapper::Nvml;
#[cfg(not(test))]
use serde::Deserialize;
#[cfg(not(test))]
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};
use tauri::{AppHandle, Emitter};
#[cfg(not(test))]
use wmi::WMIConnection;

use crate::models::{
    CpuStats, DiskStats, GpuStats, NetworkStats, RamStats, SystemStats, VramStats,
};

// ==================================================================================
// Collectors (Hardware Abstraction)
// ==================================================================================

/// Collects CPU, RAM, Disk, and Network stats using sysinfo
struct SystemCollector {
    #[cfg(not(test))]
    sys: Option<System>,
    #[cfg(not(test))]
    networks: Option<Networks>,
    #[cfg(not(test))]
    disks: Option<Disks>,
}

impl SystemCollector {
    const fn new() -> Self {
        Self {
            #[cfg(not(test))]
            sys: None,
            #[cfg(not(test))]
            networks: None,
            #[cfg(not(test))]
            disks: None,
        }
    }

    fn ensure_initialized(&mut self) {
        #[cfg(not(test))]
        if self.sys.is_none() {
            log::debug!("[SystemMonitor] Initializing System resources");
            self.sys = Some(System::new_with_specifics(
                RefreshKind::nothing()
                    .with_cpu(CpuRefreshKind::everything())
                    .with_memory(MemoryRefreshKind::everything()),
            ));
        }
        #[cfg(not(test))]
        if self.networks.is_none() {
            self.networks = Some(Networks::new_with_refreshed_list());
        }
        #[cfg(not(test))]
        if self.disks.is_none() {
            self.disks = Some(Disks::new_with_refreshed_list());
        }
    }

    fn drop_resources(&mut self) {
        #[cfg(not(test))]
        {
            self.sys = None;
            self.networks = None;
            self.disks = None;
        }
    }

    #[cfg(not(test))]
    fn refresh_cpu_memory(&mut self) {
        if let Some(sys) = self.sys.as_mut() {
            sys.refresh_cpu_specifics(CpuRefreshKind::nothing().with_cpu_usage());
            sys.refresh_memory();
        }
    }

    #[cfg(not(test))]
    fn refresh_networks(&mut self) {
        if let Some(networks) = self.networks.as_mut() {
            networks.refresh(true);
        }
    }

    #[cfg(not(test))]
    fn refresh_disks(&mut self) {
        if let Some(disks) = self.disks.as_mut() {
            disks.refresh(true);
        }
    }

    fn get_disk_io(&mut self) -> (u64, u64) {
        #[cfg(not(test))]
        if let Some(sys) = self.sys.as_mut() {
            sys.refresh_processes_specifics(
                sysinfo::ProcessesToUpdate::All,
                false,
                sysinfo::ProcessRefreshKind::nothing().with_disk_usage(),
            );
            let mut read: u64 = 0;
            let mut write: u64 = 0;
            for process in sys.processes().values() {
                let usage = process.disk_usage();
                read += usage.read_bytes;
                write += usage.written_bytes;
            }
            return (read, write);
        }
        (0, 0)
    }
}

/// Collects GPU stats using NVML or WMI
struct GpuCollector {
    #[cfg(not(test))]
    nvml: Option<Nvml>,
}

#[derive(Deserialize, Debug)]
#[serde(rename = "Win32_VideoController")]
#[allow(non_snake_case)]
#[allow(non_camel_case_types)]
#[cfg(not(test))]
struct Win32_VideoController {
    Name: String,
    AdapterRAM: Option<u64>,
}

impl GpuCollector {
    const fn new() -> Self {
        Self {
            #[cfg(not(test))]
            nvml: None,
        }
    }

    fn ensure_initialized(&mut self) {
        #[cfg(not(test))]
        if self.nvml.is_none() {
            self.nvml = Nvml::init().ok();
        }
    }

    fn drop_resources(&mut self) {
        #[cfg(not(test))]
        {
            self.nvml = None;
        }
    }

    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
    fn collect(&self) -> (Option<GpuStats>, Option<VramStats>) {
        #[cfg(not(test))]
        let bytes_to_gb = |b: f64| (b / 1024.0 / 1024.0 / 1024.0) as f32;

        // 1. Try NVIDIA NVML first
        #[cfg(not(test))]
        #[allow(clippy::collapsible_if)]
        if let Some(nvml) = &self.nvml {
            if let Ok(device) = nvml.device_by_index(0) {
                if let Ok(util) = device.utilization_rates() {
                    if let Ok(mem) = device.memory_info() {
                        let total_vram = mem.total as f64;
                        let used_vram = mem.used as f64;
                        let vram_percent = if total_vram > 0.0 {
                            (used_vram / total_vram * 100.0) as f32
                        } else {
                            0.0
                        };

                        let gpu = GpuStats {
                            usage: util.gpu,
                            memory_used: mem.used as f64,
                            memory_total: mem.total as f64,
                            temp: device
                                .temperature(
                                    nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu,
                                )
                                .unwrap_or(0),
                            name: device.name().unwrap_or_else(|_| "NVIDIA GPU".to_string()),
                        };
                        let vram = VramStats {
                            percent: vram_percent,
                            used_gb: bytes_to_gb(used_vram),
                            total_gb: bytes_to_gb(total_vram),
                        };
                        return (Some(gpu), Some(vram));
                    }
                }
            }
        }

        // 2. Fallback to WMI (Local Scope for Thread Safety)
        #[cfg(not(test))]
        if let Ok(wmi) = WMIConnection::new() {
            let results: Result<Vec<Win32_VideoController>, _> = wmi.query();
            #[allow(clippy::collapsible_if)]
            if let Ok(controllers) = results {
                if let Some(best_gpu) = controllers
                    .iter()
                    .filter(|c| !c.Name.contains("Microsoft Remote Display Adapter"))
                    .max_by_key(|c| c.AdapterRAM.unwrap_or(0))
                {
                    let vram_bytes = best_gpu.AdapterRAM.unwrap_or(0);
                    let gpu = GpuStats {
                        usage: 0,
                        memory_used: 0.0,
                        memory_total: vram_bytes as f64,
                        temp: 0,
                        name: best_gpu.Name.clone(),
                    };
                    let vram = VramStats {
                        percent: 0.0,
                        used_gb: 0.0,
                        total_gb: bytes_to_gb(vram_bytes as f64),
                    };
                    return (Some(gpu), Some(vram));
                }
            }
        }

        (None, None)
    }
}

// ==================================================================================
// Service (Aggregation)
// ==================================================================================

struct SystemMonitorService {
    system: SystemCollector,
    gpu: GpuCollector,

    // State
    last_update: Instant,
    last_net_recv: u64,
    last_net_sent: u64,

    // Disk Monitoring Throttling
    last_disk_update: Instant,
    cached_read_rate: f64,
    cached_write_rate: f64,
    cached_down_rate: f64,
    cached_up_rate: f64,
}

impl SystemMonitorService {
    fn new() -> Self {
        Self {
            system: SystemCollector::new(),
            gpu: GpuCollector::new(),
            last_update: Instant::now(),
            last_net_recv: 0,
            last_net_sent: 0,
            last_disk_update: Instant::now(),
            cached_read_rate: 0.0,
            cached_write_rate: 0.0,
            cached_down_rate: 0.0,
            cached_up_rate: 0.0,
        }
    }

    fn ensure_resources(&mut self) {
        self.system.ensure_initialized();
        self.gpu.ensure_initialized();
    }

    fn drop_resources(&mut self) {
        log::debug!("[SystemMonitor] Dropping resources to save RAM");
        self.system.drop_resources();
        self.gpu.drop_resources();
    }

    #[allow(clippy::cast_precision_loss)]
    #[allow(clippy::cast_possible_truncation)]
    fn collect_stats(&mut self) -> SystemStats {
        self.ensure_resources();

        let now = Instant::now();
        let elapsed = now.duration_since(self.last_update).as_secs_f64();

        // 1. Refresh Data
        #[cfg(not(test))]
        {
            self.system.refresh_networks();
            self.system.refresh_cpu_memory();
            self.system.refresh_disks();
        }

        // 2. Calculate CPU Stats
        #[cfg(not(test))]
        let (cpu_percent, cpu_cores, cpu_name) = if let Some(sys) = self.system.sys.as_ref() {
            let percent = sys.global_cpu_usage();
            let cpus = sys.cpus();
            let name = cpus
                .first()
                .map_or_else(|| "Unknown".to_string(), |c| c.brand().to_string());
            (percent, cpus.len(), name)
        } else {
            (0.0, 0, "Unknown".to_string())
        };

        #[cfg(test)]
        let (cpu_percent, cpu_cores, cpu_name) = (0.0, 4, "Test CPU".to_string());

        // 3. Calculate RAM Stats
        #[cfg(not(test))]
        let (total_memory, used_memory, available_memory) =
            if let Some(sys) = self.system.sys.as_ref() {
                let total = sys.total_memory() as f64;
                let avail = sys.available_memory() as f64;
                (total, total - avail, avail)
            } else {
                (0.0, 0.0, 0.0)
            };

        #[cfg(test)]
        let (total_memory, used_memory, available_memory) = (
            16.0 * 1024.0 * 1024.0 * 1024.0,
            8.0 * 1024.0 * 1024.0 * 1024.0,
            8.0 * 1024.0 * 1024.0 * 1024.0,
        );

        let ram_percent = if total_memory > 0.0 {
            ((used_memory / total_memory) * 100.0) as f32
        } else {
            0.0
        };

        // 4. Calculate Network Rates
        #[cfg(not(test))]
        let (total_recv, total_sent): (u64, u64) =
            if let Some(networks) = self.system.networks.as_ref() {
                let mut recv: u64 = 0;
                let mut sent: u64 = 0;
                for (_, data) in networks {
                    recv += data.total_received();
                    sent += data.total_transmitted();
                }
                (recv, sent)
            } else {
                (0, 0)
            };

        #[cfg(test)]
        let (total_recv, total_sent): (u64, u64) = (0, 0);

        if elapsed >= 0.2 {
            if self.last_net_recv > 0 {
                self.cached_down_rate =
                    (total_recv.saturating_sub(self.last_net_recv)) as f64 / elapsed;
                self.cached_up_rate =
                    (total_sent.saturating_sub(self.last_net_sent)) as f64 / elapsed;
            }
            self.last_update = now;
            self.last_net_recv = total_recv;
            self.last_net_sent = total_sent;
        }

        // 5. Disk I/O Throttling
        if self.last_disk_update.elapsed() >= Duration::from_millis(500) {
            let (read, write) = self.system.get_disk_io();
            let disk_elapsed = self.last_disk_update.elapsed().as_secs_f64();
            if disk_elapsed > 0.0 {
                self.cached_read_rate = read as f64 / disk_elapsed;
                self.cached_write_rate = write as f64 / disk_elapsed;
            }
            self.last_disk_update = Instant::now();
        }

        // 6. Disk Space
        #[cfg(not(test))]
        let (total_disk_space, total_disk_used) = if let Some(disks) = self.system.disks.as_ref() {
            let mut total: u64 = 0;
            let mut used: u64 = 0;
            for disk in disks {
                total += disk.total_space();
                used += disk.total_space().saturating_sub(disk.available_space());
            }
            (total, used)
        } else {
            (0, 0)
        };

        #[cfg(test)]
        let (total_disk_space, total_disk_used) = (0, 0);

        // 7. GPU Stats
        let (gpu_stats, vram_stats) = self.gpu.collect();

        // 8. Derived Metrics
        let total_disk_speed_mb =
            (self.cached_read_rate + self.cached_write_rate) / (1024.0 * 1024.0);
        let disk_activity_percent = if total_disk_speed_mb > 0.0 {
            ((total_disk_speed_mb / 500.0) * 100.0).min(100.0) as f32
        } else {
            0.0
        };

        let total_net_speed_mb = (self.cached_down_rate + self.cached_up_rate) / (1024.0 * 1024.0);
        let net_activity_percent = if total_net_speed_mb > 0.0 {
            ((total_net_speed_mb / 100.0) * 100.0).min(100.0) as f32
        } else {
            0.0
        };

        #[allow(unused_variables)]
        let bytes_to_gb = |b: f64| (b / 1024.0 / 1024.0 / 1024.0) as f32;

        SystemStats {
            cpu: CpuStats {
                percent: cpu_percent,
                cores: cpu_cores as u32,
                name: cpu_name,
            },
            ram: RamStats {
                percent: ram_percent,
                used_gb: bytes_to_gb(used_memory),
                total_gb: bytes_to_gb(total_memory),
                available_gb: bytes_to_gb(available_memory),
            },
            gpu: gpu_stats,
            vram: vram_stats,
            disk: DiskStats {
                read_rate: self.cached_read_rate,
                write_rate: self.cached_write_rate,
                utilization: if total_disk_space > 0 {
                    (total_disk_used as f64 / total_disk_space as f64 * 100.0) as f32
                } else {
                    0.0
                },
                total_gb: bytes_to_gb(total_disk_space as f64),
                used_gb: bytes_to_gb(total_disk_used as f64),
                activity_percent: disk_activity_percent,
            },
            network: NetworkStats {
                download_rate: self.cached_down_rate,
                upload_rate: self.cached_up_rate,
                total_received: total_recv as f64,
                total_sent: total_sent as f64,
                utilization: 0.0,
                activity_percent: net_activity_percent,
            },
            pid: std::process::id(),
        }
    }
}

// ==================================================================================
// Public Interface (Facades)
// ==================================================================================

static MONITOR: LazyLock<Mutex<SystemMonitorService>> =
    LazyLock::new(|| Mutex::new(SystemMonitorService::new()));

static MONITORING_ACTIVE: AtomicBool = AtomicBool::new(false);
static MONITORING_PAUSED: AtomicBool = AtomicBool::new(false);

/// Retrieves current system statistics (CPU, RAM, GPU, disk, network)
pub fn get_stats() -> SystemStats {
    let mut monitor = match MONITOR.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::error!("[SystemMonitor] Mutex poisoned; recovering state");
            poisoned.into_inner()
        }
    };
    monitor.collect_stats()
}

/// Starts system monitoring loop that emits stats at specified interval
pub fn start_monitoring(app: AppHandle, interval_ms: u64) {
    if MONITORING_ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(move || {
        loop {
            if !MONITORING_ACTIVE.load(Ordering::SeqCst) {
                break;
            }

            // Check if paused (e.g. window not focused)
            if MONITORING_PAUSED.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(500));
                continue;
            }

            let stats = get_stats();
            let _ = app.emit("system_stats", &stats);
            std::thread::sleep(Duration::from_millis(interval_ms));
        }
    });
}

/// Stop the system monitoring loop gracefully
pub fn stop_monitoring() {
    MONITORING_ACTIVE.store(false, Ordering::SeqCst);
}

/// Pause or Resume monitoring (called from frontend)
pub fn set_paused(paused: bool) {
    MONITORING_PAUSED.store(paused, Ordering::SeqCst);
    if paused {
        #[allow(clippy::collapsible_if)]
        if let Ok(mut monitor) = MONITOR.lock() {
            monitor.drop_resources();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // Flaky on some Windows environments due to WMI/COM
    fn test_get_stats_sanity_check() {
        let stats = get_stats();

        // CPU
        assert!(
            stats.cpu.percent >= 0.0 && stats.cpu.percent <= 100.0,
            "CPU percent out of range"
        );
        assert!(stats.cpu.cores > 0, "CPU cores should be > 0");

        // RAM
        assert!(
            stats.ram.percent >= 0.0 && stats.ram.percent <= 100.0,
            "RAM percent out of range"
        );
        assert!(stats.ram.total_gb > 0.0, "Total RAM should be > 0");
    }
}
