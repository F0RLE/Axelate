/**
 * @module shared/services/state/UiStateStore
 * @description Centralized store and persistence logic for the unified UI State.
 * Persistence is coordinated by StateManager — this class exposes saveAsync/saveImmediate
 * for registration as a StateManager target.
 */

import { type IBridge } from '@/shared/types/IBridge';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IApp } from '@/shared/types/coreTypes';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface IUIState {
    sidebar_collapsed: boolean;
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
    resolution_zoom: Record<string, number>;
    sound_enabled: boolean;
    ai_thinking_level: Record<string, ThinkingLevel>;
    local_max_output_tokens: Record<string, number>;
    last_active_provider: string | null;
    ai_session_id: string | null;
    preferred_language?: string | null;
    pending_chat_reveal: boolean;
}

const DEFAULT_UI_STATE: IUIState = {
    sidebar_collapsed: false,
    sidebar_width: 280,
    hidden_nav_items: ['marketplace'],
    hidden_monitors: [],
    card_widths: {},
    download_limit_enabled: false,
    download_max_speed: 50,
    selected_modules: {},
    zoom_level: 1,
    selected_ai_models: {},
    resolution_zoom: {},
    sound_enabled: true,
    ai_thinking_level: {},
    local_max_output_tokens: {},
    last_active_provider: null,
    ai_session_id: null,
    preferred_language: null,
    pending_chat_reveal: false,
};

export class UiStateStore {
    private _state: IUIState = { ...DEFAULT_UI_STATE };
    private _isDirty = false;
    private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _STORAGE_KEY = 'axelate_ui_state';
    private _isDestroyed = false;

    constructor(private readonly _bridge: IBridge) {}

    public async loadState(): Promise<IUIState> {
        try {
            if (this._bridge.isTauri()) {
                const loaded = await this._bridge.invoke<IUIState>('get_ui_state');
                this.setState(loaded);
                tracer.info('[UiStateStore] Loaded from backend');
            } else {
                const stored = localStorage.getItem(this._STORAGE_KEY);
                if (stored !== null) {
                    this.setState(JSON.parse(stored) as Partial<IUIState>);
                    tracer.info('[UiStateStore] Loaded from localStorage');
                }
            }
        } catch (e) {
            tracer.warn(`[UiStateStore] Failed to load, using defaults: ${String(e)}`);
        }
        return this._state;
    }

    public setState(state: Partial<IUIState>): void {
        this._state = { ...this._state, ...state };
    }

    public getState(): IUIState {
        return this._state;
    }

    public updateState(updates: Partial<IUIState>, markDirty = true): void {
        this._state = { ...this._state, ...updates };
        if (markDirty) {
            this._isDirty = true;
            this._debouncedSave();
        }
    }

    public updateNestedState<K extends keyof IUIState>(
        key: K,
        nestedKey: string,
        value: unknown,
        markDirty = true,
    ): void {
        const target = this._state[key] as Record<string, unknown>;
        target[nestedKey] = value;
        if (markDirty) {
            this._isDirty = true;
            this._debouncedSave();
        }
    }

    public removeNestedState<K extends keyof IUIState>(
        key: K,
        nestedKey: string,
        markDirty = true,
    ): void {
        const target = this._state[key] as Record<string, unknown>;
        delete target[nestedKey];
        if (markDirty) {
            this._isDirty = true;
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
        try {
            if (this._bridge.isTauri()) {
                await this._bridge.invoke('save_ui_state', { state: this._state });
            } else {
                localStorage.setItem(this._STORAGE_KEY, JSON.stringify(this._state));
            }
            this._isDirty = false;
        } catch (e) {
            tracer.error(`[UiStateStore] Failed to save state: ${String(e)}`);
        }
    }

    public saveImmediate(): void {
        if (!this._isDirty) return;
        try {
            if (this._bridge.isTauri()) {
                void this._bridge.invoke('save_ui_state', { state: this._state });
            } else {
                localStorage.setItem(this._STORAGE_KEY, JSON.stringify(this._state));
            }
            this._isDirty = false;
        } catch (e) {
            tracer.error(`[UiStateStore] Save immediate failed: ${String(e)}`);
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
}
