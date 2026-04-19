import type { IBridge } from '@/shared/types/IBridge';

export type WindowZoomSettingsStore = {
    setZoomLevel: (z: number) => void;
    getZoomLevel: () => number;
    getResolutionZoom: (k: string) => number | undefined;
    setResolutionZoom: (k: string, z: number) => void;
};

type WindowZoomRuntime = {
    getScreenSize: () => { width: number; height: number };
    setAppZoomCss: (zoom: string) => void;
};

type WindowZoomLogger = {
    error: (message: string) => void;
};

type WindowServiceZoomDeps = {
    bridge: IBridge;
    runtime: WindowZoomRuntime;
    tracer: WindowZoomLogger;
    getSettingsStore: () => WindowZoomSettingsStore | null;
    minZoom: number;
    maxZoom: number;
};

export class WindowServiceZoom {
    constructor(private readonly _deps: WindowServiceZoomDeps) {}

    public async setZoom(zoom: number): Promise<number> {
        const nextZoom = Math.max(this._deps.minZoom, Math.min(this._deps.maxZoom, zoom));

        if (this._deps.bridge.isTauri()) {
            try {
                await this._deps.bridge.invoke('set_webview_zoom', {
                    zoom: nextZoom,
                });
            } catch (error) {
                this._deps.tracer.error(`[WindowService] Zoom error: ${String(error)}`);
            }
        }

        if (this._deps.bridge.isTauri()) {
            this._deps.runtime.setAppZoomCss('1');
        } else {
            this._deps.runtime.setAppZoomCss(nextZoom.toFixed(3));
        }

        const settingsStore = this._deps.getSettingsStore();
        if (settingsStore !== null) {
            const screen = this._deps.runtime.getScreenSize();
            settingsStore.setZoomLevel(nextZoom);
            settingsStore.setResolutionZoom(
                `${screen.width.toString()}x${screen.height.toString()}`,
                nextZoom,
            );
        }

        return nextZoom;
    }

    public async getInitialZoomWithFallback(fallback: number): Promise<number> {
        if (!this._deps.bridge.isTauri()) return fallback;

        try {
            const zoom = await this._deps.bridge.invoke<number>('get_resolution_zoom');

            if (typeof zoom === 'number' && zoom > 0) {
                return zoom;
            }
        } catch (error) {
            this._deps.tracer.error(`[WindowService] Failed to fetch backend zoom: ${String(error)}`);
        }

        return fallback;
    }

    public async handleResolutionChange(currentZoom: number): Promise<number | null> {
        if (!this._deps.bridge.isTauri()) return null;

        try {
            const zoom = await this._deps.bridge.invoke<number>('get_resolution_zoom');

            if (typeof zoom === 'number' && zoom > 0 && zoom !== currentZoom) {
                return zoom;
            }
        } catch (error) {
            this._deps.tracer.error(
                `[WindowService] Resolution change zoom fetch failed: ${String(error)}`,
            );
        }

        return null;
    }
}
