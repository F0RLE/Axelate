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
        cloud_api_base_url: 'https://openrouter.ai/api/v1',
        ...overrides,
    };
}

function makeLocalRequest(overrides: Partial<IChatRequest> = {}): IChatRequest {
    const request = makeRequest({
        provider: 'llamacpp',
        model: 'model.gguf',
        ...overrides,
    });
    delete request.cloud_api_base_url;
    return request;
}

describe('AIChatTransport', () => {
    let transport: AIChatTransport;
    let mockCore: ReturnType<typeof createMockCore>;
    let tracer: Pick<LoggerService, 'debug' | 'info' | 'warn' | 'error'>;

    beforeEach(() => {
        vi.useFakeTimers();
        tracer = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        transport = new AIChatTransport(tracer);
        mockCore = createMockCore();
        transport.setContext(mockCore as unknown as Parameters<typeof transport.setContext>[0]);
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

        it('should timeout cloud requests after 90 seconds', async () => {
            let requestId = '';
            mockCore.tauriProvider.invoke.mockImplementation(
                (command: string, args: Record<string, unknown>) => {
                    if (command === 'cancel_chat_generation') {
                        return Promise.resolve(true);
                    }
                    requestId = (args['request'] as { request_id: string }).request_id;
                    return new Promise(() => {});
                },
            );

            const sendPromise = transport.send(makeRequest());

            // Advance timers past the 90s timeout
            vi.advanceTimersByTime(90_001);

            const result = await sendPromise;
            expect(result).toEqual({ ok: false, error: 'AI request timed out' });
            expect(mockCore.tauriProvider.invoke).toHaveBeenCalledWith('cancel_chat_generation', {
                requestId,
            });
        });

        it('should keep local text requests alive past the cloud timeout', async () => {
            let resolveInvoke: (
                response: Awaited<ReturnType<typeof mockCore.tauriProvider.invoke>>,
            ) => void = () => {
                throw new Error('invoke promise was not started');
            };
            mockCore.tauriProvider.invoke.mockImplementation((command: string) =>
                command === 'send_chat_message'
                    ? new Promise((resolve) => {
                          resolveInvoke = resolve;
                      })
                    : Promise.resolve(true),
            );

            const sendPromise = transport.send(makeLocalRequest());
            vi.advanceTimersByTime(90_001);
            await Promise.resolve();

            expect(mockCore.tauriProvider.invoke).not.toHaveBeenCalledWith(
                'cancel_chat_generation',
                expect.anything(),
            );

            resolveInvoke({ ok: true, reply: { text: 'local done' } });
            await expect(sendPromise).resolves.toEqual({ ok: true, text: 'local done' });
        });

        it('should keep self-hosted local endpoints alive past the cloud timeout', async () => {
            let resolveInvoke: (
                response: Awaited<ReturnType<typeof mockCore.tauriProvider.invoke>>,
            ) => void = () => {
                throw new Error('invoke promise was not started');
            };
            mockCore.tauriProvider.invoke.mockImplementation((command: string) =>
                command === 'send_chat_message'
                    ? new Promise((resolve) => {
                          resolveInvoke = resolve;
                      })
                    : Promise.resolve(true),
            );

            const sendPromise = transport.send(
                makeRequest({
                    provider: 'custom-text',
                    cloud_api_base_url: 'http://127.0.0.1:8080/v1',
                }),
            );
            vi.advanceTimersByTime(90_001);
            await Promise.resolve();

            expect(mockCore.tauriProvider.invoke).not.toHaveBeenCalledWith(
                'cancel_chat_generation',
                expect.anything(),
            );

            resolveInvoke({ ok: true, reply: { text: 'local endpoint done' } });
            await expect(sendPromise).resolves.toEqual({
                ok: true,
                text: 'local endpoint done',
            });
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

        it('should keep timed-out requests cancellable before clearing active state', async () => {
            let requestId = '';
            mockCore.tauriProvider.invoke.mockImplementation(
                (command: string, args: Record<string, unknown>) => {
                    if (command === 'cancel_chat_generation') {
                        return Promise.resolve(true);
                    }

                    requestId = (args['request'] as { request_id: string }).request_id;
                    return new Promise(() => {});
                },
            );

            const sendPromise = transport.send(makeRequest());
            vi.advanceTimersByTime(90_001);

            await expect(sendPromise).resolves.toEqual({
                ok: false,
                error: 'AI request timed out',
            });
            expect(mockCore.tauriProvider.invoke).toHaveBeenCalledWith('cancel_chat_generation', {
                requestId,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((transport as any)._activeChatRequestId).toBeNull();
        });
    });

    describe('sendSilent', () => {
        it('should register its request and cancel stale active work before sending', async () => {
            let sendCalls = 0;
            let firstRequestId = '';
            mockCore.tauriProvider.invoke.mockImplementation(
                (command: string, args: Record<string, unknown>) => {
                    if (command === 'cancel_chat_generation') {
                        return Promise.resolve(true);
                    }

                    sendCalls += 1;
                    const request = args['request'] as { request_id: string };
                    if (sendCalls === 1) {
                        firstRequestId = request.request_id;
                        return new Promise(() => {});
                    }
                    return Promise.resolve({ ok: true, reply: { text: 'silent' } });
                },
            );

            const firstSend = transport.send(makeRequest());
            await Promise.resolve();

            await expect(transport.sendSilent(makeRequest())).resolves.toEqual({
                ok: true,
                text: 'silent',
            });
            expect(mockCore.tauriProvider.invoke).toHaveBeenCalledWith('cancel_chat_generation', {
                requestId: firstRequestId,
            });

            vi.advanceTimersByTime(90_001);
            await firstSend;
        });

        it('should cancel a timed-out silent cloud request before clearing active state', async () => {
            let requestId = '';
            mockCore.tauriProvider.invoke.mockImplementation(
                (command: string, args: Record<string, unknown>) => {
                    if (command === 'cancel_chat_generation') {
                        return Promise.resolve(true);
                    }

                    requestId = (args['request'] as { request_id: string }).request_id;
                    return new Promise(() => {});
                },
            );

            const sendPromise = transport.sendSilent(makeRequest());
            vi.advanceTimersByTime(90_001);

            await expect(sendPromise).resolves.toEqual({
                ok: false,
                error: 'AI request timed out',
            });
            expect(mockCore.tauriProvider.invoke).toHaveBeenCalledWith('cancel_chat_generation', {
                requestId,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((transport as any)._activeChatRequestId).toBeNull();
        });

        it('should use the local timeout for silent local prompt preparation', async () => {
            let resolveInvoke: (
                response: Awaited<ReturnType<typeof mockCore.tauriProvider.invoke>>,
            ) => void = () => {
                throw new Error('invoke promise was not started');
            };
            mockCore.tauriProvider.invoke.mockImplementation((command: string) =>
                command === 'send_chat_message'
                    ? new Promise((resolve) => {
                          resolveInvoke = resolve;
                      })
                    : Promise.resolve(true),
            );

            const sendPromise = transport.sendSilent(makeLocalRequest());
            vi.advanceTimersByTime(90_001);
            await Promise.resolve();

            expect(mockCore.tauriProvider.invoke).not.toHaveBeenCalledWith(
                'cancel_chat_generation',
                expect.anything(),
            );

            resolveInvoke({ ok: true, reply: { text: 'prepared' } });
            await expect(sendPromise).resolves.toEqual({ ok: true, text: 'prepared' });
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

        it('should keep notifying listeners when one stream listener throws', async () => {
            const failingListener = vi.fn(() => {
                throw new Error('listener failed');
            });
            const healthyListener = vi.fn();
            invokeMethod(failingListener);
            invokeMethod(healthyListener);
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

            expect(failingListener).toHaveBeenCalledWith('current');
            expect(healthyListener).toHaveBeenCalledWith('current');
            expect(tracer.error).toHaveBeenCalledWith(
                '[AIChatTransport] Stream listener failed:',
                expect.any(Error),
            );
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
            mockCore.tauriProvider.invoke.mockImplementation((command: string) => {
                if (command === 'cancel_chat_generation') {
                    return Promise.resolve(true);
                }
                return new Promise(() => {});
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
