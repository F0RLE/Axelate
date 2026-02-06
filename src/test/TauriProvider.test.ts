import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// 1. Setup mocks BEFORE imports
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(),
}));

// 2. Import mocked versions to verify calls
import { invoke as mockedTauriInvoke } from '@tauri-apps/api/core';
import { listen as mockedTauriListen } from '@tauri-apps/api/event';

// Full Tauri structure that TauriProvider expects (for globalThis fallback tests)
const tauriMock = {
    core: {
        invoke: mockedTauriInvoke,
    },
    event: {
        listen: mockedTauriListen,
    },
};

// Must set BEFORE import
(globalThis as Record<string, unknown>).__TAURI__ = tauriMock;

// Helper implementation for listen that calls callback immediately
function createListenWithPayload(payload: unknown) {
    return (_: unknown, internalCb: (e: { payload: unknown }) => void) => {
        internalCb({ payload });
        return Promise.resolve(() => {});
    };
}

import { TauriProvider } from '../modules/core/services/TauriProvider';

describe('TauriProvider', () => {
    let provider: TauriProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        // Ensure Tauri is set
        (globalThis as Record<string, unknown>).__TAURI__ = tauriMock;
        provider = new TauriProvider();
    });

    afterEach(() => {
        // Restore Tauri
        (globalThis as Record<string, unknown>).__TAURI__ = tauriMock;
    });

    describe('constructor', () => {
        it('should detect Tauri environment', () => {
            expect(provider.isTauri()).toBe(true);
        });
    });

    describe('isTauri', () => {
        it('should return true when __TAURI__ is present', () => {
            expect(provider.isTauri()).toBe(true);
        });

        it('should return false when __TAURI__ is missing', () => {
            delete (globalThis as Record<string, unknown>).__TAURI__;
            delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

            const webProvider = new TauriProvider();
            expect(webProvider.isTauri()).toBe(false);
        });
    });

    describe('invoke', () => {
        it('should call Tauri invoke with command and args', async () => {
            (mockedTauriInvoke as any).mockResolvedValueOnce({ success: true });

            const result = await provider.invoke('test_command', { param: 'value' });

            expect(mockedTauriInvoke).toHaveBeenCalledWith('test_command', { param: 'value' });
            expect(result).toEqual({ success: true });
        });

        it('should handle invoke errors', async () => {
            (mockedTauriInvoke as any).mockRejectedValueOnce(new Error('Command failed'));

            await expect(provider.invoke('failing_command')).rejects.toThrow('Command failed');
        });

        it('should rethrow set_focus errors', async () => {
            (mockedTauriInvoke as any).mockRejectedValueOnce(new Error('Focus error'));

            await expect(provider.invoke('set_focus')).rejects.toThrow('Focus error');
        });

        it('should pass empty object as default args', async () => {
            (mockedTauriInvoke as any).mockResolvedValueOnce(null);

            await provider.invoke('simple_command');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('simple_command', {});
        });
    });

    describe('listen', () => {
        it('should subscribe to Tauri events', async () => {
            const callback = vi.fn();
            (mockedTauriListen as any).mockResolvedValueOnce(() => {});

            await provider.listen('test:event', callback);

            expect(mockedTauriListen).toHaveBeenCalledWith('test:event', expect.any(Function));
        });

        it('should return unsubscribe function', async () => {
            const unsubscribeFn = vi.fn();
            (mockedTauriListen as any).mockResolvedValueOnce(unsubscribeFn);

            const unsubscribe = await provider.listen('test:event', () => {});

            expect(typeof unsubscribe).toBe('function');
        });

        it('should pass payload to callback', async () => {
            const callback = vi.fn();

            // Use module-level helper
            (mockedTauriListen as any).mockImplementationOnce(
                createListenWithPayload({ data: 'test' }),
            );

            await provider.listen('test:event', callback);

            expect(callback).toHaveBeenCalledWith({ data: 'test' });
        });
    });

    describe('mock mode', () => {
        it('should work without Tauri and use mock invoke', async () => {
            delete (globalThis as Record<string, unknown>).__TAURI__;

            const webProvider = new TauriProvider();
            expect(webProvider.isTauri()).toBe(false);

            // Mock invoke should return mock data
            const result = await webProvider.invoke('get_settings');
            expect(result).toEqual({ LANGUAGE: 'en', THEME: 'dark' });
        });
    });
});
