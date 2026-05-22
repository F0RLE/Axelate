import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { invokeSafe } from '@/shared/api/invoke';
import type { IBridge } from '@/shared/types/IBridge';
import type { AgentAuditEntry, AgentControlState } from '@/shared/types/bindings';
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
type ConsoleLogTranslate = (key: string, fallback?: string) => string;

export class ConsoleLogService {
    private static readonly _MAX_LOG_COUNT_PER_VIEW = 1200;
    private static readonly _AGENT_VIEW_ID = 'agent';

    private readonly _logsByView = new Map<string, ILogEntry[]>();
    private readonly _lastTimestampByView = new Map<string, number>();
    private readonly _modulePathCache = new Map<string, string | null>();
    private readonly _knownViewIds = new Set<string>(['general', ConsoleLogService._AGENT_VIEW_ID]);
    private readonly _normalizer = new ConsoleLogNormalizer();
    private _agentAuditClearTimestamp = 0;

    constructor(
        private readonly bridge: IBridge,
        private readonly _tracer: ConsoleLogServiceLogger,
        private readonly _translate: ConsoleLogTranslate = (key) => key,
    ) {}

    public init(): Promise<void> {
        return Promise.resolve();
    }

    public destroy(): void {
        this._logsByView.clear();
        this._lastTimestampByView.clear();
        this._knownViewIds.clear();
        this._knownViewIds.add('general');
        this._knownViewIds.add(ConsoleLogService._AGENT_VIEW_ID);
        this._agentAuditClearTimestamp = 0;
    }

    public async fetchLogs(viewId = 'general'): Promise<ILogEntry[]> {
        const normalizedViewId = this._canonicalViewId(viewId);
        const since = Math.max(
            this._lastTimestampByView.get(normalizedViewId) ?? 0,
            normalizedViewId === ConsoleLogService._AGENT_VIEW_ID
                ? this._agentAuditClearTimestamp
                : 0,
        );

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
            if (normalizedViewId === ConsoleLogService._AGENT_VIEW_ID) {
                this._clearLocalAgentLogs();
                return true;
            }

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
            this._clearLocalAgentLogs();
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
                const views = this._withAgentView(this._normalizeViews(result.data.views));
                this._rememberKnownViews(views);
                return views;
            }
        } catch (error) {
            this._tracer.warn(
                `[ConsoleLogService] Failed to resolve console views: ${String(error)}`,
            );
        }

        return this._withAgentView([
            { id: 'general', label: this._translate('ui.launcher.web.logs_general') },
        ]);
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
        try {
            await this.bridge.invoke('open_module_folder', { moduleId });
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

        const normalizedViewId = this._canonicalViewId(viewId);
        if (normalizedViewId === ConsoleLogService._AGENT_VIEW_ID) {
            return false;
        }

        try {
            await this.bridge.invoke('open_console_log_target', {
                viewId: normalizedViewId,
            });
            return true;
        } catch (error) {
            this._tracer.error(`[ConsoleLogService] Failed to open logs folder: ${String(error)}`);
            return false;
        }
    }

    private async _fetchTauriLogs(viewId: string, since: number): Promise<ILogEntry[]> {
        if (viewId === ConsoleLogService._AGENT_VIEW_ID) {
            return await this._fetchAgentAuditLogs(since);
        }

        if (!this.bridge.isTauri()) {
            return await this.bridge.invoke<ILogEntry[]>('get_logs', { since });
        }

        return await this.bridge.invoke<ILogEntry[]>('get_console_logs', { viewId, since });
    }

    private async _fetchAgentAuditLogs(since: number): Promise<ILogEntry[]> {
        const result = await invokeSafe<AgentControlState>('get_agent_control_state');
        if (result.status !== 'ok') {
            throw new Error(result.error.message);
        }

        return result.data.audit
            .map((entry) => this._mapAgentAuditEntry(entry))
            .filter((entry) => entry.timestamp > since)
            .sort((left, right) => left.timestamp - right.timestamp);
    }

    private _mapAgentAuditEntry(entry: AgentAuditEntry): ILogEntry {
        const timestamp = this._agentAuditTimestamp(entry.createdAt);
        const action = entry.action.trim();
        const target = entry.target.trim();
        const result = entry.result.trim();
        const level = this._agentAuditLevel(result);
        const actorName = entry.actorName.trim() || this._translate('ui.launcher.web.logs_agent');
        const targetText =
            target === '' ? this._translate('ui.debug.logs_agent_target_launcher') : target;
        const resultText =
            result === '' ? this._translate('ui.debug.logs_agent_result_recorded') : result;

        return {
            timestamp,
            source: 'agent-control',
            level,
            message: `target=${targetText} result=${resultText}`,
            module_id: null,
            display_time: this._formatAgentAuditTime(timestamp),
            normalized_level: level,
            scope: action === '' ? null : action,
            summary_message: `${targetText} -> ${resultText}`,
            source_label: actorName,
            source_class: 'src-AGENT',
            action: action === '' ? null : action,
        };
    }

    private _appendLogs(viewId: string, newLogs: ILogEntry[]): ILogEntry[] {
        if (!Array.isArray(newLogs) || newLogs.length === 0) {
            return [];
        }

        const normalizedLogs = this._filterLogsForView(
            viewId,
            newLogs.map((entry) => this._normalizer.normalize(entry)),
        );
        if (normalizedLogs.length === 0) {
            this._lastTimestampByView.set(
                viewId,
                newLogs.at(-1)?.timestamp ?? this._lastTimestampByView.get(viewId) ?? 0,
            );
            return [];
        }

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

    private _withAgentView(views: readonly IConsoleLogView[]): IConsoleLogView[] {
        if (views.some((view) => view.id === ConsoleLogService._AGENT_VIEW_ID)) {
            return [...views];
        }

        const agentView = {
            id: ConsoleLogService._AGENT_VIEW_ID,
            label: this._translate('ui.launcher.web.logs_agent'),
        };
        const generalIndex = views.findIndex((view) => view.id === 'general');
        if (generalIndex < 0) {
            return [agentView, ...views];
        }

        return [...views.slice(0, generalIndex + 1), agentView, ...views.slice(generalIndex + 1)];
    }

    private _rememberKnownViews(views: readonly IConsoleLogView[]): void {
        this._knownViewIds.clear();
        this._knownViewIds.add('general');
        this._knownViewIds.add(ConsoleLogService._AGENT_VIEW_ID);
        views.forEach((view) => {
            const id = this._canonicalViewId(view.id);
            if (id !== '') {
                this._knownViewIds.add(id);
            }
        });
    }

    private _filterLogsForView(viewId: string, logs: ILogEntry[]): ILogEntry[] {
        if (viewId !== 'general') {
            return logs;
        }

        return logs.filter((entry) => !this._belongsToKnownRuntimeView(entry));
    }

    private _belongsToKnownRuntimeView(entry: ILogEntry): boolean {
        const moduleId = entry.module_id?.trim();
        if (moduleId !== undefined && moduleId !== '') {
            return this._knownViewIds.has(`module:${moduleId}`);
        }

        if (entry.source.startsWith('module:')) {
            return this._knownViewIds.has(`module:${entry.source.slice('module:'.length)}`);
        }

        const engineId = this._canonicalEngineId(entry.source);
        return engineId !== '' && this._knownViewIds.has(`engine:${engineId}`);
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
        return key;
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

    private _clearLocalAgentLogs(): void {
        const cached = this._logsByView.get(ConsoleLogService._AGENT_VIEW_ID) ?? [];
        const latestCachedTimestamp = cached.reduce(
            (latest, entry) => Math.max(latest, entry.timestamp),
            0,
        );
        const cursor = Math.max(
            latestCachedTimestamp,
            this._lastTimestampByView.get(ConsoleLogService._AGENT_VIEW_ID) ?? 0,
            Date.now() / 1000,
        );
        this._agentAuditClearTimestamp = cursor;
        this._logsByView.set(ConsoleLogService._AGENT_VIEW_ID, []);
        this._lastTimestampByView.set(ConsoleLogService._AGENT_VIEW_ID, cursor);
    }

    private _agentAuditTimestamp(value: string): number {
        const parsed = Date.parse(value);
        if (!Number.isFinite(parsed)) {
            return 0;
        }
        return parsed / 1000;
    }

    private _formatAgentAuditTime(timestamp: number): string | null {
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return null;
        }

        return new Date(timestamp * 1000).toLocaleTimeString();
    }

    private _agentAuditLevel(result: string): string {
        const normalized = result.trim().toLowerCase();
        if (
            normalized.includes('failed') ||
            normalized.includes('error') ||
            normalized.includes('rejected')
        ) {
            return 'ERROR';
        }
        if (
            normalized.includes('denied') ||
            normalized.includes('pending') ||
            normalized.includes('revoked')
        ) {
            return 'WARN';
        }
        return 'INFO';
    }
}
