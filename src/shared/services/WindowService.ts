/**
 * @module core/services/WindowService
 * @description Service for managing application window behavior, zoom, and display states
 */

import { type IBridge } from '@/shared/types/IBridge';
import { tracer } from '@/infrastructure/logging/LoggerService';

interface IWindowGlobal {
    __TAURI__?: {
        window: {
            getCurrentWindow: () => {
                setSize: (size: unknown) => Promise<void>;
                center: () => Promise<void>;
                isMaximized: () => Promise<boolean>;
                innerSize: () => Promise<{ width: number; height: number }>;
                outerPosition: () => Promise<{ x: number; y: number }>;
            };
            LogicalSize: new (w: number, h: number) => unknown;
        };
        dpi?: {
            LogicalSize: new (w: number, h: number) => unknown;
        };
    };
}

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

export class WindowService {
    private _currentZoom = 1;
    private _lastResolutionKey = '';
    private readonly _MIN_ZOOM = 0.5;
    private readonly _MAX_ZOOM = 3;
    private _saveWindowTimer: ReturnType<typeof setTimeout> | null = null;
    private _config: IWindowConfig | null = null;
    private _moveUnlisten: (() => void) | null = null;
    private _windowListenersInitialized = false;
    private _webWheelHandler: ((e: WheelEvent) => void) | null = null;
    private _isDestroyed = false;
    private readonly _boundWindowResize = () => {
        this._scheduleSaveWindowState();
    };

    constructor(private readonly _bridge: IBridge) {}

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
                tracer.info(`[WindowService] Loaded config: ${JSON.stringify(this._config)}`);

                // Use pre-loaded initialZoom or determine it
                const zoom = initialZoom ?? (await this._getInitialZoomWithFallback(fallbackZoom));
                await this.setZoom(zoom);
            } catch (e) {
                tracer.warn(
                    `[WindowService] Failed to get initial window data, using fallback: ${String(e)}`,
                );
                await this.setZoom(fallbackZoom);
            }
            document.documentElement.style.setProperty('--app-zoom', '1');

            // Initialize persistence listeners
            this._initWindowListeners();
        } else {
            // Web Fallback: Load from localStorage or default to 1
            this._currentZoom = fallbackZoom;
            document.documentElement.style.setProperty('--app-zoom', this._currentZoom.toFixed(3));

            // Enable Ctrl + Scroll implementation for Web Browser
            if (this._webWheelHandler === null) {
                this._webWheelHandler = (e: WheelEvent) => {
                    if (e.ctrlKey) {
                        e.preventDefault();
                        // Zoom Step 0.1
                        const delta = e.deltaY > 0 ? -0.1 : 0.1;
                        void this.changeZoom(delta);
                    }
                };
                window.addEventListener('wheel', this._webWheelHandler, { passive: false });
            }
        }
    }

    public destroy(): void {
        this._isDestroyed = true;
        if (this._saveWindowTimer !== null) {
            clearTimeout(this._saveWindowTimer);
            this._saveWindowTimer = null;
        }

        if (this._windowListenersInitialized) {
            window.removeEventListener('resize', this._boundWindowResize);
            this._windowListenersInitialized = false;
        }

        this._moveUnlisten?.();
        this._moveUnlisten = null;

        if (this._webWheelHandler !== null) {
            window.removeEventListener('wheel', this._webWheelHandler);
            this._webWheelHandler = null;
        }
    }

    // --- Window Actions ---

    /**
     * Minimizes the application window.
     */
    public async minimize(): Promise<void> {
        if (this._bridge.isTauri()) {
            await this._bridge.invoke('minimize_window');
        } else {
            tracer.info('[WindowService] minimize (mock)');
        }
    }

    /**
     * Toggles the maximized state of the window.
     */
    public async toggleMaximize(): Promise<void> {
        if (this._bridge.isTauri()) {
            await this._bridge.invoke('maximize_window');
        } else {
            tracer.info('[WindowService] toggleMaximize (mock)');
        }
    }

    /**
     * Closes the application window or browser tab.
     */
    public async close(): Promise<void> {
        if (this._bridge.isTauri()) {
            await this._bridge.invoke('close_window');
        } else {
            globalThis.close();
        }
    }

    /**
     * Hides the window to the system tray.
     */
    public async hideToTray(): Promise<void> {
        if (this._bridge.isTauri()) {
            try {
                await this._bridge.invoke('hide_window');
            } catch {
                // Fallback
                await this.minimize();
            }
        } else {
            tracer.info('[WindowService] hideToTray (mock)');
        }
    }

    /**
     * Shows and focuses the application window.
     */
    public async show(): Promise<void> {
        if (!this._bridge.isTauri()) {
            tracer.info('[WindowService] Not in Tauri, skipping native show');
            return;
        }

        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this._bridge.invoke('show_window');

                // Try to set focus, but don't fail if command missing
                try {
                    await this._bridge.invoke('set_focus');
                } catch {
                    // set_focus command not found - skipping focus step
                }

                return; // Success
            } catch (e) {
                tracer.warn(
                    `[WindowService] show_window attempt ${(i + 1).toString()} failed: ${String(e)}`,
                );
                if (i < maxRetries - 1) {
                    await new Promise((r) => setTimeout(r, 300)); // Wait before retry
                }
            }
        }
        tracer.error('[WindowService] All show_window attempts failed. Continuing anyway.');
    }

    // --- Zoom ---

    private _uiSettingsService: {
        setZoomLevel: (z: number) => void;
        getZoomLevel: () => number;
        getResolutionZoom: (k: string) => number | undefined;
        setResolutionZoom: (k: string, z: number) => void;
    } | null = null;

    /**
     * Injects the UISettingsService dependency.
     */
    public setUISettingsService(uiSettingsService: {
        setZoomLevel: (z: number) => void;
        getZoomLevel: () => number;
        getResolutionZoom: (k: string) => number | undefined;
        setResolutionZoom: (k: string, z: number) => void;
    }): void {
        this._uiSettingsService = uiSettingsService;
    }

    /**
     * Sets the webview zoom level.
     */
    public async setZoom(zoom: number): Promise<number> {
        this._currentZoom = Math.max(this._MIN_ZOOM, Math.min(this._MAX_ZOOM, zoom));

        // Persist via UISettingsService (if injected — always true in normal boot)

        if (this._bridge.isTauri()) {
            try {
                await this._bridge.invoke('set_webview_zoom', {
                    zoom: this._currentZoom,
                });
            } catch (e) {
                tracer.error(`[WindowService] Zoom error: ${String(e)}`);
            }
        }

        // Apply CSS Variable (for Web fallback UI scaling)
        if (this._bridge.isTauri()) {
            document.documentElement.style.setProperty('--app-zoom', '1');
        } else {
            document.documentElement.style.setProperty('--app-zoom', this._currentZoom.toFixed(3));
        }

        // Sync with UISettingsService (DI) for frontend reactivity
        if (this._uiSettingsService !== null) {
            this._uiSettingsService.setZoomLevel(this._currentZoom);
            this._uiSettingsService.setResolutionZoom(
                `${window.screen.width.toString()}x${window.screen.height.toString()}`,
                this._currentZoom,
            );
        }

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
        if (this._bridge.isTauri()) {
            try {
                await this._bridge.invoke('set_monitoring_paused', { paused });
            } catch {
                tracer.error('[WindowService] Failed to set monitoring state');
            }
        }
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
        // Check if resolution changed (monitor switch)
        const currentRes = `${window.screen.width.toString()}x${window.screen.height.toString()}`;
        if (currentRes !== this._lastResolutionKey && currentRes !== 'unknown') {
            tracer.info(
                `[WindowService] Resolution changed: ${this._lastResolutionKey} -> ${currentRes}`,
            );
            this._lastResolutionKey = currentRes;
            void this._handleResolutionChange();
        }

        if (!this._bridge.isTauri()) {
            return { isSmallScreen: false, showWarning: false };
        }

        try {
            return await this._bridge.invoke<IWindowPolicy>('get_window_policy');
        } catch (e) {
            tracer.error(`[WindowService] Failed to fetch window policy: ${String(e)}`);
            return { isSmallScreen: false, showWarning: false };
        }
    }

    /**
     * Checks if the resolution has changed and handles it if so.
     * Synchronous check for immediate detection during resize/move.
     */
    public checkResolutionChange(): void {
        const currentRes = `${window.screen.width.toString()}x${window.screen.height.toString()}`;
        if (currentRes !== this._lastResolutionKey && currentRes !== 'unknown') {
            const oldRes = this._lastResolutionKey;
            this._lastResolutionKey = currentRes;
            tracer.info(`[WindowService] Resolution changed: ${oldRes} -> ${currentRes}`);
            void this._handleResolutionChange();
        }
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
                const win = globalThis as unknown as IWindowGlobal;
                if (win.__TAURI__?.window) {
                    const appWindow = win.__TAURI__.window.getCurrentWindow();
                    const LogicalSize = win.__TAURI__.window.LogicalSize;
                    await appWindow.setSize(new LogicalSize(width, height));
                    await appWindow.center();
                }
            } catch (e) {
                tracer.warn(`[WindowService] setSize failed: ${String(e)}`);
            }
        }
    }

    /**
     * Checks if the window is currently maximized.
     */
    public async isMaximized(): Promise<boolean> {
        if (this._bridge.isTauri()) {
            try {
                const win = globalThis as unknown as IWindowGlobal;
                if (win.__TAURI__?.window) {
                    return await win.__TAURI__.window.getCurrentWindow().isMaximized();
                }
            } catch {
                return false;
            }
        }
        return false;
    }

    // --- Persistence ---

    /**
     * Initializes listeners for window resize and move events to persist state.
     */
    private _initWindowListeners(): void {
        if (this._windowListenersInitialized) return;
        this._windowListenersInitialized = true;

        // DOM Resize event covers window resizing and maximizing
        window.addEventListener('resize', this._boundWindowResize);

        // Tauri move event (if supported) covers window dragging
        void this._bridge.listen('tauri://move', this._boundWindowResize).then((unlisten) => {
            if (this._isDestroyed) {
                unlisten();
                return;
            }
            this._moveUnlisten = unlisten;
        });
    }

    /**
     * Schedules a debounced save of the window state.
     * Exposed for StateManager registration.
     */
    public scheduleSave(): void {
        this._scheduleSaveWindowState();
    }

    /**
     * Persists the current window state (size, position, maximized) to the backend.
     * Exposed for StateManager registration.
     */
    public async saveAsync(): Promise<void> {
        await this._saveWindowState();
    }

    /**
     * Immediate window state save (fire-and-forget).
     * Exposed for StateManager registration.
     */
    public saveImmediate(): void {
        void this._saveWindowState();
    }

    /**
     * Schedules a debounced save of the window state.
     */
    private _scheduleSaveWindowState(): void {
        if (this._saveWindowTimer !== null) {
            clearTimeout(this._saveWindowTimer);
        }
        this._saveWindowTimer = setTimeout(() => {
            void this._saveWindowState();
        }, 1000);
    }

    /**
     * Persists the current window state (size, position, maximized) to the backend.
     */
    private async _saveWindowState(): Promise<void> {
        /* v8 ignore next */
        if (!this._bridge.isTauri()) return;

        try {
            const win = globalThis as unknown as IWindowGlobal;
            if (win.__TAURI__?.window) {
                const appWindow = win.__TAURI__.window.getCurrentWindow();
                const isMaximized = await appWindow.isMaximized();

                // Save maximized state
                await this._bridge.invoke('save_maximized_state', { maximized: isMaximized });

                // Only save specific dimensions if NOT maximized
                // (Restoring a maximized window with maximized=true is enough,
                // we don't want to overwrite the "restore" size with the screen size)
                if (!isMaximized) {
                    const size = await appWindow.innerSize();
                    const pos = await appWindow.outerPosition();

                    await this._bridge.invoke('save_window_size', {
                        width: size.width,
                        height: size.height,
                    });

                    await this._bridge.invoke('save_window_position', {
                        x: pos.x,
                        y: pos.y,
                    });
                }
            }
        } catch (e) {
            tracer.warn(`[WindowService] Failed to save window state: ${String(e)}`);
        }
    }

    /**
     * Helper to retrieve initial zoom with timeout and state service priority.
     */
    private async _getInitialZoomWithFallback(fallback: number): Promise<number> {
        /* v8 ignore next */
        if (!this._bridge.isTauri()) return fallback;

        try {
            // Backend is the Source of Truth: It calculates and persists the zoom
            const zoom = await this._bridge.invoke<number>('get_resolution_zoom');

            if (typeof zoom === 'number' && zoom > 0) {
                return zoom;
            }
        } catch (e) {
            tracer.error(`[WindowService] Failed to fetch backend zoom: ${String(e)}`);
        }

        return fallback;
    }

    /**
     * Fetches and applies the zoom level for the current resolution.
     * Used when the window moves between monitors.
     */
    private async _handleResolutionChange(): Promise<void> {
        if (!this._bridge.isTauri()) return;

        try {
            const zoom = await this._bridge.invoke<number>('get_resolution_zoom');

            if (typeof zoom === 'number' && zoom > 0 && zoom !== this._currentZoom) {
                await this.setZoom(zoom);
            }
        } catch (e) {
            tracer.error(`[WindowService] Resolution change zoom fetch failed: ${String(e)}`);
        }
    }
}
