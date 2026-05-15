import { beforeEach, vi } from 'vitest';

type TauriInternalsMock = {
    invoke: (cmd?: string, args?: unknown) => Promise<unknown>;
    transformCallback: () => number;
    eventListen: (event?: string, callback?: (payload: unknown) => void) => Promise<() => void>;
};

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
    const internals: TauriInternalsMock = {
        invoke: () => Promise.resolve(),
        transformCallback: () => 0,
        eventListen: () => Promise.resolve(() => {}),
    };
    win['__TAURI_INTERNALS__'] = internals;
    win['t'] = vi.fn((key: string, fallback?: string) => fallback ?? key);
}

function getTauriInternals(): Partial<TauriInternalsMock> | null {
    const win = globalThis as unknown as Record<string, unknown>;
    const internals = win['__TAURI_INTERNALS__'];
    if (internals === null || typeof internals !== 'object') {
        return null;
    }
    return internals as Partial<TauriInternalsMock>;
}

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockImplementation((cmd: string, args?: unknown) => {
        const internals = getTauriInternals();

        if (typeof internals?.invoke === 'function') {
            return internals.invoke(cmd, args);
        }
        return Promise.resolve();
    }),
    convertFileSrc: vi.fn((filePath: string) => `asset://localhost/${filePath}`),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockImplementation((event: string, callback: (payload: unknown) => void) => {
        const internals = getTauriInternals();

        if (typeof internals?.eventListen === 'function') {
            return internals.eventListen(event, callback);
        }
        return Promise.resolve(() => {});
    }),
}));

beforeEach(() => {
    localStorageMock.clear();
    installDefaultTauriGlobals();
});
