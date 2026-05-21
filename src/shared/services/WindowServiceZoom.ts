import type { IBridge } from '@/shared/types/IBridge';

export type WindowZoomSettingsStore = {
    setZoomLevel: (z: number) => void;
    getZoomLevel: () => number;
    getResolutionZoom: (k: string) => number | undefined;
    setResolutionZoom: (k: string, z: number) => void;
};

export type WindowZoomApplyOptions = {
    syncNativeZoom?: boolean;
    effectiveZoom?: number;
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

    public async setZoom(zoom: number, options: WindowZoomApplyOptions = {}): Promise<number> {
        const nextZoom = Math.max(this._deps.minZoom, Math.min(this._deps.maxZoom, zoom));
        const effectiveZoom = Math.max(
            this._deps.minZoom,
            Math.min(this._deps.maxZoom, options.effectiveZoom ?? nextZoom),
        );
        const shouldSyncNativeZoom = options.syncNativeZoom ?? false;

        if (shouldSyncNativeZoom && this._deps.bridge.isTauri()) {
            try {
                await this._deps.bridge.invoke('set_webview_zoom', {
                    zoom: effectiveZoom,
                });
            } catch (error) {
                this._deps.tracer.error(`[WindowService] Zoom error: ${String(error)}`);
            }
        }

        this._deps.runtime.setAppZoomCss(
            shouldSyncNativeZoom && this._deps.bridge.isTauri()
                ? '1.000'
                : effectiveZoom.toFixed(3),
        );

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

    public async persistZoom(zoom: number): Promise<void> {
        const nextZoom = Math.max(this._deps.minZoom, Math.min(this._deps.maxZoom, zoom));

        if (this._deps.bridge.isTauri()) {
            try {
                await this._deps.bridge.invoke('save_current_resolution_zoom', {
                    zoom: nextZoom,
                });
            } catch (error) {
                this._deps.tracer.error(`[WindowService] Zoom persist error: ${String(error)}`);
            }
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
    }

    public async getInitialZoomWithFallback(fallback: number): Promise<number> {
        if (!this._deps.bridge.isTauri()) return fallback;

        try {
            const zoom = await this._deps.bridge.invoke<number>('get_resolution_zoom');

            if (typeof zoom === 'number' && zoom > 0) {
                return zoom;
            }
        } catch (error) {
            this._deps.tracer.error(
                `[WindowService] Failed to fetch backend zoom: ${String(error)}`,
            );
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
