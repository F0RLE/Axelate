import { TauriProvider } from '../../core/services/TauriProvider';
import { ISystemStats, StatsCallback } from '../types/monitoringTypes';

interface IMonitoringGlobal {
    __TAURI__?: {
        event: {
            listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
        };
    };
    clearInterval: (id: unknown) => void;
    setInterval: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export class MonitoringService {
    private isListening: boolean = false;
    private unlistenFn: (() => void) | null = null;
    private pollingInterval: ReturnType<typeof setTimeout> | null = null;
    private listeners: StatsCallback[] = [];

    constructor(private readonly _tauri: TauriProvider) {}

    /**
     * Starts listening to system stats from Tauri or starts fallback polling.
     */
    public async startMonitoring(): Promise<void> {
        if (this.isListening) return;
        this.isListening = true;

        if (this._tauri.isTauri()) {
            try {
                this.unlistenFn = await this._tauri.listen<ISystemStats>(
                    'system_stats',
                    (payload) => {
                        this.notifyListeners(payload);
                    },
                );
                console.log('[MonitoringService] Started listening to system_stats');
            } catch (e) {
                console.error('[MonitoringService] Failed to listen to events:', e);
                this.startFallback();
            }

            // Optimization: Pause backend monitoring when window is hidden
            this._bindVisibilityHandler();
        } else {
            console.log('[MonitoringService] Non-Tauri environment, starting fallback polling');
            this.startFallback();
        }
    }

    /**
     * Binds visibility change events to pause/resume backend monitoring.
     */
    private _bindVisibilityHandler(): void {
        document.addEventListener('visibilitychange', () => {
            if (this._tauri.isTauri()) {
                const isHidden = document.hidden;
                // Fire and forget
                void this._tauri.invoke('set_monitoring_paused', { paused: isHidden });
                if (import.meta.env.DEV) {
                    console.debug(`[MonitoringService] Backend paused: ${isHidden}`);
                }
            }
        });
    }

    /**
     * Stops monitoring and cleans up listeners and intervals.
     */
    public stopMonitoring(): void {
        this.isListening = false;
        if (this.unlistenFn) {
            this.unlistenFn(); // In Tauri v2 this is usually synchronous disposer
            this.unlistenFn = null;
        }
        if (this.pollingInterval) {
            const g = globalThis as unknown as IMonitoringGlobal;
            if (typeof g.clearInterval === 'function') {
                g.clearInterval(this.pollingInterval);
            }
            this.pollingInterval = null;
        }
    }

    /**
     * Complete lifecycle cleanup.
     */
    public destroy(): void {
        this.stopMonitoring();
        this.listeners = [];
    }

    public subscribe(callback: StatsCallback): void {
        if (!this.listeners.includes(callback)) {
            this.listeners.push(callback);
        }
    }

    public unsubscribe(callback: StatsCallback): void {
        this.listeners = this.listeners.filter((cb) => cb !== callback);
    }

    private notifyListeners(stats: ISystemStats): void {
        this.listeners.forEach((cb) => {
            try {
                cb(stats);
            } catch (err) {
                console.error('[MonitoringService] Listener error:', err);
            }
        });
    }

    private startFallback() {
        if (this.pollingInterval) return;

        const g = globalThis as IMonitoringGlobal;
        this.pollingInterval = g.setInterval(async () => {
            try {
                const res = await fetch('/api/stats');
                if (res.ok) {
                    const stats = await res.json();
                    this.notifyListeners(stats);
                    return;
                }
            } catch (e) {
                console.warn('[MonitoringService] Poll failed', e);
            }
            // Fallback to mock ONLY if poll failed
            const mockStats: ISystemStats = {
                cpu: { percent: this.random() * 30 + 10, cores: 8, name: 'Mock CPU' },
                ram: { used_gb: 8, total_gb: 32, percent: 25, available_gb: 24 },
                gpu: {
                    usage: this.random() * 50,
                    temp: 45,
                    memory_used: 4,
                    memory_total: 8,
                    name: 'Mock GPU',
                },
                vram: { percent: 50, used_gb: 4, total_gb: 8 },
                disk: {
                    used_gb: 500,
                    total_gb: 1000,
                    utilization: 50,
                    read_rate: 1024,
                    write_rate: 2048,
                    activity_percent: 10,
                },
                network: {
                    upload_rate: this.random() * 5 * 1024 * 1024,
                    download_rate: this.random() * 20 * 1024 * 1024,
                    total_received: 0,
                    total_sent: 0,
                    utilization: 0,
                    activity_percent: 5,
                },
                pid: 1234,
            };
            this.notifyListeners(mockStats);
        }, 1000);
    }

    private random(): number {
        const buffer = new Uint32Array(1);
        crypto.getRandomValues(buffer);
        return (buffer[0] ?? 0) / (0xffffffff + 1);
    }
}
