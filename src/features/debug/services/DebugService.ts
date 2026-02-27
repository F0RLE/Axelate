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
                // Fallback to fetch for dev/browser
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

        // Filter out bot-communication errors and known noisy Gemini errors
        const filteredLogs = newLogs.filter((log) => {
            const msg = (log.message || '').toUpperCase();
            const src = (log.source || '').toUpperCase();

            // 1. Check for specific bot/ai service sources
            const isBotSource =
                src.includes('CHATSERVICE') ||
                src.includes('AIBRIDGE') ||
                src.includes('AI_SERVICE');

            // 2. Check for common Gemini/AI error patterns and HTTP codes
            const isAIError =
                msg.includes('GEMINI_ERROR') ||
                msg.includes('ERROR 429') ||
                msg.includes('ERROR 400') ||
                msg.includes('ERROR 403') ||
                msg.includes('ERROR 500') ||
                msg.includes('QUOTA') ||
                msg.includes('PERMISSION_DENIED') ||
                msg.includes('INVALID_ARGUMENT') ||
                msg.includes('DEADLINE_EXCEEDED') ||
                msg.includes('FAILED_PRECONDITION') ||
                msg.includes('UNAVAILABLE') ||
                msg.includes('INTERNAL_ERROR');

            return !(isBotSource || isAIError);
        });

        if (filteredLogs.length === 0) return [];

        this.logs.push(...filteredLogs);
        this.lastTimestamp = newLogs.at(-1)?.timestamp ?? this.lastTimestamp;

        // Keep last 1000 logs
        if (this.logs.length > 2000) {
            this.logs = this.logs.slice(-1000);
        }
        return filteredLogs;
    }

    private safeJsonParse<T>(text: string, defaultValue: T): T {
        try {
            return text ? (JSON.parse(text) as T) : defaultValue;
        } catch {
            return defaultValue;
        }
    }
}
