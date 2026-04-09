import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IBridge } from '@/shared/types/IBridge';

export interface ILogEntry {
    timestamp: number;
    source: string;
    level: string;
    message: string;
}

export class DebugService {
    private logs: ILogEntry[] = [];
    private lastTimestamp = 0;

    constructor(private readonly bridge: IBridge) {}

    public async fetchLogs(): Promise<ILogEntry[]> {
        try {
            if (this.bridge.isTauri()) {
                const logs = await this.bridge.invoke<ILogEntry[]>('get_logs', {
                    since: this.lastTimestamp,
                });
                return this.processLogs(logs);
            } else {
                // Browser fallback uses the same filtered backend contract as Tauri.
                const res = await fetch(`/api/logs?since=${this.lastTimestamp.toString()}`);
                if (!res.ok) throw new Error('Fetch failed');
                const text = await res.text();
                const logs = this.safeJsonParse(text, []);
                return this.processLogs(logs);
            }
        } catch (e) {
            tracer.error('[DebugService] Fetch logs failed:', e);
            return [];
        }
    }

    public async clearLogs(): Promise<boolean> {
        this.logs = [];
        this.lastTimestamp = 0;
        try {
            if (this.bridge.isTauri()) {
                await this.bridge.invoke('clear_logs');
            } else {
                await fetch('/api/logs/clear', { method: 'POST' });
            }
            return true;
        } catch (e) {
            tracer.error('[DebugService] Clear logs failed:', e);
            return false;
        }
    }

    public getLogs(): ILogEntry[] {
        return this.logs;
    }

    private processLogs(newLogs: ILogEntry[]): ILogEntry[] {
        if (!Array.isArray(newLogs) || newLogs.length === 0) return [];
        this.logs.push(...newLogs);
        this.lastTimestamp = newLogs.at(-1)?.timestamp ?? this.lastTimestamp;

        // Keep last 1000 logs
        if (this.logs.length > 2000) {
            this.logs = this.logs.slice(-1000);
        }
        return newLogs;
    }

    private safeJsonParse<T>(text: string, defaultValue: T): T {
        try {
            return text ? (JSON.parse(text) as T) : defaultValue;
        } catch {
            return defaultValue;
        }
    }
}
