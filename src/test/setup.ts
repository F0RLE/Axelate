import { beforeAll, beforeEach, vi } from 'vitest';

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

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockImplementation((cmd: string, args?: unknown) => {
        const win = globalThis as unknown as Record<string, unknown>;
        const tauri = win['__TAURI__'] as Record<string, any> | undefined;

        if (tauri && typeof tauri['invoke'] === 'function') {
            return tauri['invoke'](cmd, args);
        }
        if (tauri && tauri['core'] && typeof tauri['core']['invoke'] === 'function') {
            return tauri['core']['invoke'](cmd, args);
        }
        return Promise.resolve();
    }),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockImplementation((event: string, callback: (payload: any) => void) => {
        const win = globalThis as unknown as Record<string, unknown>;
        const tauri = win['__TAURI__'] as Record<string, any> | undefined;

        if (tauri && tauri['event'] && typeof tauri['event']['listen'] === 'function') {
            return tauri['event']['listen'](event, callback);
        }
        return Promise.resolve(() => {});
    }),
}));

beforeAll(() => {
    const win = globalThis as unknown as Record<string, unknown>;
    win['__TAURI__'] = {
        invoke: async () => {},
        core: { invoke: async () => {} },
        event: { listen: async () => () => {} },
    };
    win['__TAURI_INTERNALS__'] = {
        invoke: async () => {},
        transformCallback: () => 0,
    };
    win['t'] = vi.fn((key: string, _def?: string) => _def || key);
});

// Clear localStorage before each test
beforeEach(() => {
    localStorageMock.clear();
});
