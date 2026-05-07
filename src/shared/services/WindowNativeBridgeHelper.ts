import type { IBridge } from '@/shared/types/IBridge';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

type TauriWindowHandle = ReturnType<typeof getCurrentWindow>;

type WindowNativeRuntime = {
    getCurrentWindow: () => TauriWindowHandle;
    createLogicalSize: (
        width: number,
        height: number,
    ) => Parameters<TauriWindowHandle['setSize']>[0];
};

function createDefaultWindowNativeRuntime(): WindowNativeRuntime {
    return {
        getCurrentWindow,
        createLogicalSize: (width, height) => new LogicalSize(width, height),
    };
}

export class WindowNativeBridgeHelper {
    public constructor(
        private readonly _bridge: IBridge,
        private readonly _runtime: WindowNativeRuntime = createDefaultWindowNativeRuntime(),
    ) {}

    public isAvailable(): boolean {
        return this._bridge.isTauri();
    }

    public async setSizeAndCenter(width: number, height: number): Promise<void> {
        if (!this.isAvailable()) {
            return;
        }

        const appWindow = this._runtime.getCurrentWindow();
        await appWindow.setSize(this._runtime.createLogicalSize(width, height));
        await appWindow.center();
    }

    public async isMaximized(): Promise<boolean> {
        if (!this.isAvailable()) {
            return false;
        }

        const appWindow = this._runtime.getCurrentWindow();
        return await appWindow.isMaximized();
    }

    public async saveWindowState(): Promise<void> {
        if (!this.isAvailable()) {
            return;
        }

        const appWindow = this._runtime.getCurrentWindow();
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
}
