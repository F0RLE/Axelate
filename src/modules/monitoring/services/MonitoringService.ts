import { type TauriProvider } from '../../core/services/TauriProvider';
import { logger } from '../../core/services/LoggerService';
import type { ISystemStats, StatsCallback } from '../types/monitoringTypes';

interface IMonitoringGlobal {
    __TAURI__?: {
        event: {
            listen: (
                event: string,
                handler: (e: { payload: unknown }) => void,
            ) => Promise<() => void>;
        };
    };
    clearInterval: (id: unknown) => void;
    setInterval: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export class MonitoringService {
    private isListening = false;
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
                logger.info('[MonitoringService] Started listening to system_stats');
            } catch (e) {
                logger.error('[MonitoringService] Failed to listen to events:', e);
                this.startFallback();
            }

            // Optimization: Pause backend monitoring when window is hidden
            this._bindVisibilityHandler();
        } else {
            logger.info('[MonitoringService] Non-Tauri environment, starting fallback polling');
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
                    logger.debug(`[MonitoringService] Backend paused: ${String(isHidden)}`);
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
                logger.error('[MonitoringService] Listener error:', err);
            }
        });
    }

    private startFallback() {
        if (this.pollingInterval) return;

        const g = globalThis as IMonitoringGlobal;
        this.pollingInterval = g.setInterval(() => {
            void (async () => {
                try {
                    const res = await fetch('/api/stats');
                    if (res.ok) {
                        const stats = (await res.json()) as ISystemStats;
                        this.notifyListeners(stats);
                        return;
                    }
                } catch (e) {
                    logger.warn('[MonitoringService] Poll failed', e);
                }
                // Fallback to mock removed for quality assurance
            })();
        }, 1000);
    }
}
