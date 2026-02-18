use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, System};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::domain::monitoring::gpu_collector::GpuCollector;
use crate::models::system::{CpuStats, DiskStats, NetworkStats, RamStats, SystemStats};

static IS_PAUSED: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));
static INTERVAL_MS: LazyLock<AtomicU64> = LazyLock::new(|| AtomicU64::new(1000));
static LATEST_STATS: LazyLock<RwLock<SystemStats>> =
    LazyLock::new(|| RwLock::new(SystemStats::default()));
static MONITOR_HANDLE: LazyLock<RwLock<Option<tauri::async_runtime::JoinHandle<()>>>> =
    LazyLock::new(|| RwLock::new(None));

/// High-level system monitor that coordinates all metrics collection
#[derive(Debug)]
pub struct SystemMonitor {
    system: SystemWrap,
    gpu: GpuCollector,
    last_update: Instant,
    last_process_update: Instant,

    // Cached rates for delta calculation
    last_net_recv: u64,
    last_net_sent: u64,
    cached_down_rate: f64,
    cached_up_rate: f64,

    // Disk I/O (Delta Fix)
    last_disk_update: Instant,
    last_disk_read_total: u64,
    last_disk_write_total: u64,
    cached_read_rate: f64,
    cached_write_rate: f64,

    // Performance Peaks (Adaptive with Decay)
    max_disk_speed_mb: f64,
    max_net_speed_mb: f64,

    // Smoothing & Peaks
    gpu_load_ema: f32,
    max_vram_used_gb: f32,
}

#[derive(Debug)]
struct SystemWrap {
    sys: System,
    disks: Disks,
    networks: Networks,
}

impl SystemWrap {
    fn new() -> Self {
        Self {
            sys: System::new_all(),
            disks: Disks::new_with_refreshed_list(),
            networks: Networks::new_with_refreshed_list(),
        }
    }

    fn refresh_networks(&mut self) {
        self.networks.refresh(false);
    }

    fn refresh_cpu_memory(&mut self) {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
    }

    fn refresh_disks(&mut self) {
        self.disks.refresh(false);
    }

    fn refresh_all(&mut self) {
        self.networks.refresh(true);
        self.disks.refresh(true);
        self.refresh_cpu_memory();
    }

    fn get_disk_io(&self) -> (u64, u64) {
        let mut read: u64 = 0;
        let mut write: u64 = 0;
        for disk in &self.disks {
            let usage = disk.usage();
            read += usage.total_read_bytes;
            write += usage.total_written_bytes;
        }
        (read, write)
    }
}

/// Starts the background monitoring task
pub fn start_monitoring(app: AppHandle, interval_ms: u64) {
    INTERVAL_MS.store(interval_ms, Ordering::Relaxed);

    // Ensure only one monitor is running
    stop_monitoring();

    let handle = tauri::async_runtime::spawn(async move {
        let mut monitor = SystemMonitor::new();
        monitor.system.refresh_all();

        // Initial stats for immediate availability
        let stats = monitor.collect_stats();
        if let Ok(mut cache) = LATEST_STATS.try_write() {
            *cache = stats;
        }

        loop {
            let current_interval = INTERVAL_MS.load(Ordering::Relaxed);
            tokio::time::sleep(Duration::from_millis(current_interval)).await;

            if IS_PAUSED.load(Ordering::Relaxed) {
                continue;
            }

            // Expert: sysinfo collection is efficient enough to run directly in the task
            // without spawn_blocking if interval is >= 500ms and we don't hold global locks.
            let stats = monitor.collect_stats();

            // Broadcast stats
            {
                let mut cache = LATEST_STATS.write().await;
                *cache = stats.clone();
            }
            let _ = app.emit("system_stats", stats);
        }
    });

    // Store handle asynchronously for management
    tauri::async_runtime::spawn(async move {
        let mut h = MONITOR_HANDLE.write().await;
        *h = Some(handle);
    });
}

/// Stops the background monitoring task
pub fn stop_monitoring() {
    tauri::async_runtime::spawn(async {
        let mut h = MONITOR_HANDLE.write().await;
        if let Some(handle) = h.take() {
            handle.abort();
        }
    });
}

/// Update interval at runtime
pub fn set_interval(ms: u64) {
    INTERVAL_MS.store(ms, Ordering::Relaxed);
}

/// Pauses or resumes monitoring
pub fn set_paused(paused: bool) {
    IS_PAUSED.store(paused, Ordering::Relaxed);
}

/// Retrieves the current system statistics (cached)
pub async fn get_stats() -> SystemStats {
    LATEST_STATS.read().await.clone()
}

impl Default for SystemMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemMonitor {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            system: SystemWrap::new(),
            gpu: GpuCollector::new(),
            last_update: now,
            last_process_update: now,
            last_net_recv: 0,
            last_net_sent: 0,
            cached_down_rate: 0.0,
            cached_up_rate: 0.0,

            last_disk_update: now,
            last_disk_read_total: 0,
            last_disk_write_total: 0,
            cached_read_rate: 0.0,
            cached_write_rate: 0.0,

            max_disk_speed_mb: 10.0,
            max_net_speed_mb: 1.0,

            gpu_load_ema: 0.0,
            max_vram_used_gb: 0.0,
        }
    }

    fn collect_stats(&mut self) -> SystemStats {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_update).as_secs_f64();

        // 1. Refresh Data
        self.system.refresh_networks();
        self.system.refresh_cpu_memory();
        self.system.refresh_disks();

        // 2. CPU Stats & Resource Usage
        // PID of this process
        let current_pid = sysinfo::Pid::from_u32(std::process::id());

        // Only refresh process-specifics periodically to save CPU
        if now.duration_since(self.last_process_update) >= Duration::from_secs(2) {
            self.system.sys.refresh_processes_specifics(
                sysinfo::ProcessesToUpdate::Some(&[current_pid]),
                true,
                sysinfo::ProcessRefreshKind::nothing()
                    .with_cpu()
                    .with_memory(),
            );
            self.last_process_update = now;
        }

        let (cpu_percent, cpu_cores, cpu_name, app_cpu, app_memory) = {
            let percent = self.system.sys.global_cpu_usage();
            let cores = self.system.sys.cpus().len();
            let name = self
                .system
                .sys
                .cpus()
                .first()
                .map_or_else(|| "Unknown".to_string(), |c| c.brand().to_string());

            let (p_cpu, p_mem) = self
                .system
                .sys
                .process(current_pid)
                .map_or((0.0, 0), |p| (p.cpu_usage(), p.memory()));

            (percent, cores, name, p_cpu, p_mem)
        };

        // 3. RAM Stats
        let total_memory = self.system.sys.total_memory() as f64;
        let avail = self.system.sys.available_memory() as f64;
        let used_memory = total_memory - avail;
        let ram_percent = if total_memory > 0.0 {
            ((used_memory / total_memory) * 100.0) as f32
        } else {
            0.0
        };

        // 4. Network Rates
        let mut total_recv: u64 = 0;
        let mut total_sent: u64 = 0;
        for (_, data) in &self.system.networks {
            total_recv += data.total_received();
            total_sent += data.total_transmitted();
        }

        if self.last_net_recv > 0 && elapsed > 0.0 {
            self.cached_down_rate =
                (total_recv.saturating_sub(self.last_net_recv) as f64) / elapsed;
            self.cached_up_rate = (total_sent.saturating_sub(self.last_net_sent) as f64) / elapsed;
        }
        self.last_net_recv = total_recv;
        self.last_net_sent = total_sent;

        // 5. Disk I/O (Delta Fix)
        if self.last_disk_update.elapsed() >= Duration::from_millis(500) {
            let (total_read, total_write) = self.system.get_disk_io();
            let disk_elapsed = self.last_disk_update.elapsed().as_secs_f64();

            if self.last_disk_read_total > 0 && disk_elapsed > 0.0 {
                self.cached_read_rate =
                    (total_read.saturating_sub(self.last_disk_read_total)) as f64 / disk_elapsed;
                self.cached_write_rate =
                    (total_write.saturating_sub(self.last_disk_write_total)) as f64 / disk_elapsed;
            }

            self.last_disk_read_total = total_read;
            self.last_disk_write_total = total_write;
            self.last_disk_update = now;
        }

        // 6. Disk Space
        let mut total_disk_space: u64 = 0;
        let mut total_disk_used: u64 = 0;
        for disk in &self.system.disks {
            total_disk_space += disk.total_space();
            total_disk_used += disk.total_space().saturating_sub(disk.available_space());
        }

        // 7. GPU Stats
        let (gpu_stats, vram_stats) = self.gpu.collect();

        let mut gpu_stats_final = gpu_stats;
        if let Some(gpu) = &mut gpu_stats_final {
            let usage_f32 = gpu.usage as f32;
            self.gpu_load_ema = self.gpu_load_ema.mul_add(0.7, usage_f32 * 0.3);
            gpu.usage = self.gpu_load_ema.round() as u32;
        }

        if let Some(vram) = vram_stats
            .as_ref()
            .filter(|v| v.used_gb > self.max_vram_used_gb)
        {
            self.max_vram_used_gb = vram.used_gb;
        }

        // 8. Adaptive Peaks with Decay
        self.max_disk_speed_mb *= 0.995; // 0.5% decay per tick
        self.max_net_speed_mb *= 0.995;

        // Floors to avoid divide-by-zero or overly sensitive percentages
        self.max_disk_speed_mb = self.max_disk_speed_mb.max(1.0);
        self.max_net_speed_mb = self.max_net_speed_mb.max(0.1);

        let total_disk_speed_mb =
            (self.cached_read_rate + self.cached_write_rate) / (1024.0 * 1024.0);
        if total_disk_speed_mb > self.max_disk_speed_mb {
            self.max_disk_speed_mb = total_disk_speed_mb;
        }

        let total_net_speed_mb = (self.cached_down_rate + self.cached_up_rate) / (1024.0 * 1024.0);
        if total_net_speed_mb > self.max_net_speed_mb {
            self.max_net_speed_mb = total_net_speed_mb;
        }

        let disk_activity_percent =
            ((total_disk_speed_mb / self.max_disk_speed_mb) * 100.0).min(100.0) as f32;
        let net_activity_percent =
            ((total_net_speed_mb / self.max_net_speed_mb) * 100.0).min(100.0) as f32;

        self.last_update = now;
        let bytes_to_gb = |b: f64| (b / 1_073_741_824.0) as f32;

        SystemStats {
            cpu: CpuStats {
                percent: cpu_percent,
                cores: u32::try_from(cpu_cores).unwrap_or(0),
                name: cpu_name,
            },
            ram: RamStats {
                percent: ram_percent,
                used_gb: bytes_to_gb(used_memory),
                total_gb: bytes_to_gb(total_memory),
                available_gb: bytes_to_gb(avail),
            },
            gpu: gpu_stats_final,
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
            app_cpu,
            app_memory: app_memory as f64,
        }
    }
}
