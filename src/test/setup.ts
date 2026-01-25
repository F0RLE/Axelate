import { beforeAll, beforeEach } from 'vitest';

// Mock localStorage for JSDOM
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (i: number) => Object.keys(store)[i] ?? null,
    };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock Tauri APIs that don't exist in JSDOM
beforeAll(() => {
    (globalThis as any).__TAURI__ = {
        invoke: async () => {},
    };
});

// Clear localStorage before each test
beforeEach(() => {
    localStorageMock.clear();
});
