/**
 * AIChatTransport Unit Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    Channel: class<T> {
        public onmessage: ((message: T) => void) | null = null;
    },
    invoke: vi.fn(),
}));

import { AIChatTransport } from '@/features/ai/services/AIChatTransport';
import type { IChatRequest } from '@/features/ai/types/aiTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

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
    let tracer: Pick<LoggerService, 'info' | 'warn' | 'error'>;

    beforeEach(() => {
        vi.useFakeTimers();
        tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        transport = new AIChatTransport(tracer);
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
            const t = new AIChatTransport(tracer);
            const result = await t.send(makeRequest());
            expect(result).toEqual({ ok: false, error: 'IPC host unavailable' });
        });

        it('should invoke Tauri and normalize successful response', async () => {
            mockCore.tauriProvider.invoke.mockResolvedValue({
                ok: true,
                reply: { text: 'World' },
            });

            const result = await transport.send(makeRequest());
            const [[command, payload]] = mockCore.tauriProvider.invoke.mock.calls as [
                [
                    string,
                    {
                        request: { request_id?: string };
                        chatChannel: unknown;
                        thoughtChannel: unknown;
                    },
                ],
            ];

            expect(command).toBe('send_chat_message');
            expect(payload).toMatchObject({
                request: expect.objectContaining({
                    request_id: expect.any(String) as unknown,
                }) as unknown,
            });
            expect(payload.chatChannel).toBeDefined();
            expect(payload.thoughtChannel).toBeDefined();
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

        it('should cancel a stale active request before starting another one', async () => {
            let sendCalls = 0;
            let firstRequestId = '';
            mockCore.tauriProvider.invoke.mockImplementation(
                (command: string, args: Record<string, unknown>) => {
                    if (command === 'cancel_chat_generation') {
                        return Promise.resolve(true);
                    }

                    if (command === 'send_chat_message') {
                        sendCalls += 1;
                        const request = args['request'] as { request_id: string };
                        if (sendCalls === 1) {
                            firstRequestId = request.request_id;
                            return new Promise(() => {});
                        }
                        return Promise.resolve({ ok: true, reply: { text: 'second' } });
                    }

                    return Promise.resolve(undefined);
                },
            );

            const firstSend = transport.send(makeRequest());
            await Promise.resolve();

            const secondResult = await transport.send(makeRequest({ messages: [] }));

            expect(secondResult).toEqual({ ok: true, text: 'second' });
            expect(mockCore.tauriProvider.invoke).toHaveBeenCalledWith('cancel_chat_generation', {
                requestId: firstRequestId,
            });
            expect(sendCalls).toBe(2);

            vi.advanceTimersByTime(90_001);
            await firstSend;
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

        it('should surface invoke failures for images', async () => {
            mockCore.tauriProvider.invoke.mockRejectedValueOnce({ message: 'gpu busy' });
            await expect(transport.generateImage(request)).resolves.toEqual({
                ok: false,
                error: 'gpu busy',
            });
        });

        it('should let the backend own long image generation timeout handling', async () => {
            mockCore.tauriProvider.invoke.mockResolvedValueOnce({
                ok: true,
                images: ['file:///late.png'],
            });

            const promise = transport.generateImage(request);
            vi.advanceTimersByTime(300_001);

            await expect(promise).resolves.toEqual({
                ok: true,
                images: ['file:///late.png'],
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
        ['onStream', 'chatChannel'],
        ['onThought', 'thoughtChannel'],
    ])('%s', (methodName, channelName) => {
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
            const t = new AIChatTransport(tracer);
            const method = (
                t as unknown as Record<string, (cb: (c: string) => void) => () => void>
            )[methodName];
            const unsub = (method as (cb: (c: string) => void) => () => void).call(t, vi.fn());
            expect(typeof unsub).toBe('function');
            unsub();
        });

        it('should forward payload from invoke channel to listener', async () => {
            const listener = vi.fn();
            invokeMethod(listener);
            mockCore.tauriProvider.invoke.mockImplementation(
                (_cmd: string, args: Record<string, unknown>) => {
                    const chatChannel = args['chatChannel'] as {
                        onmessage?:
                            | ((payload: {
                                  request_id: string;
                                  message_id: string;
                                  kind: 'chat_chunk' | 'thought_chunk' | 'done';
                                  content: string;
                              }) => void)
                            | null;
                    };
                    const channel = args[channelName] as {
                        onmessage?:
                            | ((payload: {
                                  request_id: string;
                                  message_id: string;
                                  kind: 'chat_chunk' | 'thought_chunk' | 'done';
                                  content: string;
                              }) => void)
                            | null;
                    };
                    const requestId = (args['request'] as { request_id: string }).request_id;
                    channel.onmessage?.({
                        request_id: requestId,
                        message_id: 'msg-1',
                        kind: channelName === 'chatChannel' ? 'chat_chunk' : 'thought_chunk',
                        content: 'chunk-data',
                    });
                    chatChannel.onmessage?.({
                        request_id: requestId,
                        message_id: 'msg-1',
                        kind: 'done',
                        content: '',
                    });
                    return Promise.resolve({ ok: true, reply: { text: 'done' } });
                },
            );

            await transport.send(makeRequest());

            expect(listener).toHaveBeenCalledWith('chunk-data');
        });

        it('should ignore stream payloads from a different request', async () => {
            const listener = vi.fn();
            invokeMethod(listener);
            mockCore.tauriProvider.invoke.mockImplementation(
                (_cmd: string, args: Record<string, unknown>) => {
                    const chatChannel = args['chatChannel'] as {
                        onmessage?:
                            | ((payload: {
                                  request_id: string;
                                  message_id: string;
                                  kind: 'chat_chunk' | 'thought_chunk' | 'done';
                                  content: string;
                              }) => void)
                            | null;
                    };
                    const channel = args[channelName] as {
                        onmessage?:
                            | ((payload: {
                                  request_id: string;
                                  message_id: string;
                                  kind: 'chat_chunk' | 'thought_chunk' | 'done';
                                  content: string;
                              }) => void)
                            | null;
                    };
                    const requestId = (args['request'] as { request_id: string }).request_id;
                    channel.onmessage?.({
                        request_id: 'req-stale',
                        message_id: 'msg-stale',
                        kind: channelName === 'chatChannel' ? 'chat_chunk' : 'thought_chunk',
                        content: 'stale',
                    });
                    channel.onmessage?.({
                        request_id: requestId,
                        message_id: 'msg-1',
                        kind: channelName === 'chatChannel' ? 'chat_chunk' : 'thought_chunk',
                        content: 'current',
                    });
                    chatChannel.onmessage?.({
                        request_id: requestId,
                        message_id: 'msg-1',
                        kind: 'done',
                        content: '',
                    });
                    return Promise.resolve({ ok: true, reply: { text: 'done' } });
                },
            );

            await transport.send(makeRequest());

            expect(listener).toHaveBeenCalledOnce();
            expect(listener).toHaveBeenCalledWith('current');
        });

        it('should NOT forward payload after unsubscribe', async () => {
            const listener = vi.fn();
            const unsub = invokeMethod(listener);
            unsub();
            mockCore.tauriProvider.invoke.mockImplementation(
                (_cmd: string, args: Record<string, unknown>) => {
                    const channel = args[channelName] as {
                        onmessage?:
                            | ((payload: {
                                  request_id: string;
                                  message_id: string;
                                  kind: 'chat_chunk' | 'thought_chunk' | 'done';
                                  content: string;
                              }) => void)
                            | null;
                    };
                    channel.onmessage?.({
                        request_id: 'req-active',
                        message_id: 'msg-3',
                        kind: channelName === 'chatChannel' ? 'chat_chunk' : 'thought_chunk',
                        content: 'after-unsub',
                    });
                    return Promise.resolve({ ok: true, reply: { text: 'done' } });
                },
            );

            await transport.send(makeRequest());

            expect(listener).not.toHaveBeenCalled();
        });

        it('should remove listener on cleanup', () => {
            const unsub = invokeMethod(vi.fn());
            unsub();
            expect(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ((transport as any)._unlisteners as Set<() => void>).size,
            ).toBe(0);
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

        it('onStream should hit core null check', () => {
            const t = new AIChatTransport(tracer);
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
