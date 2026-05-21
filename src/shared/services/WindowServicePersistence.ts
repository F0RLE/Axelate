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
