import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ISystemStats, StatsCallback } from '../types/monitoringTypes';

type MonitoringLogger = Pick<LoggerService, 'info' | 'debug' | 'error' | 'warn'>;

const FALLBACK_MONITORING_POLL_INTERVAL_MS = 2000;

export class MonitoringService {
    private isListening = false;
    private unlistenFn: (() => void) | null = null;
    private pollingTimeout: ReturnType<typeof setTimeout> | null = null;
    private listeners: StatsCallback[] = [];

    constructor(
        private readonly _tauri: TauriProvider,
        private readonly _tracer: MonitoringLogger,
    ) {}

    /**
     * Starts listening to system stats or falls back to bridge polling.
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
                this._tracer.info('[MonitoringService] Started listening to system_stats');

                // Fetch cached stats immediately so UI doesn't flash empty
                // (the Rust loop sleeps 1s before the first emit)
                try {
                    const cached = await this._tauri.invoke<ISystemStats>('get_system_stats');
                    this.notifyListeners(cached);
                } catch {
                    this._tracer.debug('[MonitoringService] Initial stats fetch skipped');
                }
            } catch (e) {
                this._tracer.error('[MonitoringService] Failed to listen to events:', e);
                this.startFallback();
            }
        } else {
            this._tracer.info('[MonitoringService] Event transport unavailable, starting polling');
            this.startFallback();
        }
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
        if (this.pollingTimeout !== null) {
            globalThis.clearTimeout(this.pollingTimeout);
            this.pollingTimeout = null;
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
                this._tracer.error('[MonitoringService] Listener error:', err);
            }
        });
    }

    private startFallback(): void {
        if (this.pollingTimeout !== null) {
            return;
        }

        const poll = (): void => {
            this.pollingTimeout = globalThis.setTimeout(() => {
                void this._pollFallbackStats().finally(() => {
                    this.pollingTimeout = null;
                    if (this.isListening) {
                        poll();
                    }
                });
            }, FALLBACK_MONITORING_POLL_INTERVAL_MS);
        };

        poll();
    }

    private async _pollFallbackStats(): Promise<void> {
        try {
            const stats = await this._tauri.invoke<ISystemStats>('get_system_stats');
            this.notifyListeners(stats);
        } catch (e) {
            this._tracer.warn('[MonitoringService] Poll failed', e);
        }
    }
}
