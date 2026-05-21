/**
 * @module shared/services/state/UiStateStore
 * @description Centralized store and persistence logic for the unified UI State.
 * Persistence is coordinated by StateManager — this class exposes saveAsync/saveImmediate
 * for registration as a StateManager target.
 */

import { type IBridge } from '@/shared/types/IBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IApp } from '@/shared/types/coreTypes';

type UiStateStoreLogger = Pick<LoggerService, 'info' | 'warn' | 'error'>;

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface IUIState {
    sidebar_collapsed: boolean;
    sidebar_manual_override?: boolean;
    sidebar_width: number;
    hidden_nav_items: string[];
    hidden_monitors: string[];
    card_widths: Record<string, string>;
    download_limit_enabled: boolean;
    download_max_speed: number;
    selected_modules: Record<string, Partial<IApp>>;
    last_page?: string;
    zoom_level: number;
    selected_ai_models: Record<string, string>;
    ai_api_base_urls: Record<string, string>;
    resolution_zoom: Record<string, number>;
    sound_enabled: boolean;
    ai_thinking_level: Record<string, ThinkingLevel>;
    ai_web_search_enabled: Record<string, boolean>;
    local_max_output_tokens: Record<string, number>;
    integration_import_last_directory: string | null;
    preferred_language?: string | null;
    pending_chat_reveal: boolean;
}

const DEFAULT_UI_STATE: IUIState = {
    sidebar_collapsed: false,
    sidebar_manual_override: false,
    sidebar_width: 280,
    hidden_nav_items: [],
    hidden_monitors: [],
    card_widths: {},
    download_limit_enabled: false,
    download_max_speed: 50,
    selected_modules: {},
    zoom_level: 1,
    selected_ai_models: {},
    ai_api_base_urls: {},
    resolution_zoom: {},
    sound_enabled: true,
    ai_thinking_level: {},
    ai_web_search_enabled: {},
    local_max_output_tokens: {},
    integration_import_last_directory: null,
    preferred_language: null,
    pending_chat_reveal: false,
};

const MIN_UI_ZOOM = 0.95;
const MAX_UI_ZOOM = 2.6;

export class UiStateStore {
    private _state: IUIState = { ...DEFAULT_UI_STATE };
    private _isDirty = false;
    private _revision = 0;
    private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private _isDestroyed = false;

    constructor(
        private readonly _bridge: IBridge,
        private readonly _tracer: UiStateStoreLogger,
    ) {}

    public async loadState(): Promise<IUIState> {
        try {
            if (this._bridge.isTauri()) {
                const loaded = await this._bridge.invoke<IUIState>('get_ui_state');
                this.setState(loaded);
                this._tracer.info('[UiStateStore] Loaded from backend');
            }
        } catch (e) {
            this._tracer.warn(`[UiStateStore] Failed to load, using defaults: ${String(e)}`);
        }
        return this._state;
    }

    public setState(state: Partial<IUIState>): void {
        this._state = this._normalizeState({ ...this._state, ...state });
    }

    public getState(): IUIState {
        return this._state;
    }

    public updateState(updates: Partial<IUIState>, markDirty = true): void {
        this._state = this._normalizeState({ ...this._state, ...updates });
        if (markDirty) {
            this._isDirty = true;
            this._revision += 1;
            this._debouncedSave();
        }
    }

    public updateNestedState<K extends keyof IUIState>(
        key: K,
        nestedKey: string,
        value: unknown,
        markDirty = true,
    ): void {
        const target = this._getRecordTarget(key);
        target[nestedKey] = value;
        if (markDirty) {
            this._isDirty = true;
            this._revision += 1;
            this._debouncedSave();
        }
    }

    public removeNestedState<K extends keyof IUIState>(
        key: K,
        nestedKey: string,
        markDirty = true,
    ): void {
        const target = this._getRecordTarget(key);
        delete target[nestedKey];
        if (markDirty) {
            this._isDirty = true;
            this._revision += 1;
            this._debouncedSave();
        }
    }

    // --- Module Selection Convenience API (satisfies UIStateInterface) ---

    public getSelectedModules(): Record<string, Partial<IApp>> {
        return this._state.selected_modules;
    }

    public getSelectedModule(category: string): Partial<IApp> | undefined {
        return this._state.selected_modules[category];
    }

    public setSelectedModule(category: string, data: Partial<IApp>): void {
        this.updateNestedState('selected_modules', category, data);
    }

    public removeSelectedModule(category: string): void {
        this.removeNestedState('selected_modules', category);
    }

    public getIntegrationImportLastDirectory(): string | null {
        return this._state.integration_import_last_directory;
    }

    public setIntegrationImportLastDirectory(path: string | null): void {
        const normalized = typeof path === 'string' ? path.trim() : '';
        this.updateState({ integration_import_last_directory: normalized || null });
    }

    private _debouncedSave(): void {
        if (this._autoSaveTimer !== null) {
            globalThis.clearTimeout(this._autoSaveTimer);
        }
        this._autoSaveTimer = globalThis.setTimeout(() => {
            void this.saveAsync();
        }, 1000);
    }

    public async saveAsync(): Promise<void> {
        if (!this._isDirty) return;
        const revision = this._revision;
        const state = this._snapshotState();
        try {
            if (this._bridge.isTauri()) {
                await this._bridge.invoke('save_ui_state', { state });
            }
            if (this._revision === revision) {
                this._isDirty = false;
            }
        } catch (e) {
            this._tracer.error(`[UiStateStore] Failed to save state: ${String(e)}`);
        }
    }

    public async saveImmediate(): Promise<void> {
        if (!this._isDirty) return;
        const revision = this._revision;
        const state = this._snapshotState();
        try {
            if (this._bridge.isTauri()) {
                await this._bridge.invoke('save_ui_state', { state });
                if (this._revision === revision) {
                    this._isDirty = false;
                }
            }
        } catch (e) {
            this._tracer.error(`[UiStateStore] Save immediate failed: ${String(e)}`);
            throw e;
        }
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;

        if (this._autoSaveTimer !== null) {
            globalThis.clearTimeout(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    private _normalizeState(state: IUIState): IUIState {
        const resolutionZoom = this._normalizeNumberRecord(
            state.resolution_zoom,
            DEFAULT_UI_STATE.resolution_zoom,
        );

        return {
            ...state,
            hidden_nav_items: this._normalizeStringArray(
                state.hidden_nav_items,
                DEFAULT_UI_STATE.hidden_nav_items,
            ),
            hidden_monitors: this._normalizeStringArray(
                state.hidden_monitors,
                DEFAULT_UI_STATE.hidden_monitors,
            ),
            card_widths: this._normalizeStringRecord(state.card_widths),
            selected_modules: this._normalizeObjectRecord(state.selected_modules),
            selected_ai_models: this._normalizeStringRecord(state.selected_ai_models),
            ai_api_base_urls: this._normalizeUrlRecord(state.ai_api_base_urls),
            resolution_zoom: Object.fromEntries(
                Object.entries(resolutionZoom).map(([key, zoom]) => [key, this._clampZoom(zoom)]),
            ),
            ai_thinking_level: this._normalizeThinkingLevelRecord(state.ai_thinking_level),
            ai_web_search_enabled: this._normalizeBooleanRecord(state.ai_web_search_enabled),
            local_max_output_tokens: this._normalizeNumberRecord(
                state.local_max_output_tokens,
                DEFAULT_UI_STATE.local_max_output_tokens,
            ),
            integration_import_last_directory: this._normalizeNullableString(
                state.integration_import_last_directory,
            ),
            zoom_level: this._clampZoom(state.zoom_level),
        };
    }

    private _normalizeStringArray(value: unknown, fallback: string[]): string[] {
        if (!Array.isArray(value)) {
            return [...fallback];
        }

        return value.filter((item): item is string => typeof item === 'string');
    }

    private _normalizeObjectRecord(value: unknown): Record<string, Partial<IApp>> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        return value as Record<string, Partial<IApp>>;
    }

    private _normalizeStringRecord(value: unknown): Record<string, string> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(
                (entry): entry is [string, string] => {
                    const [, item] = entry;
                    return typeof item === 'string';
                },
            ),
        );
    }

    private _normalizeUrlRecord(value: unknown): Record<string, string> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .map(([key, item]): [string, string] => [
                    key,
                    typeof item === 'string' ? item.trim() : '',
                ])
                .filter((entry) => {
                    const [, item] = entry;
                    return item.startsWith('https://') || item.startsWith('http://localhost');
                }),
        );
    }

    private _normalizeNullableString(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
    }

    private _normalizeBooleanRecord(value: unknown): Record<string, boolean> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(
                (entry): entry is [string, boolean] => {
                    const [, item] = entry;
                    return typeof item === 'boolean';
                },
            ),
        );
    }

    private _normalizeThinkingLevelRecord(value: unknown): Record<string, ThinkingLevel> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(
                (entry): entry is [string, ThinkingLevel] => {
                    const [, item] = entry;
                    return item === 'off' || item === 'low' || item === 'medium' || item === 'high';
                },
            ),
        );
    }

    private _normalizeNumberRecord(
        value: unknown,
        fallback: Record<string, number> = {},
    ): Record<string, number> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return { ...fallback };
        }

        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(
                (entry): entry is [string, number] => {
                    const [, item] = entry;
                    return typeof item === 'number' && Number.isFinite(item);
                },
            ),
        );
    }

    private _snapshotState(): IUIState {
        return structuredClone(this._state);
    }

    private _getRecordTarget<K extends keyof IUIState>(key: K): Record<string, unknown> {
        const target = this._state[key];
        if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
            return target as Record<string, unknown>;
        }

        const replacement: Record<string, unknown> = {};
        (this._state as Record<keyof IUIState, unknown>)[key] = replacement;
        return replacement;
    }

    private _clampZoom(zoom: number): number {
        if (!Number.isFinite(zoom)) {
            return DEFAULT_UI_STATE.zoom_level;
        }

        return Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, zoom));
    }
}
