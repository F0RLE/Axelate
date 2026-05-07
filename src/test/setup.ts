import { beforeEach, vi } from 'vitest';

// Mock localStorage for JSDOM
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
            store[key] = value;
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
        get length() {
            return Object.keys(store).length;
        },
        key: (i: number) => Object.keys(store)[i] ?? null,
    };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function installDefaultTauriGlobals(): void {
    const win = globalThis as unknown as Record<string, unknown>;
    win['__TAURI_INTERNALS__'] = {
        invoke: async () => {},
        transformCallback: () => 0,
        eventListen: async () => () => {},
    };
    win['t'] = vi.fn((key: string, fallback?: string) => fallback ?? key);
}

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockImplementation((cmd: string, args?: unknown) => {
        const win = globalThis as unknown as Record<string, unknown>;
        const internals = win['__TAURI_INTERNALS__'] as Record<string, any> | undefined;

        if (typeof internals?.['invoke'] === 'function') {
            return internals['invoke'](cmd, args);
        }
        return Promise.resolve();
    }),
    convertFileSrc: vi.fn((filePath: string) => `asset://localhost/${filePath}`),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockImplementation((event: string, callback: (payload: any) => void) => {
        const win = globalThis as unknown as Record<string, unknown>;
        const internals = win['__TAURI_INTERNALS__'] as Record<string, any> | undefined;

        if (typeof internals?.['eventListen'] === 'function') {
            return internals['eventListen'](event, callback);
        }
        return Promise.resolve(() => {});
    }),
}));

beforeEach(() => {
    localStorageMock.clear();
    installDefaultTauriGlobals();
});
