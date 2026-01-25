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
            };
            LogicalSize: new (w: number, h: number) => unknown;
        };
        dpi?: {
            LogicalSize: new (w: number, h: number) => unknown;
        };
    };
}

export class WindowService {
    private readonly _widthBreakpoints = {
        compact: 600,
        medium: 900,
        large: 1200,
    };
    private readonly _defaultScale = 1;
    private _currentZoom: number = 1;
    private readonly _MIN_ZOOM = 0.5;
    private readonly _MAX_ZOOM = 2;
    private _saveTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly _tauri: TauriProvider) {}

    /**
     * Initializes the window service by retrieving the current zoom level from the host.
     */
    public async init(): Promise<void> {
        if (this._tauri.isTauri()) {
            try {
                // Get initial zoom with timeout
                const zoomPromise = this._tauri.invoke<number>('get_webview_zoom');
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout getting zoom')), 1000),
                );

                const zoom: unknown = await Promise.race([zoomPromise, timeoutPromise]);

                if (typeof zoom === 'number') {
                    this._currentZoom = zoom;
                }
            } catch (e) {
                console.warn('[WindowService] Failed to get initial zoom (or timeout):', e);
            }
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
                    await new Promise(r => setTimeout(r, 300)); // Wait before retry
                }
            }
        }
        console.error('[WindowService] All show_window attempts failed. Continuing anyway.');
    }

    // --- Zoom ---

    /**
     * Sets the webview zoom level.
     */
    public async setZoom(zoom: number): Promise<number> {
        this._currentZoom = Math.max(this._MIN_ZOOM, Math.min(this._MAX_ZOOM, zoom));

        if (this._tauri.isTauri()) {
            try {
                await this._tauri.invoke('set_webview_zoom', { zoom: this._currentZoom });
            } catch (e) {
                console.error('[WindowService] Zoom error:', e);
            }
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
    public detectSmallScreen(minWidth: number = 1400, minHeight: number = 900): boolean {
        const win = globalThis as unknown as IWindowGlobal;
        win.updateMonitorPanelVisibility = (v: boolean) => this._toggleMonitorPanel(v);
        win.updateSpeedDisplay?.(0, 0);
        const screenWidth = globalThis.screen.availWidth || globalThis.screen.width;
        const screenHeight = globalThis.screen.availHeight || globalThis.screen.height;
        return screenWidth < minWidth || screenHeight < minHeight;
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
                     const LogicalSize = win.__TAURI__.window.LogicalSize || (win.__TAURI__.dpi ? win.__TAURI__.dpi.LogicalSize : null);
                     if (LogicalSize) {
                         await appWindow.setSize(new LogicalSize(width, height));
                         await appWindow.center();
                     }
                }
             } catch(e) {
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
             } catch { return false; }
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
}
