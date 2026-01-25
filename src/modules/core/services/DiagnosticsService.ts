
/**
 * @module core/services/DiagnosticsService
 * @description Service for monitoring system resource utilization (CPU, RAM, GPU, etc.)
 */

import { TauriProvider } from '../services/TauriProvider';
import { I18nService } from '../services/I18nService';

/**
 * System resource utilization statistics.
 */
interface ISystemStats {
    cpu?: { percent: number };
    ram?: { percent: number; used_gb: number; total_gb: number };
    gpu?: { utilization: number; usage?: number; memory_used_gb?: number; memory_total_gb?: number; detected?: boolean };
    vram?: { used_gb: number; total_gb: number };
    disk?: { read_rate: number; write_rate: number; activity_percent: number };
    network?: { download_rate: number; upload_rate: number };
}

export class DiagnosticsService {
    private _pollInterval: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly _tauri: TauriProvider, private readonly _i18n: I18nService) {}

    /**
     * Starts polling system statistics at regular intervals.
     */
    public startPolling(intervalMs: number = 5000) {
        this.update().catch(err => console.error('[DiagnosticsService] Initial update failed:', err));
        this._pollInterval = setInterval(() => {
            this.update().catch(console.error);
        }, intervalMs);
    }

    /**
     * Stops the statistics polling interval.
     */
    public stopPolling() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }


    /**
     * Fetches current system statistics from host or mock data.
     */
    public async update() {
        try {
            let data: ISystemStats = {};
            if (this._tauri.isTauri()) {
                try {
                    // Try to invoke native command first if available
                    data = await this._tauri.invoke<ISystemStats>('get_system_stats');
                } catch {
                    // Fallback to fetch if invoke not implemented/fails
                    const res = await fetch('/api/state');
                    data = await res.json();
                }
            } else {
                // Mock data
                data = {
                    cpu: { percent: 15 },
                    ram: { percent: 45, used_gb: 7.2, total_gb: 16 },
                    gpu: { utilization: 20, memory_used_gb: 1.5, memory_total_gb: 8, detected: true },
                    disk: { read_rate: 1024 * 1024, write_rate: 0, activity_percent: 5 },
                    network: { download_rate: 512 * 1024, upload_rate: 0 },
                };
            }

            // Returning data for potential other uses, but no longer updating UI directly here
            return data;
        } catch (err) {
            console.error('[DiagnosticsService] Update failed:', err);
            return {};
        }
    }
}
