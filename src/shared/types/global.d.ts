export {};

declare global {
    var __APP_VERSION__: string;

    var __TAURI_INTERNALS__:
        | {
              invoke?: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
              transformCallback?: (cb: unknown, once?: boolean) => string;
          }
        | undefined;

    interface Window {
        __TAURI_INTERNALS__: typeof __TAURI_INTERNALS__;
    }
}
