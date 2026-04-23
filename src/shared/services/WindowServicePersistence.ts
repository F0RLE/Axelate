import type { IBridge } from '@/shared/types/IBridge';

import type { WindowNativeBridgeHelper } from './WindowNativeBridgeHelper';

type WindowPersistenceRuntime = {
    addEventListener: typeof globalThis.addEventListener;
    removeEventListener: typeof globalThis.removeEventListener;
};

type WindowPersistenceLogger = {
    warn: (message: string) => void;
};

type WindowServicePersistenceDeps = {
    bridge: IBridge;
    runtime: WindowPersistenceRuntime;
    tracer: WindowPersistenceLogger;
    nativeHelper: WindowNativeBridgeHelper;
    onResize: () => void;
    isDestroyed: () => boolean;
};

export class WindowServicePersistence {
    private _saveWindowTimer: ReturnType<typeof setTimeout> | null = null;
    private _moveUnlisten: (() => void) | null = null;
    private _windowListenersInitialized = false;
    private _webWheelHandler: ((e: WheelEvent) => void) | null = null;

    constructor(private readonly _deps: WindowServicePersistenceDeps) {}

    public initWindowListeners(): void {
        if (this._windowListenersInitialized) return;
        this._windowListenersInitialized = true;

        this._deps.runtime.addEventListener('resize', this._deps.onResize);

        void this._deps.bridge.listen('tauri://move', this._deps.onResize).then((unlisten) => {
            if (this._deps.isDestroyed()) {
                unlisten();
                return;
            }
            this._moveUnlisten = unlisten;
        });
    }

    public bindWebWheelHandler(onWheelZoom: (delta: number) => void): void {
        if (this._webWheelHandler !== null) {
            return;
        }

        this._webWheelHandler = (event: WheelEvent) => {
            if (event.ctrlKey) {
                event.preventDefault();
                const delta = event.deltaY > 0 ? -0.1 : 0.1;
                onWheelZoom(delta);
            }
        };
        this._deps.runtime.addEventListener('wheel', this._webWheelHandler, { passive: false });
    }

    public destroy(): void {
        if (this._saveWindowTimer !== null) {
            clearTimeout(this._saveWindowTimer);
            this._saveWindowTimer = null;
        }

        if (this._windowListenersInitialized) {
            this._deps.runtime.removeEventListener('resize', this._deps.onResize);
            this._windowListenersInitialized = false;
        }

        this._moveUnlisten?.();
        this._moveUnlisten = null;

        if (this._webWheelHandler !== null) {
            this._deps.runtime.removeEventListener('wheel', this._webWheelHandler);
            this._webWheelHandler = null;
        }
    }

    public scheduleSave(): void {
        if (this._saveWindowTimer !== null) {
            clearTimeout(this._saveWindowTimer);
        }
        this._saveWindowTimer = setTimeout(() => {
            void this.saveWindowState();
        }, 1000);
    }

    public async saveWindowState(): Promise<void> {
        if (!this._deps.bridge.isTauri()) return;

        try {
            await this._deps.nativeHelper.saveWindowState();
        } catch (error) {
            this._deps.tracer.warn(`[WindowService] Failed to save window state: ${String(error)}`);
        }
    }
}
