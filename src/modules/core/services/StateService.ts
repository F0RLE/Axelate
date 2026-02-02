/**
 * @module core/services/StateService
 * @description Manages persistent UI state across sessions
 */

import { Core } from '../core';
import { IApp } from '../types/coreTypes';

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
}

const DEFAULT_UI_STATE: IUIState = {
    sidebar_collapsed: false,
    sidebar_width: 280,
    hidden_nav_items: [],
    hidden_monitors: [],
    card_widths: {},
    download_limit_enabled: false,
    download_max_speed: 50,
    selected_modules: {},
    zoom_level: 1,
    selected_ai_models: {},
    resolution_zoom: {},
    sound_enabled: true,
};

export class StateService {
    private readonly _core: Core;
    private _state: IUIState = { ...DEFAULT_UI_STATE };
    private _isDirty = false;
    private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _STORAGE_KEY = 'axelate_ui_state';

    constructor(core: Core) {
        this._core = core;
        this._initAutoSave();
    }

    /**
     * Loads the UI state from either the Tauri backend or localStorage.
     */
    public async loadState(): Promise<IUIState> {
        try {
            const win = globalThis as unknown as Window & {
                __TAURI__?: { core: { invoke: <T>(c: string, a?: unknown) => Promise<T> } };
            };
            if (win.__TAURI__) {
                const loaded = await win.__TAURI__.core.invoke<IUIState>('get_ui_state');
                this.setState(loaded);
                console.log('[StateService] Loaded from backend');
            } else {
                const stored = localStorage.getItem(this._STORAGE_KEY);
                if (stored) {
                    this.setState(JSON.parse(stored));
                    console.log('[StateService] Loaded from localStorage');
                }
            }
        } catch (e) {
            console.warn('[StateService] Failed to load, using defaults:', e);
            // Defaults already set
        }

        this._syncDownloadSettingsToBackend();
        return this._state;
    }

    /**
     * Sets the UI state manually (e.g. from bootstrap data).
     */
    public setState(state: Partial<IUIState>): void {
        this._state = { ...this._state, ...state };
    }

    /**
     * Returns the current full UI state.
     */
    public getState(): IUIState {
        return this._state;
    }

    /**
     * Returns a specific key from the state.
     */
    public get<K extends keyof IUIState>(key: K): IUIState[K] {
        return this._state[key];
    }

    /**
     * Updates a specific state key and marks state as dirty.
     */
    public set<K extends keyof IUIState>(key: K, value: IUIState[K]): void {
        this._state[key] = value;
        this._isDirty = true;
        this._debouncedSave();
    }

    /**
     * Returns the selected modules record.
     */
    public getSelectedModules(): Record<string, Partial<IApp>> {
        return this._state.selected_modules || {};
    }

    /**
     * Returns a selected module for a specific category.
     */
    public getSelectedModule(category: string): Partial<IApp> | undefined {
        return this._state.selected_modules?.[category];
    }

    /**
     * Updates a selected module for a category.
     */
    public setSelectedModule(category: string, data: Partial<IApp>): void {
        if (!this._state.selected_modules) this._state.selected_modules = {};
        this._state.selected_modules[category] = data;
        this._isDirty = true;
        this._debouncedSave();
    }

    /**
     * Removes a selected module for a category.
     */
    public removeSelectedModule(category: string): void {
        if (this._state.selected_modules?.[category]) {
            delete this._state.selected_modules[category];
            this._isDirty = true;
            this._debouncedSave();
        }
    }

    /**
     * Returns the selected AI model for a specific app ID.
     */
    public getSelectedAIModel(appId: string): string | undefined {
        return this._state.selected_ai_models?.[appId];
    }

    /**
     * Sets the selected AI model for a specific app ID.
     */
    public setSelectedAIModel(appId: string, modelKey: string): void {
        if (!this._state.selected_ai_models) this._state.selected_ai_models = {};
        this._state.selected_ai_models[appId] = modelKey;
        this._isDirty = true;
        this._debouncedSave();
    }

    /**
     * Triggers a debounced save operation.
     */
    private _debouncedSave(): void {
        if (this._autoSaveTimer) {
            globalThis.clearTimeout(this._autoSaveTimer);
        }
        this._autoSaveTimer = globalThis.setTimeout(() => {
            void this.saveAsync();
        }, 1000);
    }

    /**
     * Asynchronously saves the UI state.
     */
    public async saveAsync(): Promise<void> {
        if (!this._isDirty) return;

        try {
            const win = globalThis as unknown as Window & {
                __TAURI__?: { core: { invoke: (c: string, a?: unknown) => Promise<void> } };
            };
            if (win.__TAURI__) {
                await win.__TAURI__.core.invoke('save_ui_state', { state: this._state });
            } else {
                localStorage.setItem(this._STORAGE_KEY, JSON.stringify(this._state));
            }
            this._isDirty = false;
        } catch (e) {
            console.error('[StateService] Failed to save state:', e);
        }
    }

    /**
     * Forces an immediate save (e.g., on exit).
     */
    public saveImmediate(): void {
        if (!this._isDirty) return;
        try {
            const win = globalThis as unknown as Window & {
                __TAURI__?: { core: { invoke: (c: string, a?: unknown) => Promise<void> } };
            };
            if (win.__TAURI__) {
                void win.__TAURI__.core.invoke('save_ui_state', { state: this._state });
            } else {
                localStorage.setItem(this._STORAGE_KEY, JSON.stringify(this._state));
            }
            this._isDirty = false;
        } catch (e) {
            console.error('[StateService] Save immediate failed', e);
        }
    }

    /**
     * Initializes auto-save event listeners.
     */
    private _initAutoSave(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                void this.saveAsync();
            }
        });

        globalThis.addEventListener('beforeunload', () => {
            this.saveImmediate();
        });
    }

    // =================================================================================
    // Compatibility Methods (Standardized API for Legacy Consumers)
    // =================================================================================

    /**
     * Returns sidebar collapsed state.
     */
    public getSidebarCollapsed(): boolean {
        return this._state.sidebar_collapsed;
    }

    /**
     * Sets sidebar collapsed state.
     */
    public setSidebarCollapsed(collapsed: boolean): void {
        this.set('sidebar_collapsed', collapsed);
    }

    /**
     * Returns sidebar width.
     */
    public getSidebarWidth(): number {
        return this._state.sidebar_width;
    }

    /**
     * Sets sidebar width.
     */
    public setSidebarWidth(width: number): void {
        this.set('sidebar_width', width);
    }

    /**
     * Returns hidden navigation items.
     */
    public getHiddenNavItems(): string[] {
        return this._state.hidden_nav_items;
    }

    /**
     * Sets hidden navigation items.
     */
    public setHiddenNavItems(items: string[]): void {
        this.set('hidden_nav_items', items);
    }

    /**
     * Returns hidden monitor IDs.
     */
    public getHiddenMonitors(): string[] {
        return this._state.hidden_monitors;
    }

    /**
     * Sets hidden monitor IDs.
     */
    public setHiddenMonitors(items: string[]): void {
        this.set('hidden_monitors', items);
    }

    /**
     * Returns the full map of card widths.
     */
    public getCardWidths(): Record<string, string> {
        return this._state.card_widths;
    }

    /**
     * Updates a specific card's width.
     */
    public setCardWidth(cardId: string, width: string): void {
        if (!this._state.card_widths) this._state.card_widths = {};
        this._state.card_widths[cardId] = width;
        this._isDirty = true;
        this._debouncedSave();
    }

    /**
     * Returns the current download settings.
     */
    public getDownloadSettings(): { limitEnabled: boolean; maxSpeed: number } {
        return {
            limitEnabled: this._state.download_limit_enabled,
            maxSpeed: this._state.download_max_speed,
        };
    }

    /**
     * Sets download limit settings.
     */
    public setDownloadSettings(limitEnabled: boolean, maxSpeed: number): void {
        this._state.download_limit_enabled = limitEnabled;
        this._state.download_max_speed = maxSpeed;
        this._isDirty = true;
        this._debouncedSave();
        this._syncDownloadSettingsToBackend();
    }

    private _syncDownloadSettingsToBackend(): void {
        const win = globalThis as unknown as Window & {
            __TAURI__?: { core: { invoke: (c: string, a?: unknown) => Promise<void> } };
        };
        if (win.__TAURI__) {
            win.__TAURI__.core.invoke('set_download_settings', {
                enabled: this._state.download_limit_enabled,
                max_speed: this._state.download_max_speed,
            }).catch((e) => console.error('[StateService] Failed to sync download settings:', e));
        }
    }

    /**
     * Returns the last visited page ID.
     */
    public getLastPage(): string {
        return this._state.last_page || 'home';
    }

    /**
     * Returns the current zoom level.
     */
    public getZoomLevel(): number {
        return this._state.zoom_level;
    }

    /**
     * Sets the zoom level.
     * Note: Does not trigger save as WindowService handles persistence via backend command.
     */
    public setZoomLevel(zoom: number): void {
        this._state.zoom_level = zoom;
        // Optimization: Do NOT mark dirty. WindowService calls set_webview_zoom which saves state.
    }

    /**
     * Sets the last visited page ID.
     */
    public setLastPage(page: string): void {
        this.set('last_page', page);
    }

    /**
     * Returns the zoom level for a specific resolution key (e.g., "1920x1080").
     */
    public getResolutionZoom(resKey: string): number | undefined {
        return this._state.resolution_zoom?.[resKey];
    }

    /**
     * Sets the zoom level for a specific resolution key.
     * Note: Does not trigger save as WindowService handles persistence via backend command.
     */
    public setResolutionZoom(resKey: string, zoom: number): void {
        if (!this._state.resolution_zoom) {
            this._state.resolution_zoom = {};
        }
        this._state.resolution_zoom[resKey] = zoom;
        // Optimization: Do NOT mark dirty.
    }

    /**
     * Returns whether sound effects are enabled.
     */
    public getSoundEnabled(): boolean {
        return this._state.sound_enabled;
    }

    /**
     * Sets whether sound effects are enabled.
     */
    public setSoundEnabled(enabled: boolean): void {
        this.set('sound_enabled', enabled);
    }
}
