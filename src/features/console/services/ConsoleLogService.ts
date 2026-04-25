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

type EngineEventPayloadMap = {
    'ai:engine:log': { engine_id: string; line: string };
    'ai:engine:starting': { engine_id: string };
    'ai:engine:ready': { engine_id: string; endpoint: string };
    'ai:engine:error': { engine_id: string; message: string };
};

type EngineEventName = keyof EngineEventPayloadMap;
type ConsoleLogServiceLogger = Pick<LoggerService, 'warn' | 'error'>;

export class ConsoleLogService {
    private static readonly _MAX_LOG_COUNT = 1000;
    private static readonly _TRIM_THRESHOLD = 2000;
    private static readonly _NOISE_PATTERNS = [
        /\[AIBridge\] Stream chunk received/i,
        /\[AIBridge\] Thought chunk received/i,
    ];

    private logs: ILogEntry[] = [];
    private lastTimestamp = 0;
    private readonly _engineUnlisteners: Array<() => void> = [];
    private readonly _modulePathCache = new Map<string, string | null>();
    private readonly _knownEngineIds = new Set<string>();
    private readonly _knownModuleIds = new Set<string>();
    private readonly _normalizer = new ConsoleLogNormalizer();
    private _initialized = false;

    constructor(
        private readonly bridge: IBridge,
        private readonly _tracer: ConsoleLogServiceLogger,
    ) {}

    public async init(): Promise<void> {
        if (this._initialized || !this.bridge.isTauri()) {
            return;
        }

        this._initialized = true;
        await this._registerEngineListeners();
    }

    public destroy(): void {
        this._engineUnlisteners.splice(0).forEach((unlisten) => {
            unlisten();
        });
        this._initialized = false;
    }

    public async fetchLogs(): Promise<ILogEntry[]> {
        try {
            const logs = await this._fetchTauriLogs();
            return this._processLogs(logs);
        } catch (error) {
            this._tracer.error('[ConsoleLogService] Fetch logs failed:', error);
            return [];
        }
    }

    public async clearLogs(): Promise<boolean> {
        this.logs = [];
        this.lastTimestamp = 0;

        try {
            await this.bridge.invoke('clear_logs');
            return true;
        } catch (error) {
            this._tracer.error('[ConsoleLogService] Clear logs failed:', error);
            return false;
        }
    }

    public getLogs(): ILogEntry[] {
        return this.logs;
    }

    public async getAvailableViews(): Promise<IConsoleLogView[]> {
        if (!this.bridge.isTauri()) {
            const views: IConsoleLogView[] = [{ id: 'general', label: 'General' }];
            const moduleLabels = new Map<string, string>();
            this._hydrateModuleMetadata(moduleLabels);
            return [...views, ...this._buildModuleViews(moduleLabels)];
        }

        try {
            const result = await invokeSafe<ConsoleOverviewPayload>('get_console_overview');
            if (result.status === 'ok') {
                this._hydrateKnownRuntimeIds(result.data.views);
                return result.data.views;
            }
        } catch (error) {
            this._tracer.warn(
                `[ConsoleLogService] Failed to resolve console views: ${String(error)}`,
            );
        }

        const views: IConsoleLogView[] = [{ id: 'general', label: 'General' }];
        const moduleLabels = new Map<string, string>();
        this._hydrateModuleMetadata(moduleLabels);
        return [...views, ...this._buildModuleViews(moduleLabels)];
    }

    private _hydrateModuleMetadata(moduleLabels: Map<string, string>): void {
        for (const log of this.logs) {
            const moduleId = this._getModuleId(log);
            if (moduleId === null) {
                continue;
            }

            if (!moduleLabels.has(moduleId)) {
                moduleLabels.set(moduleId, this._getModuleLabel(moduleId));
            }
        }
    }

    private _buildModuleViews(moduleLabels: ReadonlyMap<string, string>): IConsoleLogView[] {
        this._knownModuleIds.clear();

        return [...moduleLabels.entries()].map(([moduleId, label]) => {
            this._knownModuleIds.add(moduleId);
            return {
                id: `module:${moduleId}`,
                label,
            };
        });
    }

    private _getModuleLabel(moduleId: string): string {
        return moduleId
            .replace(/^axelate-/, '')
            .split('-')
            .filter(Boolean)
            .map((part) => part[0]?.toUpperCase() + part.slice(1))
            .join(' ');
    }

    public getLogsForView(viewId: string): ILogEntry[] {
        if (viewId === 'general') {
            return this.logs.filter(
                (entry) => this._getModuleId(entry) === null && !this._isKnownEngineLog(entry),
            );
        }

        const moduleView = viewId.match(/^module:(.+)$/);
        if (moduleView !== null) {
            const moduleId = moduleView[1] ?? '';
            return this.logs.filter((entry) => this._getModuleId(entry) === moduleId);
        }

        const engineView = viewId.match(/^engine:(.+)$/);
        if (engineView !== null) {
            const engineId = engineView[1] ?? '';
            return this.logs.filter(
                (entry) => this._getModuleId(entry) === null && entry.source.trim() === engineId,
            );
        }

        return this.logs.filter((entry) => this._getModuleId(entry) === viewId);
    }

    public async getStatusItems(): Promise<IConsoleStatusItem[]> {
        if (!this.bridge.isTauri()) {
            return [];
        }

        try {
            const result = await invokeSafe<ConsoleOverviewPayload>('get_console_overview');
            if (result.status === 'ok') {
                return this._mapOverviewStatusItems(result.data);
            }
        } catch (error) {
            this._tracer.warn(
                `[ConsoleLogService] Failed to resolve engine status: ${String(error)}`,
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

    public async openLogsFolder(): Promise<boolean> {
        if (!this.bridge.isTauri()) {
            return false;
        }

        try {
            await this.bridge.invoke('open_log_dir');
            return true;
        } catch (error) {
            this._tracer.error(`[ConsoleLogService] Failed to open logs folder: ${String(error)}`);
            return false;
        }
    }

    private async _registerEngineListeners(): Promise<void> {
        await this._listenToEngineEvent('ai:engine:log', (payload) => {
            this._pushLog(payload.line, payload.engine_id, 'info');
        });
        await this._listenToEngineEvent('ai:engine:starting', (payload) => {
            this._pushLog('Engine is starting...', payload.engine_id, 'info');
        });
        await this._listenToEngineEvent('ai:engine:ready', (payload) => {
            this._pushLog(`Engine is ready at ${payload.endpoint}`, payload.engine_id, 'info');
        });
        await this._listenToEngineEvent('ai:engine:error', (payload) => {
            this._pushLog(payload.message, payload.engine_id, 'error');
        });
    }

    private async _listenToEngineEvent<TEvent extends EngineEventName>(
        eventName: TEvent,
        handler: (payload: EngineEventPayloadMap[TEvent]) => void,
    ): Promise<void> {
        const unlisten = await this.bridge.listen<EngineEventPayloadMap[TEvent]>(
            eventName,
            handler,
        );
        this._engineUnlisteners.push(unlisten);
    }

    private async _fetchTauriLogs(): Promise<ILogEntry[]> {
        return await this.bridge.invoke<ILogEntry[]>('get_logs', {
            since: this.lastTimestamp,
        });
    }

    private _processLogs(newLogs: ILogEntry[]): ILogEntry[] {
        if (!Array.isArray(newLogs) || newLogs.length === 0) {
            return [];
        }

        this.lastTimestamp = newLogs.at(-1)?.timestamp ?? this.lastTimestamp;
        const visibleLogs = newLogs
            .filter((entry) => !this._isNoise(entry))
            .map((entry) => this._normalizer.normalize(entry));
        if (visibleLogs.length === 0) {
            return [];
        }

        this.logs.push(...visibleLogs);
        this._trimLogs();
        return visibleLogs;
    }

    private _isNoise(entry: ILogEntry): boolean {
        return ConsoleLogService._NOISE_PATTERNS.some((pattern) =>
            pattern.test(String(entry.message)),
        );
    }

    private _pushLog(message: string, source: string, level: string): void {
        this._knownEngineIds.add(source);
        const entry: ILogEntry = {
            timestamp: Date.now() / 1000,
            source,
            level,
            message,
        };

        if (this._isNoise(entry)) {
            return;
        }

        this.logs.push(this._normalizer.normalize(entry));
        this._trimLogs();
    }

    private _trimLogs(): void {
        if (this.logs.length > ConsoleLogService._TRIM_THRESHOLD) {
            this.logs = this.logs.slice(-ConsoleLogService._MAX_LOG_COUNT);
        }
    }

    private _mapOverviewStatusItems(payload: ConsoleOverviewPayload): IConsoleStatusItem[] {
        return payload.status_items.map((item) => ({
            id: item.id,
            label: item.label,
            kind: item.kind === 'module' ? 'module' : 'engine',
            status: this._toRuntimeStatus(item.status),
            detail: item.detail,
        }));
    }

    private _hydrateKnownRuntimeIds(views: readonly IConsoleLogView[]): void {
        for (const view of views) {
            const engineId = view.id.match(/^engine:(.+)$/)?.[1]?.trim();
            if (engineId !== undefined && engineId !== '') {
                this._knownEngineIds.add(engineId);
            }

            const moduleId = view.id.match(/^module:(.+)$/)?.[1]?.trim();
            if (moduleId !== undefined && moduleId !== '') {
                this._knownModuleIds.add(moduleId);
            }
        }
    }

    private _isKnownEngineLog(entry: ILogEntry): boolean {
        return this._knownEngineIds.has(entry.source.trim());
    }

    private _getModuleId(entry: ILogEntry): string | null {
        const moduleId = entry.module_id?.trim();
        if (moduleId !== undefined && moduleId !== '') {
            this._knownModuleIds.add(moduleId);
            return moduleId;
        }

        const source = entry.source.trim();
        if (this._knownEngineIds.has(source)) {
            return null;
        }

        if (source !== '' && this._knownModuleIds.has(source)) {
            return source;
        }

        return null;
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
