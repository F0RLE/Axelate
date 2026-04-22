import type { ITauriInstance } from './coreTypes';

/**
 * Minimal bridge-facing types kept only for modules that still inspect runtime globals.
 */
export type TTranslateFunction = (key: string, defaultValue?: string) => string;

export interface IGlobalRuntime {
    __TAURI__?: ITauriInstance;
    __TAURI_INTERNALS__?: unknown;
}

export type TGlobalWin = typeof globalThis & IGlobalRuntime;
