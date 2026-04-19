import { type IApp } from '@/shared/types/coreTypes';

export {};

declare global {
    var __APP_VERSION__: string;

    var __TAURI__: {
        core: {
            invoke: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
        };
        invoke: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
        event: {
            listen: <T>(
                _event: string,
                _handler: (_event: { payload: T }) => void,
            ) => Promise<() => void>;
        };
        window: {
            getCurrentWindow: () => {
                isMaximized: () => Promise<boolean>;
                setSize: (_size: { width: number; height: number }) => Promise<void>;
                center: () => Promise<void>;
            };
            LogicalSize: new (_width: number, _height: number) => { width: number; height: number };
        };
    };
    var __TAURI_INTERNALS__:
        | {
              invoke?: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
              transformCallback?: (cb: unknown, once?: boolean) => string;
          }
        | undefined;

    var openModuleSettings: (_app: IApp) => void;

    interface Window {
        __TAURI__: typeof __TAURI__;
        __TAURI_INTERNALS__: typeof __TAURI_INTERNALS__;
        openModuleSettings: typeof openModuleSettings;
    }
}
