use once_cell::sync::Lazy;

use nvml_wrapper::Nvml;
use serde::Deserialize;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use std::time::Instant;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};
use tauri::{AppHandle, Emitter};
use wmi::{COMLibrary, WMIConnection};

use crate::models::{
    CpuStats, DiskStats, GpuStats, NetworkStats, RamStats, SystemStats, VramStats,
};

struct Monitor {
    sys: Option<System>,
    networks: Option<Networks>,
    disks: Option<Disks>,
    last_update: Instant,
    last_net_recv: u64,
    last_net_sent: u64,

    // Disk Monitoring Throttling
    last_disk_update: Instant,
    cached_read_rate: f64,
    cached_write_rate: f64,
    cached_down_rate: f64,
    cached_up_rate: f64,

    nvml: Option<Nvml>,
}

#[derive(Deserialize, Debug)]
#[serde(rename = "Win32_VideoController")]
#[allow(non_snake_case)]
#[allow(non_camel_case_types)]
struct Win32_VideoController {
    Name: String,
    AdapterRAM: Option<u64>,
}

static MONITOR: Lazy<Mutex<Monitor>> = Lazy::new(|| {
    Mutex::new(Monitor {
        sys: None,
        networks: None,
        disks: None,
        last_update: Instant::now(),
        last_net_recv: 0,
        last_net_sent: 0,

        last_disk_update: Instant::now(),
        cached_read_rate: 0.0,
        cached_write_rate: 0.0,
        cached_down_rate: 0.0,
        cached_up_rate: 0.0,

        nvml: None,
    })
});

impl Monitor {
    fn ensure_resources(&mut self) {
        if self.sys.is_none() {
            log::debug!("[SystemMonitor] Initializing resources");
            self.sys = Some(System::new_with_specifics(
                RefreshKind::nothing()
                    .with_cpu(CpuRefreshKind::everything())
                    .with_memory(MemoryRefreshKind::everything()),
            ));
        }
        if self.networks.is_none() {
            self.networks = Some(Networks::new_with_refreshed_list());
        }
        if self.disks.is_none() {
            self.disks = Some(Disks::new_with_refreshed_list());
        }
        if self.nvml.is_none() {
            self.nvml = Nvml::init().ok();
        }
    }

    fn drop_resources(&mut self) {
        log::debug!("[SystemMonitor] Dropping resources to save RAM");
        self.sys = None;
        self.networks = None;
        self.disks = None;
        self.nvml = None;
    }
}

pub fn get_stats() -> SystemStats {
    let mut monitor = match MONITOR.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::error!("[SystemMonitor] Mutex poisoned; recovering state");
            poisoned.into_inner()
        }
    };

    monitor.ensure_resources();

    // Strategy: Extract mutable references to local variables to avoid borrowing 'monitor' twice
    // during the refresh operations.

    // 1. Refresh Network
    if let Some(networks) = monitor.networks.as_mut() {
        networks.refresh(true);
    }

    // 2. Refresh CPU & Memory
    if let Some(sys) = monitor.sys.as_mut() {
        sys.refresh_cpu_specifics(CpuRefreshKind::nothing().with_cpu_usage());
        sys.refresh_memory();
    }

    // 3. Refresh Disks
    if let Some(disks) = monitor.disks.as_mut() {
        disks.refresh(true);
    }

    let now = Instant::now();
    let elapsed = now.duration_since(monitor.last_update).as_secs_f64();

    // 4. Calculate CPU Stats
    let (cpu_percent, cpu_cores, cpu_name) = if let Some(sys) = monitor.sys.as_mut() {
        let percent = sys.global_cpu_usage();
        let cpus = sys.cpus();
        let name = cpus
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown".to_string());
        (percent, cpus.len(), name)
    } else {
        (0.0, 0, "Unknown".to_string())
    };

    // 5. Calculate RAM Stats
    let (total_memory, used_memory, available_memory) = if let Some(sys) = monitor.sys.as_mut() {
        let total = sys.total_memory() as f64;
        let avail = sys.available_memory() as f64;
        (total, total - avail, avail)
    } else {
        (0.0, 0.0, 0.0)
    };

    let ram_percent = if total_memory > 0.0 {
        (used_memory / total_memory * 100.0) as f32
    } else {
        0.0
    };

    // 6. Calculate Network Rates
    let mut total_recv: u64 = 0;
    let mut total_sent: u64 = 0;
    if let Some(networks) = monitor.networks.as_mut() {
        for (_name, data) in networks.iter() {
            total_recv += data.total_received();
            total_sent += data.total_transmitted();
        }
    }

    if elapsed >= 0.2 {
        if monitor.last_net_recv > 0 {
            monitor.cached_down_rate =
                (total_recv.saturating_sub(monitor.last_net_recv)) as f64 / elapsed;
            monitor.cached_up_rate =
                (total_sent.saturating_sub(monitor.last_net_sent)) as f64 / elapsed;
        }
        monitor.last_update = now;
        monitor.last_net_recv = total_recv;
        monitor.last_net_sent = total_sent;
    }

    let download_rate = monitor.cached_down_rate;
    let upload_rate = monitor.cached_up_rate;

    // 7. Disk I/O Throttling
    let disk_elapsed_check = monitor.last_disk_update.elapsed();
    if disk_elapsed_check >= Duration::from_millis(500) {
        let (disk_read_bytes, disk_written_bytes) = if let Some(sys) = monitor.sys.as_mut() {
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
            (read, write)
        } else {
            (0, 0)
        };

        let disk_elapsed = disk_elapsed_check.as_secs_f64();
        if disk_elapsed > 0.0 {
            monitor.cached_read_rate = disk_read_bytes as f64 / disk_elapsed;
            monitor.cached_write_rate = disk_written_bytes as f64 / disk_elapsed;
        }
        monitor.last_disk_update = Instant::now();
    }

    let read_rate = monitor.cached_read_rate;
    let write_rate = monitor.cached_write_rate;

    // 8. Totals
    let mut total_disk_space: u64 = 0;
    let mut total_disk_used: u64 = 0;
    if let Some(disks) = monitor.disks.as_mut() {
        for disk in disks {
            total_disk_space += disk.total_space();
            total_disk_used += disk.total_space().saturating_sub(disk.available_space());
        }
    }

    let bytes_to_gb = |b: f64| (b / 1024.0 / 1024.0 / 1024.0) as f32;

    // 9. GPU Stats
    let mut gpu_stats: Option<GpuStats> = None;
    let mut vram_stats: Option<VramStats> = None;

    // 9.1 Try NVIDIA NVML first
    if let Some(nvml) = &monitor.nvml
        && let Ok(device) = nvml.device_by_index(0)
        && let Ok(util) = device.utilization_rates()
        && let Ok(mem) = device.memory_info()
    {
        let total_vram = mem.total as f64;
        let used_vram = mem.used as f64;
        let vram_percent = if total_vram > 0.0 {
            (used_vram / total_vram * 100.0) as f32
        } else {
            0.0
        };

        gpu_stats = Some(GpuStats {
            usage: util.gpu,
            memory_used: mem.used,
            memory_total: mem.total,
            temp: device
                .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
                .unwrap_or(0),
            name: device.name().unwrap_or_else(|_| "NVIDIA GPU".to_string()),
        });

        vram_stats = Some(VramStats {
            percent: vram_percent,
            used_gb: bytes_to_gb(used_vram),
            total_gb: bytes_to_gb(total_vram),
        });
    } else {
        // 9.2 Fallback to WMI (Local Scope for Thread Safety)
        // Instantiate COM/WMI locally to avoid Send/Sync issues with static storage
        let com_lib = COMLibrary::new().ok();
        if let Some(lib) = com_lib {
            if let Ok(wmi) = WMIConnection::new(lib) {
                let results: Result<Vec<Win32_VideoController>, _> = wmi.query();
                if let Ok(controllers) = results {
                    // Find best dedicated GPU (highest VRAM)
                    // Filter out basic/remote adapters
                    if let Some(best_gpu) = controllers
                        .iter()
                        .filter(|c| !c.Name.contains("Microsoft Remote Display Adapter"))
                        .max_by_key(|c| c.AdapterRAM.unwrap_or(0))
                    {
                        let vram_bytes = best_gpu.AdapterRAM.unwrap_or(0);

                        gpu_stats = Some(GpuStats {
                            usage: 0,       // Not available via standard WMI
                            memory_used: 0, // Not available
                            memory_total: vram_bytes,
                            temp: 0, // Not available
                            name: best_gpu.Name.clone(),
                        });

                        vram_stats = Some(VramStats {
                            percent: 0.0,
                            used_gb: 0.0,
                            total_gb: bytes_to_gb(vram_bytes as f64),
                        });
                    }
                }
            }
        }
    }

    let total_disk_speed_mb = (read_rate + write_rate) / (1024.0 * 1024.0);
    let disk_activity_percent = if total_disk_speed_mb > 0.0 {
        ((total_disk_speed_mb / 500.0) * 100.0).min(100.0) as f32
    } else {
        0.0
    };

    let total_net_speed_mb = (download_rate + upload_rate) / (1024.0 * 1024.0);
    let net_activity_percent = if total_net_speed_mb > 0.0 {
        ((total_net_speed_mb / 100.0) * 100.0).min(100.0) as f32
    } else {
        0.0
    };

    SystemStats {
        cpu: CpuStats {
            percent: cpu_percent,
            cores: cpu_cores,
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
            read_rate,
            write_rate,
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
            download_rate,
            upload_rate,
            total_received: total_recv,
            total_sent,
            utilization: 0.0,
            activity_percent: net_activity_percent,
        },
        pid: std::process::id(),
    }
}

static MONITORING_ACTIVE: AtomicBool = AtomicBool::new(false);
static MONITORING_PAUSED: AtomicBool = AtomicBool::new(false);

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
    if paused && let Ok(mut monitor) = MONITOR.lock() {
        monitor.drop_resources();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
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
