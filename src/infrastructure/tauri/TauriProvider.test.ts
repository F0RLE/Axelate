/**
 * TauriProvider Unit Tests — Full Coverage
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

// 1. Setup mocks BEFORE imports
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
    Channel: class<T> {
        public onmessage: ((message: T) => void) | null = null;
    },
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(),
}));

// 2. Import mocked versions to verify calls
import { invoke as mockedTauriInvoke } from '@tauri-apps/api/core';
import { listen as mockedTauriListen } from '@tauri-apps/api/event';

function createTracer(): LoggerService {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    } as unknown as LoggerService;
}

// Helper implementation for listen that calls callback immediately
function createListenWithPayload(payload: unknown) {
    return (_: unknown, internalCb: (e: { payload: unknown }) => void) => {
        internalCb({ payload });
        return Promise.resolve(() => {
            /* no-op */
        });
    };
}

function setupWebMode(): {
    win: Record<string, unknown>;
    origInternals: unknown;
    provider: TauriProvider;
} {
    const win = globalThis as unknown as Record<string, unknown>;
    const origInternals = win['__TAURI_INTERNALS__'];
    delete win['__TAURI_INTERNALS__'];

    return { win, origInternals, provider: new TauriProvider(createTracer()) };
}

import { TauriProvider } from '@/infrastructure/tauri/TauriProvider';

describe('TauriProvider', () => {
    let provider: TauriProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
        provider = new TauriProvider(createTracer());
    });

    afterEach(() => {
        (globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    });

    // ---------------------------------------------------------- constructor
    describe('constructor', () => {
        it('should detect Tauri environment', () => {
            expect(provider.isTauri()).toBe(true);
        });
    });

    // ---------------------------------------------------------- isTauri
    describe('isTauri', () => {
        it('should return true when Tauri internals are present', () => {
            expect(provider.isTauri()).toBe(true);
        });

        it('should return false when Tauri internals are missing', () => {
            const { provider: webProvider } = setupWebMode();
            expect(webProvider.isTauri()).toBe(false);
        });

        it('should return true when __TAURI_INTERNALS__ is present', () => {
            const win = globalThis as unknown as Record<string, unknown>;
            win['__TAURI_INTERNALS__'] = {};

            const p = new TauriProvider(createTracer());
            expect(p.isTauri()).toBe(true);

            delete win['__TAURI_INTERNALS__'];
        });
    });

    // ---------------------------------------------------------- init
    describe('init', () => {
        it('should perform handshake on init', () => {
            provider.init();
            // Handshake fires get_health asynchronously
            expect(mockedTauriInvoke).toHaveBeenCalledWith('get_health', {});
        });

        it('should use cached _isTauriDetected after successful handshake (L32)', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce({ status: 'ok' });
            provider.init();

            // Wait for the async handshake promise to settle
            await new Promise((resolve) => setTimeout(resolve, 0));

            const { win, origInternals } = setupWebMode();

            expect(provider.isTauri()).toBe(true);

            win['__TAURI_INTERNALS__'] = origInternals;
        });

        it('should keep Tauri mode after a failed handshake when runtime globals are present', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Handshake fail'),
            );
            provider.init();

            await vi.waitFor(() => {
                expect(provider.isTauri()).toBe(true);
            });
        });

        it('should return _isTauriDetected=false after failed handshake without runtime globals', async () => {
            const { win, origInternals } = setupWebMode();

            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Handshake fail'),
            );
            const p = new TauriProvider(createTracer());
            p.init();

            await vi.waitFor(() => {
                expect(p.isTauri()).toBe(false);
            });

            win['__TAURI_INTERNALS__'] = origInternals;
        });
    });

    // ---------------------------------------------------------- invoke
    describe('invoke', () => {
        it('should call Tauri invoke with command and args', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce({ success: true });

            const result = await provider.invoke('test_command', { param: 'value' });

            expect(mockedTauriInvoke).toHaveBeenCalledWith('test_command', { param: 'value' });
            expect(result).toEqual({ success: true });
        });

        it('should handle invoke errors', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Command failed'),
            );

            await expect(provider.invoke('failing_command')).rejects.toThrow('Command failed');
        });

        it('should rethrow set_focus errors', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(new Error('Focus error'));

            await expect(provider.invoke('set_focus')).rejects.toThrow('Focus error');
        });

        it('should pass empty object as default args', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce(null);

            await provider.invoke('simple_command');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('simple_command', {});
        });

        it('should propagate invoke failures', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(new Error('fail'));

            await expect(provider.invoke('get_settings')).rejects.toThrow('fail');
        });

        it('should wrap non-Error rejections in Error (L63 ternary false branch)', async () => {
            // Reject with a string (not an Error instance)
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce('string rejection');

            await expect(provider.invoke('some_cmd')).rejects.toThrow('string rejection');
        });

        it('should unwrap successful Specta result responses', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce({
                status: 'ok',
                data: { value: 7 },
            });

            await expect(provider.invoke<{ value: number }>('specta_ok')).resolves.toEqual({
                value: 7,
            });
        });

        it('should throw readable errors for Specta error payloads', async () => {
            (mockedTauriInvoke as unknown as Mock)
                .mockResolvedValueOnce({ status: 'error', error: 'rate limited' })
                .mockResolvedValueOnce({
                    status: 'error',
                    error: { message: 'boom' },
                })
                .mockResolvedValueOnce({
                    status: 'error',
                    error: { payload: { detail: 'bad' } },
                });

            await expect(provider.invoke('specta_err_string')).rejects.toThrow('rate limited');
            await expect(provider.invoke('specta_err_message')).rejects.toThrow('boom');
            await expect(provider.invoke('specta_err_payload')).rejects.toThrow('{"detail":"bad"}');
        });

        it('should normalize object rejections with message, code and stringify fallback', async () => {
            (mockedTauriInvoke as unknown as Mock)
                .mockRejectedValueOnce({ message: 'ipc failed', code: 'E_IPC' })
                .mockRejectedValueOnce({ nested: true });

            const err = (await provider
                .invoke('msg_error')
                .catch((e) => e as Error & { code?: string })) as Error & { code?: string };
            expect(err.message).toBe('ipc failed');
            expect(err.code).toBe('E_IPC');

            await expect(provider.invoke('json_error')).rejects.toThrow('{"nested":true}');
        });
    });

    // ---------------------------------------------------------- listen
    describe('listen', () => {
        it('should subscribe to Tauri events', async () => {
            const callback = vi.fn();
            (mockedTauriListen as unknown as Mock).mockResolvedValueOnce(() => {
                /* no-op */
            });

            await provider.listen('test:event', callback);

            expect(mockedTauriListen).toHaveBeenCalledWith('test:event', expect.any(Function));
        });

        it('should return unsubscribe function', async () => {
            const unsubscribeFn = vi.fn();
            (mockedTauriListen as unknown as Mock).mockResolvedValueOnce(unsubscribeFn);

            const unsubscribe = await provider.listen('test:event', () => {
                /* no-op */
            });

            expect(typeof unsubscribe).toBe('function');
        });

        it('should pass payload to callback', async () => {
            const callback = vi.fn();

            (mockedTauriListen as unknown as Mock).mockImplementationOnce(
                createListenWithPayload({ data: 'test' }),
            );

            await provider.listen('test:event', callback);

            expect(callback).toHaveBeenCalledWith({ data: 'test' });
        });

        it('should return no-op function in web mode', async () => {
            const { provider: webProvider } = setupWebMode();
            const unsub = await webProvider.listen('test:event', vi.fn());

            expect(typeof unsub).toBe('function');
            unsub(); // should not throw
        });
    });

    // ---------------------------------------------------------- getSecureKey
    describe('getSecureKey', () => {
        it('should return key when invoke succeeds', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce('secret-value');

            const result = await provider.getSecureKey('openai_api');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('get_secure_key', {
                service: 'openai_api',
            });
            expect(result).toBe('secret-value');
        });

        it('should return null when invoke fails', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Key not found'),
            );

            const result = await provider.getSecureKey('unknown_service');

            expect(result).toBeNull();
        });
    });

    // ---------------------------------------------------------- saveSecureKey
    describe('saveSecureKey', () => {
        it('should call save_secure_key with correct args', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce(undefined);

            await provider.saveSecureKey('openai_api', 'new-secret');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('save_secure_key', {
                service: 'openai_api',
                key: 'new-secret',
            });
        });

        it('should rethrow errors', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Storage failure'),
            );

            await expect(provider.saveSecureKey('openai_api', 'key')).rejects.toThrow(
                'Storage failure',
            );
        });
    });

    describe('removeSecureKey', () => {
        it('should call remove_secure_key with correct args', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce(undefined);

            await provider.removeSecureKey('openai_api');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('remove_secure_key', {
                service: 'openai_api',
            });
        });

        it('should rethrow remove errors', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Storage failure'),
            );

            await expect(provider.removeSecureKey('openai_api')).rejects.toThrow('Storage failure');
        });
    });

    // ---------------------------------------------------------- hasSecureKey
    describe('hasSecureKey', () => {
        it('should return key presence when invoke succeeds', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce(true);

            const result = await provider.hasSecureKey('openai_api');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('has_secure_key', {
                service: 'openai_api',
            });
            expect(result).toBe(true);
        });

        it('should return false when invoke fails', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Presence check failed'),
            );

            const result = await provider.hasSecureKey('unknown_service');

            expect(result).toBe(false);
        });
    });

    describe('getSecureKeyMeta', () => {
        it('should return non-sensitive metadata when invoke succeeds', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce({
                exists: true,
                length: 24,
            });

            const result = await provider.getSecureKeyMeta('openai_api');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('get_secure_key_meta', {
                service: 'openai_api',
            });
            expect(result).toEqual({ exists: true, length: 24 });
        });

        it('should return empty metadata when invoke fails', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(new Error('meta fail'));

            const result = await provider.getSecureKeyMeta('unknown_service');

            expect(result).toEqual({ exists: false, length: 0 });
        });
    });

    // ---------------------------------------------------------- writeToClipboard
    describe('writeToClipboard', () => {
        it('should call clipboard plugin in Tauri', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce(undefined);

            await provider.writeToClipboard('copied text');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', {
                text: 'copied text',
            });
        });

        it('should reject when the Tauri clipboard plugin fails', async () => {
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(new Error('denied'));

            await expect(provider.writeToClipboard('copied text')).rejects.toThrow('denied');
        });

        it('should reject in web mode', async () => {
            const { provider: webProvider } = setupWebMode();

            await expect(webProvider.writeToClipboard('text')).rejects.toThrow(
                'Clipboard write is unavailable outside Tauri',
            );
        });
    });

    describe('readClipboardText', () => {
        it('should call clipboard plugin in Tauri', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce('clipboard text');

            await expect(provider.readClipboardText()).resolves.toBe('clipboard text');

            expect(mockedTauriInvoke).toHaveBeenCalledWith(
                'plugin:clipboard-manager|read_text',
                {},
            );
        });

        it('should not use browser clipboard reads in web mode', async () => {
            const { provider: webProvider } = setupWebMode();

            await expect(webProvider.readClipboardText()).resolves.toBeNull();
        });
    });

    // ---------------------------------------------------------- openUrl
    describe('openUrl', () => {
        it('should call shell plugin in Tauri', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce(undefined);

            await provider.openUrl('https://example.com');

            expect(mockedTauriInvoke).toHaveBeenCalledWith('plugin:shell|open', {
                path: 'https://example.com',
            });
        });

        it('should reject outside Tauri', async () => {
            const { provider: webProvider } = setupWebMode();

            await expect(webProvider.openUrl('https://example.com')).rejects.toThrow(
                'External URL opening is unavailable outside Tauri',
            );
        });
    });

    // ---------------------------------------------------------- web mode
    describe('web mode', () => {
        it('should reject command invocation without Tauri', async () => {
            const { provider: webProvider } = setupWebMode();
            expect(webProvider.isTauri()).toBe(false);

            await expect(webProvider.invoke('get_settings')).rejects.toThrow(
                'Tauri IPC unavailable for command: get_settings',
            );
        });
    });

    // ---------------------------------------------------------- handshake failure (lines 24-25)
    describe('init handshake failure', () => {
        it('should not disable Tauri mode when handshake fails but globals exist', async () => {
            // Make invoke throw so handshake fails
            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(
                new Error('Handshake failed'),
            );

            const provider2 = new TauriProvider(createTracer());
            provider2.init();

            await vi.waitFor(() => {
                expect(provider2.isTauri()).toBe(true);
            });
        });

        it('should set _isTauriDetected to false when handshake fails without globals', async () => {
            const { win, origInternals, provider: provider3 } = setupWebMode();

            (mockedTauriInvoke as unknown as Mock).mockRejectedValueOnce(new Error('Fail'));
            provider3.init();

            await vi.waitFor(() => {
                expect(provider3.isTauri()).toBe(false);
            });

            win['__TAURI_INTERNALS__'] = origInternals;
        });
    });

    describe('_performInvoke', () => {
        it('should invoke through the imported Tauri API', async () => {
            (mockedTauriInvoke as unknown as Mock).mockResolvedValueOnce({ result: 'ok' });

            const result = await provider.invoke<{ result: string }>('some_cmd');
            expect(result.result).toBe('ok');
        });

        it('should reject when Tauri internals are missing', async () => {
            const { provider: webProvider, win, origInternals } = setupWebMode();

            await expect(webProvider.invoke('any_cmd')).rejects.toThrow(
                'Tauri IPC unavailable for command: any_cmd',
            );

            win['__TAURI_INTERNALS__'] = origInternals;
        });
    });
});
