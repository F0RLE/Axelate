import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IBridge } from '@/shared/types/IBridge';

export interface ILogEntry {
    timestamp: number;
    source: string;
    level: string;
    message: string;
}

export class ConsoleLogService {
    private logs: ILogEntry[] = [];
    private lastTimestamp = 0;
    private static readonly _NOISE_PATTERNS = [
        /\[AIBridge\] Stream chunk received/i,
        /\[AIBridge\] Thought chunk received/i,
    ];

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
            tracer.error('[ConsoleLogService] Fetch logs failed:', e);
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
            tracer.error('[ConsoleLogService] Clear logs failed:', e);
            return false;
        }
    }

    public getLogs(): ILogEntry[] {
        return this.logs;
    }

    private processLogs(newLogs: ILogEntry[]): ILogEntry[] {
        if (!Array.isArray(newLogs) || newLogs.length === 0) return [];
        this.lastTimestamp = newLogs.at(-1)?.timestamp ?? this.lastTimestamp;

        const visibleLogs = newLogs.filter((entry) => !this._isNoise(entry));
        if (visibleLogs.length === 0) return [];

        this.logs.push(...visibleLogs);

        // Keep last 1000 logs
        if (this.logs.length > 2000) {
            this.logs = this.logs.slice(-1000);
        }
        return visibleLogs;
    }

    private safeJsonParse<T>(text: string, defaultValue: T): T {
        try {
            return text ? (JSON.parse(text) as T) : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    private _isNoise(entry: ILogEntry): boolean {
        return ConsoleLogService._NOISE_PATTERNS.some((pattern) => pattern.test(entry.message));
    }
}
