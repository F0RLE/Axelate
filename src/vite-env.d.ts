/// <reference types="vite/client" />
/// <reference types="vitest" />

declare const __APP_VERSION__: string;

declare module '@tauri-apps/plugin-dialog' {
    export type DialogOpenOptions = Record<string, unknown>;
    export function open(options?: DialogOpenOptions): Promise<string | string[] | null>;
}

declare module '@tauri-apps/plugin-fs' {
    export type ReadFileOptions = Record<string, unknown>;
    export function readFile(path: string, options?: ReadFileOptions): Promise<ArrayBuffer>;
}

declare module 'marked' {
    export const marked: {
        parse: (content: string) => string;
        use: (...args: unknown[]) => void;
        Renderer: new () => {
            link?: unknown;
            code?: unknown;
            [key: string]: unknown;
        };
    };
}
