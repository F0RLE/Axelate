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
    invoke: vi.fn().mockImplementation((cmd: string, args?: any) => {
        if (typeof (globalThis as any).__TAURI__?.invoke === 'function') {
            return (globalThis as any).__TAURI__.invoke(cmd, args);
        }
        if (typeof (globalThis as any).__TAURI__?.core?.invoke === 'function') {
            return (globalThis as any).__TAURI__.core.invoke(cmd, args);
        }
        return Promise.resolve();
    }),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockImplementation((event: string, callback: (payload: any) => void) => {
        if (typeof (globalThis as any).__TAURI__?.event?.listen === 'function') {
            return (globalThis as any).__TAURI__.event.listen(event, callback);
        }
        return Promise.resolve(() => {});
    }),
}));

beforeAll(() => {
    (globalThis as any).__TAURI__ = {
        invoke: async () => {},
        core: { invoke: async () => {} },
        event: { listen: async () => () => {} },
    };
    (globalThis as any).__TAURI_INTERNALS__ = {
        invoke: async () => {},
        transformCallback: () => 0,
    };
    (globalThis as any).t = vi.fn((key: string, _def?: string) => _def || key);
});

// Clear localStorage before each test
beforeEach(() => {
    localStorageMock.clear();
});
