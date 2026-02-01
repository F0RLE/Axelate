/**
 * @module core/services/WindowService
 * @description Service for managing application window behavior, zoom, and display states
 */

import { TauriProvider } from './TauriProvider';

interface IWindowGlobal {
    windowService?: WindowService;
    toggleMonitorBtn?: (cb: (visible: boolean) => void) => void;
    updateMonitorPanelVisibility?: (visible: boolean) => void;
    updateSpeedDisplay?: (up: number, down: number) => void;
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
    private _widthBreakpoints = {
        compact: 600,
        medium: 900,
        large: 1200,
    };
    private readonly _defaultScale = 1;
    private _currentZoom = 1;
    private _lastResolutionKey = '';
    private readonly _MIN_ZOOM = 0.5;
    private readonly _MAX_ZOOM = 3;
    private _saveWindowTimer: ReturnType<typeof setTimeout> | null = null;
    private _config: IWindowConfig | null = null;

    constructor(private readonly _tauri: TauriProvider) {}

    /**
     * Initializes the window service by retrieving the current zoom level from the host.
     */
    public async init(initialConfig?: IWindowConfig, initialZoom?: number): Promise<void> {
        // Load fallback from localStorage
        const saved = localStorage.getItem('axelate_zoom');
        let fallbackZoom = 1;
        if (saved) {
            fallbackZoom = Number.parseFloat(saved) || 1;
        }

        if (this._tauri.isTauri()) {
            try {
                // Use pre-loaded config or fetch it
                this._config = initialConfig || (await this._tauri.invoke<IWindowConfig>('get_window_config'));
                
                // Update breakpoints from backend
                if (this._config) {
                    this._widthBreakpoints = {
                        compact: this._config.breakpoints.compact,
                        medium: this._config.breakpoints.medium,
                        large: this._config.breakpoints.large,
                    };
                }
                
                console.log('[WindowService] Loaded config:', this._config);

                // Use pre-loaded initialZoom or determine it
                const zoom = initialZoom ?? (await this._getInitialZoomWithFallback(fallbackZoom));
                await this.setZoom(zoom);
            } catch (e) {
                console.warn(
                    '[WindowService] Failed to get initial window data, using fallback:',
                    e,
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
            window.addEventListener(
                'wheel',
                (e) => {
                    if (e.ctrlKey) {
                        e.preventDefault();
                        // Zoom Step 0.1
                        const delta = e.deltaY > 0 ? -0.1 : 0.1;
                        this.changeZoom(delta);
                    }
                },
                { passive: false },
            );
        }
    }

    // --- Window Actions ---

    /**
     * Minimizes the application window.
     */
    public async minimize(): Promise<void> {
        if (this._tauri.isTauri()) {
            await this._tauri.invoke('minimize_window');
        } else {
            console.log('[WindowService] minimize (mock)');
        }
    }

    /**
     * Toggles the maximized state of the window.
     */
    public async toggleMaximize(): Promise<void> {
        if (this._tauri.isTauri()) {
            await this._tauri.invoke('maximize_window');
        } else {
            console.log('[WindowService] toggleMaximize (mock)');
        }
    }

    /**
     * Closes the application window or browser tab.
     */
    public async close(): Promise<void> {
        if (this._tauri.isTauri()) {
            await this._tauri.invoke('close_window');
        } else {
            globalThis.close();
        }
    }

    /**
     * Hides the window to the system tray.
     */
    public async hideToTray(): Promise<void> {
        if (this._tauri.isTauri()) {
            try {
                await this._tauri.invoke('hide_window');
            } catch {
                // Fallback
                await this.minimize();
            }
        } else {
            console.log('[WindowService] hideToTray (mock)');
        }
    }

    /**
     * Shows and focuses the application window.
     */
    public async show(): Promise<void> {
        if (!this._tauri.isTauri()) {
            console.log('[WindowService] Not in Tauri, skipping native show');
            return;
        }

        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this._tauri.invoke('show_window');

                // Try to set focus, but don't fail if command missing
                try {
                    await this._tauri.invoke('set_focus');
                } catch {
                    // set_focus command not found - skipping focus step
                }

                return; // Success
            } catch (e) {
                console.warn(`[WindowService] show_window attempt ${i + 1} failed:`, e);
                if (i < maxRetries - 1) {
                    await new Promise((r) => setTimeout(r, 300)); // Wait before retry
                }
            }
        }
        console.error('[WindowService] All show_window attempts failed. Continuing anyway.');
    }

    // --- Zoom ---

    private _stateService: {
        setZoomLevel: (z: number) => void;
        getZoomLevel: () => number;
        getResolutionZoom: (k: string) => number | undefined;
        setResolutionZoom: (k: string, z: number) => void;
    } | null = null;

    /**
     * Injects the StateService dependency.
     */
    public setStateService(stateService: {
        setZoomLevel: (z: number) => void;
        getZoomLevel: () => number;
        getResolutionZoom: (k: string) => number | undefined;
        setResolutionZoom: (k: string, z: number) => void;
    }): void {
        this._stateService = stateService;
    }

    /**
     * Sets the webview zoom level.
     */
    public async setZoom(zoom: number): Promise<number> {
        this._currentZoom = Math.max(this._MIN_ZOOM, Math.min(this._MAX_ZOOM, zoom));

        // Always save to localStorage as backup
        localStorage.setItem('axelate_zoom', this._currentZoom.toString());

        if (this._tauri.isTauri()) {
            try {
                await this._tauri.invoke('set_webview_zoom', {
                    zoom: this._currentZoom,
                });
            } catch (e) {
                console.error('[WindowService] Zoom error:', e);
            }
        }

        // Apply CSS Variable (for Web fallback UI scaling)
        if (this._tauri.isTauri()) {
            document.documentElement.style.setProperty('--app-zoom', '1');
        } else {
            document.documentElement.style.setProperty('--app-zoom', this._currentZoom.toFixed(3));
        }

        // Sync with StateService (DI) for frontend reactivity
        if (this._stateService) {
            this._stateService.setZoomLevel(this._currentZoom);
            this._stateService.setResolutionZoom(`${window.screen.width}x${window.screen.height}`, this._currentZoom);
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
        if (this._tauri.isTauri()) {
            try {
                await this._tauri.invoke('set_monitoring_paused', { paused });
                const win = globalThis as unknown as IWindowGlobal;
                win.windowService = this;
                win.toggleMonitorBtn?.((visible: boolean) => this._toggleMonitorPanel(visible));
            } catch {
                console.error('[WindowService] Failed to set monitoring state');
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
        const currentRes = `${window.screen.width}x${window.screen.height}`;
        if (currentRes !== this._lastResolutionKey && currentRes !== 'unknown') {
            console.log(
                `[WindowService] Resolution changed: ${this._lastResolutionKey} -> ${currentRes}`,
            );
            this._lastResolutionKey = currentRes;
            void this._handleResolutionChange();
        }

        if (!this._tauri.isTauri()) {
            return { isSmallScreen: false, showWarning: false };
        }

        try {
            return await this._tauri.invoke<IWindowPolicy>('get_window_policy');
        } catch (e) {
            console.error('[WindowService] Failed to fetch window policy:', e);
            return { isSmallScreen: false, showWarning: false };
        }
    }

    /**
     * Checks if the resolution has changed and handles it if so.
     * Synchronous check for immediate detection during resize/move.
     */
    public checkResolutionChange(): void {
        const currentRes = `${window.screen.width}x${window.screen.height}`;
        if (currentRes !== this._lastResolutionKey && currentRes !== 'unknown') {
            const oldRes = this._lastResolutionKey;
            this._lastResolutionKey = currentRes;
            console.log(`[WindowService] Resolution changed: ${oldRes} -> ${currentRes}`);
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
        if (this._tauri.isTauri()) {
            try {
                const win = globalThis as unknown as IWindowGlobal;
                if (win.__TAURI__?.window) {
                    const appWindow = win.__TAURI__.window.getCurrentWindow();
                    const LogicalSize =
                        win.__TAURI__.window.LogicalSize ||
                        (win.__TAURI__.dpi ? win.__TAURI__.dpi.LogicalSize : null);
                    if (LogicalSize) {
                        await appWindow.setSize(new LogicalSize(width, height));
                        await appWindow.center();
                    }
                }
            } catch (e) {
                console.warn('[WindowService] setSize failed', e);
            }
        }
    }

    /**
     * Checks if the window is currently maximized.
     */
    public async isMaximized(): Promise<boolean> {
        if (this._tauri.isTauri()) {
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

    /**
     * Dispatches a custom event to toggle the visibility of the monitoring panel.
     */
    private _toggleMonitorPanel(visible: boolean): void {
        console.log('[WindowService] toggleMonitorPanel:', visible);
        const event = new CustomEvent('monitor:toggle', { detail: { visible } });
        globalThis.dispatchEvent(event);
    }

    // --- Persistence ---

    /**
     * Initializes listeners for window resize and move events to persist state.
     */
    private _initWindowListeners(): void {
        // DOM Resize event covers window resizing and maximizing
        window.addEventListener('resize', () => this._scheduleSaveWindowState());

        // Tauri move event (if supported) covers window dragging
        void this._tauri.listen('tauri://move', () => this._scheduleSaveWindowState());
    }

    /**
     * Schedules a debounced save of the window state.
     */
    private _scheduleSaveWindowState(): void {
        if (this._saveWindowTimer) {
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
        if (!this._tauri.isTauri()) return;

        try {
            const win = globalThis as unknown as IWindowGlobal;
            if (win.__TAURI__?.window) {
                const appWindow = win.__TAURI__.window.getCurrentWindow();
                const isMaximized = await appWindow.isMaximized();

                // Save maximized state
                await this._tauri.invoke('save_maximized_state', { maximized: isMaximized });

                // Only save specific dimensions if NOT maximized
                // (Restoring a maximized window with maximized=true is enough,
                // we don't want to overwrite the "restore" size with the screen size)
                if (!isMaximized) {
                    const size = await appWindow.innerSize();
                    const pos = await appWindow.outerPosition();

                    await this._tauri.invoke('save_window_size', {
                        width: size.width,
                        height: size.height,
                    });

                    await this._tauri.invoke('save_window_position', {
                        x: pos.x,
                        y: pos.y,
                    });
                }
            }
        } catch (e) {
            console.warn('[WindowService] Failed to save window state:', e);
        }
    }

    /**
     * Helper to retrieve initial zoom with timeout and state service priority.
     */
    private async _getInitialZoomWithFallback(fallback: number): Promise<number> {
        if (!this._tauri.isTauri()) return fallback;

        try {
            // Backend is the Source of Truth: It calculates and persists the zoom
            const zoom = await this._tauri.invoke<number>('get_resolution_zoom');

            if (typeof zoom === 'number' && zoom > 0) {
                return zoom;
            }
        } catch (e) {
            console.error('[WindowService] Failed to fetch backend zoom:', e);
        }

        return fallback;
    }

    /**
     * Fetches and applies the zoom level for the current resolution.
     * Used when the window moves between monitors.
     */
    private async _handleResolutionChange(): Promise<void> {
        if (!this._tauri.isTauri()) return;

        try {
            const zoom = await this._tauri.invoke<number>('get_resolution_zoom');

            if (typeof zoom === 'number' && zoom > 0 && zoom !== this._currentZoom) {
                console.log(`[WindowService] Applying zoom for new resolution: ${zoom}`);
                await this.setZoom(zoom);
            }
        } catch (e) {
            console.error('[WindowService] Resolution change zoom fetch failed:', e);
        }
    }
}
