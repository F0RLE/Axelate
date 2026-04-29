import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { invokeSafe } from '@/shared/api/invoke';
import type { IBridge } from '@/shared/types/IBridge';
import { ConsoleLogNormalizer } from './ConsoleLogNormalizer';

export interface ILogEntry {
    timestamp: number;
    source: string;
    level: string;
    message: string;
    module_id?: string | null;
    display_time?: string | null;
    normalized_level?: string | null;
    scope?: string | null;
    summary_message?: string | null;
    source_label?: string | null;
    source_class?: string | null;
    page?: string | null;
    action?: string | null;
    expected?: string | null;
}

export interface IConsoleLogView {
    id: string;
    label: string;
}

export type ConsoleRuntimeStatus = 'running' | 'starting' | 'failed' | 'stopped';

export interface IConsoleStatusItem {
    id: string;
    label: string;
    kind: 'engine' | 'module';
    status: ConsoleRuntimeStatus;
    detail: string;
}

type ConsoleOverviewPayload = {
    views: IConsoleLogView[];
    status_items: Array<{
        id: string;
        label: string;
        kind: string;
        status: string;
        detail: string;
    }>;
};

type ConsoleLogServiceLogger = Pick<LoggerService, 'warn' | 'error'>;

export class ConsoleLogService {
    private static readonly _MAX_LOG_COUNT_PER_VIEW = 1200;

    private readonly _logsByView = new Map<string, ILogEntry[]>();
    private readonly _lastTimestampByView = new Map<string, number>();
    private readonly _modulePathCache = new Map<string, string | null>();
    private readonly _normalizer = new ConsoleLogNormalizer();

    constructor(
        private readonly bridge: IBridge,
        private readonly _tracer: ConsoleLogServiceLogger,
    ) {}

    public init(): Promise<void> {
        return Promise.resolve();
    }

    public destroy(): void {
        this._logsByView.clear();
        this._lastTimestampByView.clear();
    }

    public async fetchLogs(viewId = 'general'): Promise<ILogEntry[]> {
        const normalizedViewId = this._canonicalViewId(viewId);
        const since = this._lastTimestampByView.get(normalizedViewId) ?? 0;

        try {
            const logs = await this._fetchTauriLogs(normalizedViewId, since);
            return this._appendLogs(normalizedViewId, logs);
        } catch (error) {
            this._tracer.error('[ConsoleLogService] Fetch logs failed:', error);
            return [];
        }
    }

    public async clearLogs(viewId = 'general'): Promise<boolean> {
        const normalizedViewId = this._canonicalViewId(viewId);

        try {
            await this.bridge.invoke('clear_console_logs', { viewId: normalizedViewId });
            this._logsByView.set(normalizedViewId, []);
            this._lastTimestampByView.set(normalizedViewId, 0);
            return true;
        } catch (error) {
            this._tracer.error('[ConsoleLogService] Clear logs failed:', error);
            return false;
        }
    }

    public async clearAllLogs(): Promise<boolean> {
        try {
            await this.bridge.invoke('clear_logs');
            this._logsByView.clear();
            this._lastTimestampByView.clear();
            return true;
        } catch (error) {
            this._tracer.error('[ConsoleLogService] Clear all logs failed:', error);
            return false;
        }
    }

    public getLogs(): ILogEntry[] {
        return [...this._logsByView.values()].flat();
    }

    public getLogsForView(viewId: string): ILogEntry[] {
        return [...(this._logsByView.get(this._canonicalViewId(viewId)) ?? [])];
    }

    public async getAvailableViews(): Promise<IConsoleLogView[]> {
        if (!this.bridge.isTauri()) {
            return [{ id: 'general', label: 'Platform' }];
        }

        try {
            const result = await invokeSafe<ConsoleOverviewPayload>('get_console_overview');
            if (result.status === 'ok') {
                return this._normalizeViews(result.data.views);
            }
        } catch (error) {
            this._tracer.warn(
                `[ConsoleLogService] Failed to resolve console views: ${String(error)}`,
            );
        }

        return [{ id: 'general', label: 'Platform' }];
    }

    public async getStatusItems(): Promise<IConsoleStatusItem[]> {
        if (!this.bridge.isTauri()) {
            return [];
        }

        try {
            const result = await invokeSafe<ConsoleOverviewPayload>('get_console_overview');
            if (result.status === 'ok') {
                return result.data.status_items.map((item) => ({
                    id: this._canonicalViewId(item.id),
                    label: item.label,
                    kind: item.kind === 'module' ? 'module' : 'engine',
                    status: this._toRuntimeStatus(item.status),
                    detail: item.detail,
                }));
            }
        } catch (error) {
            this._tracer.warn(
                `[ConsoleLogService] Failed to resolve runtime status: ${String(error)}`,
            );
        }

        return [];
    }

    public async getModulePath(moduleId: string): Promise<string | null> {
        const cached = this._modulePathCache.get(moduleId);
        if (cached !== undefined) {
            return cached;
        }

        if (!this.bridge.isTauri()) {
            this._modulePathCache.set(moduleId, null);
            return null;
        }

        try {
            const path = await this.bridge.invoke<string>('get_module_path', { moduleId });
            this._modulePathCache.set(moduleId, path);
            return path;
        } catch (error) {
            this._tracer.warn(
                `[ConsoleLogService] Failed to resolve module path for ${moduleId}: ${String(error)}`,
            );
            this._modulePathCache.set(moduleId, null);
            return null;
        }
    }

    public async openModuleFolder(moduleId: string): Promise<boolean> {
        const path = await this.getModulePath(moduleId);
        if (path === null || path.trim() === '') {
            return false;
        }

        try {
            await this.bridge.invoke('plugin:shell|open', { path });
            return true;
        } catch (error) {
            this._tracer.error(
                `[ConsoleLogService] Failed to open module folder for ${moduleId}: ${String(error)}`,
            );
            return false;
        }
    }

    public async openLogsFolder(viewId = 'general'): Promise<boolean> {
        if (!this.bridge.isTauri()) {
            return false;
        }

        try {
            await this.bridge.invoke('open_console_log_target', {
                viewId: this._canonicalViewId(viewId),
            });
            return true;
        } catch (error) {
            this._tracer.error(`[ConsoleLogService] Failed to open logs folder: ${String(error)}`);
            return false;
        }
    }

    private async _fetchTauriLogs(viewId: string, since: number): Promise<ILogEntry[]> {
        if (!this.bridge.isTauri()) {
            return await this.bridge.invoke<ILogEntry[]>('get_logs', { since });
        }

        return await this.bridge.invoke<ILogEntry[]>('get_console_logs', { viewId, since });
    }

    private _appendLogs(viewId: string, newLogs: ILogEntry[]): ILogEntry[] {
        if (!Array.isArray(newLogs) || newLogs.length === 0) {
            return [];
        }

        const normalizedLogs = newLogs.map((entry) => this._normalizer.normalize(entry));
        const previousLogs = this._logsByView.get(viewId) ?? [];
        const existingKeys = new Set(previousLogs.map((entry) => this._dedupeKey(entry)));
        const appendedLogs = normalizedLogs.filter((entry) => {
            const key = this._dedupeKey(entry);
            if (existingKeys.has(key)) {
                return false;
            }
            existingKeys.add(key);
            return true;
        });

        if (appendedLogs.length === 0) {
            this._lastTimestampByView.set(
                viewId,
                newLogs.at(-1)?.timestamp ?? this._lastTimestampByView.get(viewId) ?? 0,
            );
            return [];
        }

        const nextLogs = [...previousLogs, ...appendedLogs].slice(
            -ConsoleLogService._MAX_LOG_COUNT_PER_VIEW,
        );
        this._logsByView.set(viewId, nextLogs);
        this._lastTimestampByView.set(
            viewId,
            newLogs.at(-1)?.timestamp ?? this._lastTimestampByView.get(viewId) ?? 0,
        );
        return appendedLogs;
    }

    private _normalizeViews(views: readonly IConsoleLogView[]): IConsoleLogView[] {
        const byId = new Map<string, IConsoleLogView>();
        for (const view of views) {
            const id = this._canonicalViewId(view.id);
            if (id === '') {
                continue;
            }
            byId.set(id, { ...view, id });
        }
        return [...byId.values()];
    }

    private _canonicalViewId(viewId: string): string {
        const trimmed = viewId.trim();
        const engineView = trimmed.match(/^engine:(.+)$/);
        if (engineView !== null) {
            return `engine:${this._canonicalEngineId(engineView[1] ?? '')}`;
        }
        return trimmed;
    }

    private _canonicalEngineId(engineId: string): string {
        const key = engineId
            .trim()
            .toLowerCase()
            .replaceAll(/[\s_]+/gu, '-');
        switch (key) {
            case 'stable-diffusion':
            case 'stable-diffusion.cpp':
            case 'stable-diffusion-cpp':
            case 'stable.diffusion.cpp':
                return 'sdcpp';
            default:
                return engineId.trim();
        }
    }

    private _dedupeKey(entry: ILogEntry): string {
        return [
            entry.timestamp,
            entry.source,
            entry.module_id ?? '',
            entry.normalized_level ?? entry.level,
            entry.message,
        ].join('\u0000');
    }

    private _toRuntimeStatus(status: string): ConsoleRuntimeStatus {
        switch (status) {
            case 'running':
            case 'starting':
            case 'failed':
            case 'stopped':
                return status;
            default:
                return 'failed';
        }
    }
}
