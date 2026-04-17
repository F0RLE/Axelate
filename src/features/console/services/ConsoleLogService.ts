import { tracer } from '@/infrastructure/logging/LoggerService';
import { invokeSafe } from '@/shared/api/invoke';
import type { EngineState, SlotStatus } from '@/shared/types/bindings';
import { commands } from '@/shared/types/bindings';
import type { IBridge } from '@/shared/types/IBridge';

export interface ILogEntry {
    timestamp: number;
    source: string;
    level: string;
    message: string;
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

type EngineEventPayloadMap = {
    'ai:engine:log': { engine_id: string; line: string };
    'ai:engine:starting': { engine_id: string };
    'ai:engine:ready': { engine_id: string; endpoint: string };
    'ai:engine:error': { engine_id: string; message: string };
};

type EngineEventName = keyof EngineEventPayloadMap;

export class ConsoleLogService {
    private static readonly _MAX_LOG_COUNT = 1000;
    private static readonly _TRIM_THRESHOLD = 2000;
    private static readonly _MODULE_SOURCE_PREFIX = 'module:';
    private static readonly _MODULE_LABELS: Readonly<Record<string, string>> = {
        'axelate-telegram-bot': 'Telegram Bot',
    };
    private static readonly _LAUNCHER_SOURCES = new Set(['frontend', 'system', 'api-gateway']);
    private static readonly _NOISE_PATTERNS = [
        /\[AIBridge\] Stream chunk received/i,
        /\[AIBridge\] Thought chunk received/i,
    ];

    private logs: ILogEntry[] = [];
    private lastTimestamp = 0;
    private readonly _engineUnlisteners: Array<() => void> = [];
    private readonly _modulePathCache = new Map<string, string | null>();
    private readonly _knownModuleIds = new Set<string>();
    private _initialized = false;

    constructor(private readonly bridge: IBridge) {}

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
            const logs = this.bridge.isTauri()
                ? await this._fetchTauriLogs()
                : await this._fetchBrowserLogs();
            return this._processLogs(logs);
        } catch (error) {
            tracer.error('[ConsoleLogService] Fetch logs failed:', error);
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
        } catch (error) {
            tracer.error('[ConsoleLogService] Clear logs failed:', error);
            return false;
        }
    }

    public getLogs(): ILogEntry[] {
        return this.logs;
    }

    public async getAvailableViews(): Promise<IConsoleLogView[]> {
        const views: IConsoleLogView[] = [{ id: 'general', label: 'General' }];
        const moduleLabels = new Map<string, string>();
        if (!this.bridge.isTauri()) {
            this._hydrateModuleMetadata(moduleLabels);
            return [...views, ...this._buildModuleViews(moduleLabels)];
        }

        try {
            const result = await invokeSafe(commands.getEngineState());
            if (result.status === 'ok') {
                for (const slot of this._extractReadySlots(result.data as EngineState)) {
                    moduleLabels.set(slot.engine.id, slot.engine.name);
                }
            }
        } catch (error) {
            tracer.warn(`[ConsoleLogService] Failed to resolve console views: ${String(error)}`);
        }

        this._hydrateModuleMetadata(moduleLabels);
        return [...views, ...this._buildModuleViews(moduleLabels)];
    }

    private _hydrateModuleMetadata(moduleLabels: Map<string, string>): void {
        for (const log of this.logs) {
            const moduleId = this._resolveModuleIdFromEntry(log);
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
                id: moduleId,
                label,
            };
        });
    }

    private _getModuleLabel(moduleId: string): string {
        return (
            ConsoleLogService._MODULE_LABELS[moduleId] ??
            moduleId
                .replace(/^axelate-/, '')
                .split('-')
                .filter(Boolean)
                .map((part) => part[0]?.toUpperCase() + part.slice(1))
                .join(' ')
        );
    }

    public getLogsForView(viewId: string): ILogEntry[] {
        if (viewId === 'general') {
            return this.logs.filter((entry) => this._resolveModuleIdFromEntry(entry) === null);
        }

        return this.logs.filter(
            (entry) => entry.source === viewId || this._resolveModuleIdFromEntry(entry) === viewId,
        );
    }

    public async getStatusItems(): Promise<IConsoleStatusItem[]> {
        if (!this.bridge.isTauri()) {
            return [];
        }

        const items: IConsoleStatusItem[] = [];

        try {
            const result = await invokeSafe(commands.getEngineState());
            if (result.status === 'ok') {
                items.push(...this._buildEngineStatusItems(result.data as EngineState));
            }
        } catch (error) {
            tracer.warn(`[ConsoleLogService] Failed to resolve engine status: ${String(error)}`);
        }

        const moduleIds = new Set<string>();
        for (const log of this.logs) {
            const moduleId = this._extractModuleIdFromSource(log.source);
            if (moduleId !== null) {
                moduleIds.add(moduleId);
            }
        }

        if (moduleIds.size === 0) {
            return items;
        }

        const moduleStatusItems = await Promise.all(
            [...moduleIds].map(async (moduleId) => {
                const status = await this._getModuleStatus(moduleId);
                return {
                    id: `module:${moduleId}`,
                    label: this._getModuleLabel(moduleId),
                    kind: 'module' as const,
                    status,
                    detail: this._describeStatus(status),
                };
            }),
        );

        items.push(...moduleStatusItems);
        return items;
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
            tracer.warn(
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
            tracer.error(
                `[ConsoleLogService] Failed to open module folder for ${moduleId}: ${String(error)}`,
            );
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

    private async _fetchBrowserLogs(): Promise<ILogEntry[]> {
        const response = await fetch(`/api/logs?since=${this.lastTimestamp.toString()}`);
        if (!response.ok) {
            throw new Error('Fetch failed');
        }

        const text = await response.text();
        return this._safeJsonParse(text, []);
    }

    private _processLogs(newLogs: ILogEntry[]): ILogEntry[] {
        if (!Array.isArray(newLogs) || newLogs.length === 0) {
            return [];
        }

        this.lastTimestamp = newLogs.at(-1)?.timestamp ?? this.lastTimestamp;
        const visibleLogs = newLogs.filter((entry) => !this._isNoise(entry));
        if (visibleLogs.length === 0) {
            return [];
        }

        this.logs.push(...visibleLogs);
        this._trimLogs();
        return visibleLogs;
    }

    private _safeJsonParse<T>(text: string, defaultValue: T): T {
        try {
            return text ? (JSON.parse(text) as T) : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    private _isNoise(entry: ILogEntry): boolean {
        return ConsoleLogService._NOISE_PATTERNS.some((pattern) => pattern.test(entry.message));
    }

    private _pushLog(message: string, source: string, level: string): void {
        const entry: ILogEntry = {
            timestamp: Date.now() / 1000,
            source,
            level,
            message,
        };

        if (this._isNoise(entry)) {
            return;
        }

        this.logs.push(entry);
        this._trimLogs();
    }

    private _trimLogs(): void {
        if (this.logs.length > ConsoleLogService._TRIM_THRESHOLD) {
            this.logs = this.logs.slice(-ConsoleLogService._MAX_LOG_COUNT);
        }
    }

    private _buildEngineStatusItems(state: EngineState): IConsoleStatusItem[] {
        if (state === 'idle') {
            return [
                {
                    id: 'engine:idle',
                    label: 'Engines',
                    kind: 'engine',
                    status: 'stopped',
                    detail: 'No active engines',
                },
            ];
        }

        if ('starting' in state) {
            return [
                {
                    id: `engine:${state.starting.engine_id}`,
                    label: this._getModuleLabel(state.starting.engine_id),
                    kind: 'engine',
                    status: 'starting',
                    detail: 'Starting…',
                },
            ];
        }

        if ('swapping' in state) {
            return [
                {
                    id: `engine:${state.swapping.to}`,
                    label: this._getModuleLabel(state.swapping.to),
                    kind: 'engine',
                    status: 'starting',
                    detail: `Switching from ${state.swapping.from}`,
                },
            ];
        }

        if ('error' in state) {
            return [
                {
                    id: `engine:${state.error.engine_id}`,
                    label: this._getModuleLabel(state.error.engine_id),
                    kind: 'engine',
                    status: 'failed',
                    detail: state.error.message,
                },
            ];
        }

        return state.ready.slots.map((slot) => ({
            id: `engine:${slot.engine.id}`,
            label: slot.engine.name,
            kind: 'engine' as const,
            status: 'running' as const,
            detail: slot.capability,
        }));
    }

    private async _getModuleStatus(moduleId: string): Promise<ConsoleRuntimeStatus> {
        try {
            const status = await this.bridge.invoke<string>('get_module_status', { moduleId });
            if (status === 'running') {
                return 'running';
            }
            return 'stopped';
        } catch (error) {
            tracer.warn(
                `[ConsoleLogService] Failed to resolve module status for ${moduleId}: ${String(error)}`,
            );
            return 'failed';
        }
    }

    private _describeStatus(status: ConsoleRuntimeStatus): string {
        switch (status) {
            case 'running':
                return 'Running';
            case 'starting':
                return 'Starting…';
            case 'failed':
                return 'Failed';
            case 'stopped':
            default:
                return 'Stopped';
        }
    }

    private _extractModuleIdFromSource(source: string): string | null {
        if (!source.startsWith(ConsoleLogService._MODULE_SOURCE_PREFIX)) {
            return null;
        }

        return source.slice(ConsoleLogService._MODULE_SOURCE_PREFIX.length);
    }

    private _resolveModuleIdFromEntry(entry: ILogEntry): string | null {
        const explicitModuleId = this._extractModuleIdFromSource(entry.source);
        if (explicitModuleId !== null) {
            this._knownModuleIds.add(explicitModuleId);
            return explicitModuleId;
        }

        const inferredModuleId = this._resolveModuleIdFromText(entry.message);
        if (inferredModuleId !== null) {
            this._knownModuleIds.add(inferredModuleId);
            return inferredModuleId;
        }

        const normalizedSource = entry.source.trim();
        if (normalizedSource !== '' && this._knownModuleIds.has(normalizedSource)) {
            return normalizedSource;
        }

        if (
            normalizedSource !== '' &&
            !ConsoleLogService._LAUNCHER_SOURCES.has(normalizedSource.toLowerCase())
        ) {
            return null;
        }

        return null;
    }

    private _resolveModuleIdFromText(message: string): string | null {
        const patterns = [
            /Control\s+([a-z0-9._-]+)\s+->/i,
            /Launching App:\s+([a-z0-9._-]+)/i,
            /Starting provider:\s+([a-z0-9._-]+)/i,
            /Switching provider to:\s+([a-z0-9._-]+)/i,
            /Requesting stop for local module:\s+([a-z0-9._-]+)/i,
            /Stopping module:\s+([a-z0-9._-]+)/i,
            /Module\s+([a-z0-9._-]+)\s+successfully\s+stopped/i,
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            const moduleId = match?.[1]?.trim();
            if (moduleId !== undefined && moduleId !== '') {
                return moduleId;
            }
        }

        return null;
    }

    private _extractReadySlots(state: EngineState): SlotStatus[] {
        if (typeof state !== 'object' || state === null || !('ready' in state)) {
            return [];
        }

        return state.ready.slots;
    }
}
