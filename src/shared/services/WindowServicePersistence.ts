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
    private _saveChain: Promise<void> = Promise.resolve();

    constructor(private readonly _deps: WindowServicePersistenceDeps) {}

    public initWindowListeners(): void {
        if (this._windowListenersInitialized) return;
        this._windowListenersInitialized = true;

        this._deps.runtime.addEventListener('resize', this._deps.onResize);

        void this._deps.bridge
            .listen('tauri://move', this._deps.onResize)
            .then((unlisten) => {
                if (this._deps.isDestroyed()) {
                    unlisten();
                    return;
                }
                this._moveUnlisten = unlisten;
            })
            .catch((error: unknown) => {
                this._deps.tracer.warn(
                    `[WindowService] Failed to subscribe to window move events: ${String(error)}`,
                );
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
            this._saveWindowTimer = null;
            void this.saveWindowState().catch(() => {
                // saveWindowState already logs the concrete backend/native error.
            });
        }, 1000);
    }

    public async saveWindowState(): Promise<void> {
        if (this._saveWindowTimer !== null) {
            clearTimeout(this._saveWindowTimer);
            this._saveWindowTimer = null;
        }

        if (!this._deps.bridge.isTauri()) return;

        const save = this._saveChain.then(async () => {
            if (this._deps.isDestroyed()) return;
            await this._deps.nativeHelper.saveWindowState();
        });
        this._saveChain = save.catch(() => {
            // Keep the chain usable after a failed save.
        });

        try {
            await save;
        } catch (error) {
            this._deps.tracer.warn(`[WindowService] Failed to save window state: ${String(error)}`);
            throw error;
        }
    }
}
