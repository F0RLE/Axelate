/**
 * AIChatTransport Unit Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIChatTransport } from '@/features/ai/services/AIChatTransport';
import type { IChatRequest } from '@/features/ai/types/aiTypes';

// ---------- helpers ----------
function createMockCore(isTauri = true) {
    return {
        tauriProvider: {
            isTauri: vi.fn().mockReturnValue(isTauri),
            invoke: vi.fn(),
            listen: vi.fn().mockResolvedValue(vi.fn()),
        },
    };
}

function makeRequest(overrides: Partial<IChatRequest> = {}): IChatRequest {
    return {
        provider: 'gemini',
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hello' }],
        api_key: null,
        ...overrides,
    };
}

describe('AIChatTransport', () => {
    let transport: AIChatTransport;
    let mockCore: ReturnType<typeof createMockCore>;

    beforeEach(() => {
        vi.useFakeTimers();
        transport = new AIChatTransport();
        mockCore = createMockCore();
        transport.setCore(mockCore as unknown as Parameters<typeof transport.setCore>[0]);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ---------------------------------------------------------- init
    describe('init', () => {
        it('should resolve without error in Tauri mode', async () => {
            await expect(transport.init()).resolves.not.toThrow();
        });

        it('should resolve without error in web mode', async () => {
            mockCore.tauriProvider.isTauri.mockReturnValue(false);
            await expect(transport.init()).resolves.not.toThrow();
        });
    });

    // ---------------------------------------------------------- send
    describe('send', () => {
        it('should return error when not in Tauri mode', async () => {
            mockCore.tauriProvider.isTauri.mockReturnValue(false);
            const result = await transport.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'IPC host unavailable' });
        });

        it('should return error when core is null', async () => {
            const t = new AIChatTransport();
            const result = await t.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'IPC host unavailable' });
        });

        it('should invoke Tauri and normalize successful response', async () => {
            mockCore.tauriProvider.invoke.mockResolvedValue({
                ok: true,
                reply: { text: 'World' },
            });

            const result = await transport.send(makeRequest());

            expect(mockCore.tauriProvider.invoke).toHaveBeenCalledWith('send_chat_message', {
                request: expect.any(Object) as unknown,
            });
            expect(result).toEqual({ ok: true, text: 'World' });
        });

        it('should normalize error response from backend', async () => {
            mockCore.tauriProvider.invoke.mockResolvedValue({
                ok: false,
                error: 'Rate limited',
            });

            const result = await transport.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'Rate limited' });
        });

        it('should normalize response without explicit error to "Unknown error"', async () => {
            mockCore.tauriProvider.invoke.mockResolvedValue({ ok: false });

            const result = await transport.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'Unknown error' });
        });

        it('should catch invoke errors and return error response', async () => {
            mockCore.tauriProvider.invoke.mockRejectedValue(new Error('Network down'));

            const result = await transport.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'Network down' });
        });

        it('should catch non-Error throws and return the thrown string', async () => {
            mockCore.tauriProvider.invoke.mockRejectedValue('string error');

            const result = await transport.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'string error' });
        });

        it('should timeout after 90 seconds', async () => {
            // Invoke never resolves
            mockCore.tauriProvider.invoke.mockReturnValue(new Promise(() => {}));

            const sendPromise = transport.send(makeRequest());

            // Advance timers past the 90s timeout
            vi.advanceTimersByTime(90_001);

            const result = await sendPromise;
            expect(result).toEqual({ ok: false, error: 'AI request timed out' });
        });

        it('should extract message from plain error objects', async () => {
            mockCore.tauriProvider.invoke.mockRejectedValue({ message: 'ipc object failed' });

            const result = await transport.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'ipc object failed' });
        });

        it('should stringify unexpected thrown values', async () => {
            mockCore.tauriProvider.invoke.mockRejectedValue({ nested: true });

            const result = await transport.send(makeRequest());
            expect(result).toEqual({ ok: false, error: '{"nested":true}' });
        });
    });

    describe('generateImage', () => {
        const request = { provider: 'sdcpp', prompt: 'mountain', model: 'default' } as Parameters<
            AIChatTransport['generateImage']
        >[0];

        it('should reject in web mode', async () => {
            mockCore.tauriProvider.isTauri.mockReturnValue(false);
            await expect(transport.generateImage(request)).resolves.toEqual({
                ok: false,
                error: 'IPC host unavailable',
            });
        });

        it('should normalize successful image generation responses', async () => {
            mockCore.tauriProvider.invoke.mockResolvedValue({
                ok: true,
                images: ['file:///one.png'],
            });

            await expect(transport.generateImage(request)).resolves.toEqual({
                ok: true,
                images: ['file:///one.png'],
            });
        });

        it('should return backend fallback error when no images were produced', async () => {
            mockCore.tauriProvider.invoke
                .mockResolvedValueOnce({ ok: false, error: 'backend failed', images: [] })
                .mockResolvedValueOnce({ ok: true, images: [] });

            await expect(transport.generateImage(request)).resolves.toEqual({
                ok: false,
                error: 'backend failed',
            });
            await expect(transport.generateImage(request)).resolves.toEqual({
                ok: false,
                error: 'Failed to generate image',
            });
        });

        it('should surface invoke failures and timeouts for images', async () => {
            mockCore.tauriProvider.invoke.mockRejectedValueOnce({ message: 'gpu busy' });
            await expect(transport.generateImage(request)).resolves.toEqual({
                ok: false,
                error: 'gpu busy',
            });

            mockCore.tauriProvider.invoke.mockReturnValueOnce(new Promise(() => {}));
            const promise = transport.generateImage(request);
            vi.advanceTimersByTime(300_001);
            await expect(promise).resolves.toEqual({
                ok: false,
                error: 'Image generation requested timed out',
            });
        });
    });

    describe('generateImageBackground', () => {
        const request = { provider: 'sdcpp', prompt: 'city', model: 'default' } as Parameters<
            AIChatTransport['generateImageBackground']
        >[0];

        it('should reject in web mode', async () => {
            mockCore.tauriProvider.isTauri.mockReturnValue(false);
            await expect(transport.generateImageBackground(request)).resolves.toEqual({
                ok: false,
                error: 'IPC host unavailable',
            });
        });

        it('should invoke background generation and normalize errors', async () => {
            mockCore.tauriProvider.invoke.mockResolvedValueOnce(undefined);
            await expect(transport.generateImageBackground(request)).resolves.toEqual({ ok: true });
            expect(mockCore.tauriProvider.invoke).toHaveBeenCalledWith(
                'generate_image_background',
                { request },
            );

            mockCore.tauriProvider.invoke.mockRejectedValueOnce('bg failed');
            await expect(transport.generateImageBackground(request)).resolves.toEqual({
                ok: false,
                error: 'bg failed',
            });
        });
    });

    // ---------------------------------------------------------- Stream Listeners (onStream, onThought)
    describe.each([
        ['onStream', 'ai:chat:chunk'],
        ['onThought', 'ai:thought:chunk'],
    ])('%s', (methodName, eventName) => {
        const invokeMethod = (listener: (chunk: string) => void) => {
            const method = (
                transport as unknown as Record<string, (cb: (c: string) => void) => () => void>
            )[methodName];
            return (method as (cb: (c: string) => void) => () => void).call(transport, listener);
        };

        it('should return no-op function when not in Tauri mode', () => {
            mockCore.tauriProvider.isTauri.mockReturnValue(false);
            const unsub = invokeMethod(vi.fn());
            expect(typeof unsub).toBe('function');
            unsub(); // should not throw
        });

        it('should return no-op function when core is null', () => {
            const t = new AIChatTransport();
            const method = (
                t as unknown as Record<string, (cb: (c: string) => void) => () => void>
            )[methodName];
            const unsub = (method as (cb: (c: string) => void) => () => void).call(t, vi.fn());
            expect(typeof unsub).toBe('function');
            unsub();
        });

        it(`should call tauriProvider.listen with ${eventName}`, async () => {
            invokeMethod(vi.fn());

            // Flush the internal promise
            await vi.runAllTimersAsync();

            expect(mockCore.tauriProvider.listen).toHaveBeenCalledWith(
                eventName,
                expect.any(Function),
            );
        });

        it('should forward payload to listener when active', async () => {
            const listener = vi.fn();

            // Make listen call the callback immediately with payload
            mockCore.tauriProvider.listen.mockImplementation(
                (_event: string, cb: (payload: string) => void) => {
                    cb('chunk-data');
                    return Promise.resolve(vi.fn());
                },
            );

            invokeMethod(listener);
            await vi.runAllTimersAsync();

            expect(listener).toHaveBeenCalledWith('chunk-data');
        });

        it('should unwrap object payload event shapes', async () => {
            const listener = vi.fn();
            mockCore.tauriProvider.listen.mockImplementation(
                (_event: string, cb: (payload: { payload: string }) => void) => {
                    cb({ payload: 'wrapped-data' });
                    return Promise.resolve(vi.fn());
                },
            );

            invokeMethod(listener);
            await vi.runAllTimersAsync();
            expect(listener).toHaveBeenCalledWith('wrapped-data');
        });

        it('should NOT forward payload after unsubscribe', async () => {
            const listener = vi.fn();
            const captured: { cb: ((payload: string) => void) | null } = { cb: null };

            mockCore.tauriProvider.listen.mockImplementation(
                (_event: string, cb: (payload: string) => void) => {
                    captured.cb = cb;
                    return Promise.resolve(vi.fn());
                },
            );

            const unsub = invokeMethod(listener);
            await vi.runAllTimersAsync();

            unsub();
            captured.cb?.('after-unsub');

            expect(listener).not.toHaveBeenCalled();
        });

        it('should call unlisten on cleanup if already resolved', async () => {
            const mockUnlisten = vi.fn();
            mockCore.tauriProvider.listen.mockResolvedValue(mockUnlisten);

            const unsub = invokeMethod(vi.fn());
            await vi.runAllTimersAsync();

            unsub();
            expect(mockUnlisten).toHaveBeenCalled();
        });

        it('should call unlisten immediately if cancelled before resolve', async () => {
            const mockUnlisten = vi.fn();
            const captured: { resolve: ((fn: () => void) => void) | null } = { resolve: null };

            mockCore.tauriProvider.listen.mockImplementation(() => {
                return new Promise<() => void>((resolve) => {
                    captured.resolve = resolve;
                });
            });

            const unsub = invokeMethod(vi.fn());
            unsub(); // Cancel before listen resolves

            // Now resolve the listen promise
            captured.resolve?.(mockUnlisten);
            await vi.runAllTimersAsync();

            expect(mockUnlisten).toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- missing branches
    describe('Missing branch cases', () => {
        it('should hit timeout error line (Line 45)', async () => {
            // Need the timeout to actually reject
            mockCore.tauriProvider.invoke.mockImplementation(() => {
                return new Promise(() => {}); // never resolves
            });

            // Start send
            const promise = transport.send(makeRequest());

            // Advance by timeout
            vi.advanceTimersByTime(95_000);

            const res = await promise;
            expect(res.ok).toBe(false);
            expect(res.error).toBe('AI request timed out');
        });

        it('onStream should hit core null check (Line 68)', () => {
            const t = new AIChatTransport();
            const unsub = t.onStream(vi.fn());
            expect(typeof unsub).toBe('function');
            unsub();
        });
    });

    // ---------------------------------------------------------- destroy
    describe('destroy', () => {
        it('should call all registered unlisteners', () => {
            // Manually seed mock fns into _unlisteners (white-box)
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (transport as any)._unlisteners.add(fn1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (transport as any)._unlisteners.add(fn2);

            transport.destroy();

            expect(fn1).toHaveBeenCalledOnce();
            expect(fn2).toHaveBeenCalledOnce();
        });

        it('should clear unlisteners set after destroy', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (transport as any)._unlisteners.add(vi.fn());
            transport.destroy();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((transport as any)._unlisteners.size).toBe(0);
        });

        it('should be safe to call destroy multiple times', () => {
            transport.destroy();
            transport.destroy();
        });
    });
});
