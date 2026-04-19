/**
 * @module core/services/WindowService
 * @description Service for managing application window behavior, zoom, and display states
 */

import { type IBridge } from '@/shared/types/IBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { WindowServiceActions } from './WindowServiceActions';
import { WindowNativeBridgeHelper } from './WindowNativeBridgeHelper';
import { WindowServicePolicy } from './WindowServicePolicy';
import { WindowServicePersistence } from './WindowServicePersistence';
import { WindowServiceZoom, type WindowZoomSettingsStore } from './WindowServiceZoom';

type WindowServiceLogger = Pick<LoggerService, 'info' | 'warn' | 'error'>;

export interface IWindowBreakpoints {
    compact: number;
    medium: number;
    large: number;
}

export interface IWindowThresholds {
    warningWidth: number;
    warningHeight: number;
    smallScreenWidth: number;
    smallScreenHeight: number;
}

export interface IWindowConfig {
    breakpoints: IWindowBreakpoints;
    thresholds: IWindowThresholds;
}

export interface IWindowPolicy {
    isSmallScreen: boolean;
    showWarning: boolean;
}

type WindowRuntime = {
    addEventListener: typeof globalThis.addEventListener;
    removeEventListener: typeof globalThis.removeEventListener;
    close: () => void;
    getScreenSize: () => { width: number; height: number };
    setAppZoomCss: (zoom: string) => void;
};

function createDefaultWindowRuntime(): WindowRuntime {
    return {
        addEventListener: globalThis.addEventListener.bind(globalThis),
        removeEventListener: globalThis.removeEventListener.bind(globalThis),
        close: () => {
            globalThis.close();
        },
        getScreenSize: () => ({
            width: globalThis.screen.width,
            height: globalThis.screen.height,
        }),
        setAppZoomCss: (zoom: string) => {
            document.documentElement.style.setProperty('--app-zoom', zoom);
        },
    };
}

export class WindowService {
    private _currentZoom = 1;
    private readonly _MIN_ZOOM = 0.5;
    private readonly _MAX_ZOOM = 3;
    private _config: IWindowConfig | null = null;
    private _isDestroyed = false;
    private _beforeClose: (() => Promise<void>) | null = null;
    private _uiSettingsService: WindowZoomSettingsStore | null = null;
    private readonly _actions: WindowServiceActions;
    private readonly _nativeHelper: WindowNativeBridgeHelper;
    private readonly _persistence: WindowServicePersistence;
    private readonly _policyService: WindowServicePolicy;
    private readonly _zoomService: WindowServiceZoom;
    private readonly _boundWindowResize = () => {
        this._persistence.scheduleSave();
    };

    constructor(
        private readonly _bridge: IBridge,
        private readonly _tracer: WindowServiceLogger,
        private readonly _runtime: WindowRuntime = createDefaultWindowRuntime(),
    ) {
        this._nativeHelper = new WindowNativeBridgeHelper(_bridge);
        this._actions = new WindowServiceActions({
            bridge: _bridge,
            runtime: _runtime,
            tracer: this._tracer,
            beforeClose: () => this._beforeClose,
        });
        this._zoomService = new WindowServiceZoom({
            bridge: _bridge,
            runtime: _runtime,
            tracer: this._tracer,
            getSettingsStore: () => this._uiSettingsService,
            minZoom: this._MIN_ZOOM,
            maxZoom: this._MAX_ZOOM,
        });
        this._persistence = new WindowServicePersistence({
            bridge: _bridge,
            runtime: _runtime,
            tracer: this._tracer,
            nativeHelper: this._nativeHelper,
            onResize: this._boundWindowResize,
            isDestroyed: () => this._isDestroyed,
        });
        this._policyService = new WindowServicePolicy({
            bridge: _bridge,
            runtime: _runtime,
            tracer: this._tracer,
            getCurrentZoom: () => this._currentZoom,
            setZoom: async (zoom) => this.setZoom(zoom),
            zoomService: this._zoomService,
        });
    }

    public setBeforeCloseHook(hook: (() => Promise<void>) | null): void {
        this._beforeClose = hook;
    }

    /**
     * Initializes the window service by retrieving the current zoom level from the host.
     */
    public async init(initialConfig?: IWindowConfig, initialZoom?: number): Promise<void> {
        this._isDestroyed = false;
        // Load fallback from UISettingsService (injected before init) or default to 1
        const fallbackZoom = this._uiSettingsService?.getZoomLevel() ?? 1;

        if (this._bridge.isTauri()) {
            try {
                // Use pre-loaded config or fetch it
                this._config =
                    initialConfig ??
                    (await this._bridge.invoke<IWindowConfig>('get_window_config'));

                // Update breakpoints from backend (placeholder/not used in UI yet)
                this._tracer.info(`[WindowService] Loaded config: ${JSON.stringify(this._config)}`);

                // Use pre-loaded initialZoom or determine it
                const zoom =
                    initialZoom ??
                    (await this._zoomService.getInitialZoomWithFallback(fallbackZoom));
                await this.setZoom(zoom);
            } catch (e) {
                this._tracer.warn(
                    `[WindowService] Failed to get initial window data, using fallback: ${String(e)}`,
                );
                await this.setZoom(fallbackZoom);
            }
            this._runtime.setAppZoomCss('1');

            // Initialize persistence listeners
            this._persistence.initWindowListeners();
        } else {
            // Web Fallback: Load from localStorage or default to 1
            this._currentZoom = fallbackZoom;
            this._runtime.setAppZoomCss(this._currentZoom.toFixed(3));

            // Enable Ctrl + Scroll implementation for Web Browser
            this._persistence.bindWebWheelHandler((delta) => {
                void this.changeZoom(delta);
            });
        }
    }

    public destroy(): void {
        this._isDestroyed = true;
        this._persistence.destroy();
    }

    // --- Window Actions ---

    /**
     * Minimizes the application window.
     */
    public async minimize(): Promise<void> {
        await this._actions.minimize();
    }

    /**
     * Toggles the maximized state of the window.
     */
    public async toggleMaximize(): Promise<void> {
        await this._actions.toggleMaximize();
    }

    /**
     * Closes the application window or browser tab.
     */
    public async close(): Promise<void> {
        await this._actions.close();
    }

    /**
     * Hides the window to the system tray.
     */
    public async hideToTray(): Promise<void> {
        await this._actions.hideToTray(async () => this.minimize());
    }

    /**
     * Shows and focuses the application window.
     */
    public async show(): Promise<void> {
        await this._actions.show();
    }

    // --- Zoom ---

    /**
     * Injects the UISettingsService dependency.
     */
    public setUISettingsService(uiSettingsService: WindowZoomSettingsStore): void {
        this._uiSettingsService = uiSettingsService;
    }

    /**
     * Sets the webview zoom level.
     */
    public async setZoom(zoom: number): Promise<number> {
        this._currentZoom = await this._zoomService.setZoom(zoom);
        return this._currentZoom;
    }

    /**
     * Retrieves the current zoom level.
     */
    public getZoom(): number {
        return this._currentZoom;
    }

    /**
     * Increments/decrements the current zoom level.
     */
    public changeZoom(delta: number): Promise<number> {
        return this.setZoom(this._currentZoom + delta);
    }

    // --- Monitoring State ---

    /**
     * Notifies the backend of a change in system monitoring state.
     */
    public async setMonitoringPaused(paused: boolean): Promise<void> {
        await this._actions.setMonitoringPaused(paused);
    }

    // --- Small Screen Helpers ---

    /**
     * Determines if the current screen resolution is below a given threshold.
     */
    /**
     * Determines the window policy (isSmallScreen, showWarning) based on current state.
     * The logic is entirely handled by the backend.
     */
    public async checkPolicy(): Promise<IWindowPolicy> {
        return this._policyService.checkPolicy();
    }

    /**
     * Checks if the resolution has changed and handles it if so.
     * Synchronous check for immediate detection during resize/move.
     */
    public checkResolutionChange(): void {
        this._policyService.checkResolutionChange();
    }

    /**
     * Returns the window configuration (breakpoints, thresholds).
     */
    public getConfig(): IWindowConfig | null {
        return this._config;
    }

    /**
     * Resizes and centers the application window.
     */
    public async setSize(width: number, height: number): Promise<void> {
        if (this._bridge.isTauri()) {
            try {
                await this._nativeHelper.setSizeAndCenter(width, height);
            } catch (e) {
                this._tracer.warn(`[WindowService] setSize failed: ${String(e)}`);
            }
        }
    }

    /**
     * Checks if the window is currently maximized.
     */
    public async isMaximized(): Promise<boolean> {
        if (this._bridge.isTauri()) {
            try {
                return await this._nativeHelper.isMaximized();
            } catch {
                return false;
            }
        }
        return false;
    }

    // --- Persistence ---

    /**
     * Schedules a debounced save of the window state.
     * Exposed for StateManager registration.
     */
    public scheduleSave(): void {
        this._persistence.scheduleSave();
    }

    /**
     * Persists the current window state (size, position, maximized) to the backend.
     * Exposed for StateManager registration.
     */
    public async saveAsync(): Promise<void> {
        await this._persistence.saveWindowState();
    }

    /**
     * Immediate window state save (fire-and-forget).
     * Exposed for StateManager registration.
     */
    public saveImmediate(): void {
        void this._persistence.saveWindowState();
    }
}
