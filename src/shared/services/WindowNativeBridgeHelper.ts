import type { IBridge } from '@/shared/types/IBridge';

type WindowSize = { width: number; height: number };
type WindowPosition = { x: number; y: number };

type TauriWindowHandle = {
    setSize: (size: unknown) => Promise<void>;
    center: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    innerSize: () => Promise<WindowSize>;
    outerPosition: () => Promise<WindowPosition>;
};

type TauriWindowApi = {
    getCurrentWindow: () => TauriWindowHandle;
    LogicalSize: new (w: number, h: number) => unknown;
};

type TauriWindowGlobal = {
    __TAURI__?: {
        window?: TauriWindowApi;
    };
};

type WindowNativeRuntime = {
    getWindowApi: () => TauriWindowApi | null;
};

function createDefaultWindowNativeRuntime(): WindowNativeRuntime {
    return {
        getWindowApi: () => {
            const globalWindow = globalThis as unknown as TauriWindowGlobal;
            return globalWindow.__TAURI__?.window ?? null;
        },
    };
}

export class WindowNativeBridgeHelper {
    public constructor(
        private readonly _bridge: IBridge,
        private readonly _runtime: WindowNativeRuntime = createDefaultWindowNativeRuntime(),
    ) {}

    public isAvailable(): boolean {
        return this._getWindowApi() !== null;
    }

    public async setSizeAndCenter(width: number, height: number): Promise<void> {
        const windowApi = this._getWindowApi();
        if (windowApi === null) {
            return;
        }

        const appWindow = windowApi.getCurrentWindow();
        await appWindow.setSize(new windowApi.LogicalSize(width, height));
        await appWindow.center();
    }

    public async isMaximized(): Promise<boolean> {
        const appWindow = this._getCurrentWindow();
        if (appWindow === null) {
            return false;
        }

        return await appWindow.isMaximized();
    }

    public async saveWindowState(): Promise<void> {
        const appWindow = this._getCurrentWindow();
        if (appWindow === null) {
            return;
        }

        const maximized = await appWindow.isMaximized();
        await this._bridge.invoke('save_maximized_state', { maximized });

        if (maximized) {
            return;
        }

        const size = await appWindow.innerSize();
        const position = await appWindow.outerPosition();

        await this._bridge.invoke('save_window_size', {
            width: size.width,
            height: size.height,
        });
        await this._bridge.invoke('save_window_position', {
            x: position.x,
            y: position.y,
        });
    }

    private _getCurrentWindow(): TauriWindowHandle | null {
        const windowApi = this._getWindowApi();
        if (windowApi === null) {
            return null;
        }

        return windowApi.getCurrentWindow();
    }

    private _getWindowApi(): TauriWindowApi | null {
        return this._runtime.getWindowApi();
    }
}
