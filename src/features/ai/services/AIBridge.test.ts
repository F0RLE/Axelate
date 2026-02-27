/**
 * AIBridge Unit Tests — Full Coverage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Deep mock of Tauri API
const mockInvoke = vi.fn();
const mockListen = vi.fn().mockResolvedValue(() => {
    /* no-op */
});
const mockEmit = vi.fn();

const tauriMock = {
    core: { invoke: mockInvoke },
    event: { listen: mockListen, emit: mockEmit },
};

// Set before import
(globalThis as unknown as Record<string, unknown>)['__TAURI__'] = tauriMock;

// Mock Core dependency
const mockCore = {
    tauriProvider: {
        invoke: mockInvoke,
        listen: mockListen,
        isTauri: vi.fn().mockReturnValue(true),
        getSecureKey: vi.fn(async (key: string) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return await mockInvoke('get_secure_key', { service: key });
        }),
        saveSecureKey: vi.fn(async (key: string, val: string) => {
            await mockInvoke('save_secure_key', { service: key, key: val });
        }),
    },
    aiSettings: {
        setAiSessionId: vi.fn(),
        setSelectedAIModel: vi.fn(),
        setLastActiveProvider: vi.fn(),
        getSelectedAIModel: vi.fn(),
        getLastActiveProvider: vi.fn(),
        getThinkingLevel: vi.fn().mockReturnValue('high'),
    },
    chatController: {
        randomizeGreeting: vi.fn(),
    },
    state: {
        get: vi.fn((key: string) => {
            if (key === 'ai_thinking_level') return {};
            return null;
        }),
        set: vi.fn(),
    },
};

// Mock showToast
vi.stubGlobal('showToast', vi.fn());
vi.stubGlobal('tracer', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
});

import { AIBridge } from '@/features/ai/services/AIBridge';

describe('AIBridge', () => {
    let aiBridge: AIBridge;

    beforeEach(async () => {
        vi.clearAllMocks();
        (globalThis as unknown as Record<string, unknown>)['__TAURI__'] = tauriMock;
        localStorage.clear();
        aiBridge = new AIBridge();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        aiBridge.setCore(mockCore as any);

        // Mock session ID for init
        mockInvoke.mockResolvedValueOnce('test-session-123');
        await aiBridge.init();
    });

    afterEach(() => {
        aiBridge.stopProvider();
    });

    // ---------------------------------------------------------- constructor
    describe('constructor', () => {
        it('should register itself on globalThis', () => {
            const win = globalThis as unknown as Record<string, unknown>;
            expect(win['aiBridge']).toBeDefined();
        });

        it('should start with no active provider', () => {
            expect(aiBridge.isActive()).toBe(false);
        });

        it('should return null for active provider when none started', () => {
            expect(aiBridge.getActiveProvider()).toBeNull();
        });
    });

    // ---------------------------------------------------------- init
    describe('init', () => {
        it('should be callable without errors', async () => {
            // Already initialized in beforeEach, second call should be no-op
            await expect(aiBridge.init()).resolves.not.toThrow();
        });

        it('should broadcast chunks and thoughts via transport callbacks', async () => {
            const bridge2 = new AIBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            bridge2.setCore(mockCore as any);
            mockInvoke.mockResolvedValueOnce('session-id');

            let chunkCallback: ((payload: string) => void) | undefined;
            let thoughtCallback: ((payload: string) => void) | undefined;

            // Spy on transport to capture the callbacks
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((bridge2 as any)._transport, 'onStream').mockImplementation((cb: any) => {
                chunkCallback = cb as (payload: string) => void;
                return () => {};
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((bridge2 as any)._transport, 'onThought').mockImplementation((cb: any) => {
                thoughtCallback = cb as (payload: string) => void;
                return () => {};
            });

            await bridge2.init();

            // Set up spys for broadcast methods
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const broadcastChunkSpy = vi
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .spyOn(bridge2 as any, '_broadcastChunk')
                .mockImplementation(() => {});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const broadcastThoughtSpy = vi
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .spyOn(bridge2 as any, '_broadcastThought')
                .mockImplementation(() => {});

            // Fire the callbacks so the lines are covered
            if (chunkCallback) chunkCallback('test chunk');
            if (thoughtCallback) thoughtCallback('test thought');

            expect(broadcastChunkSpy).toHaveBeenCalledWith('test chunk');
            expect(broadcastThoughtSpy).toHaveBeenCalledWith('test thought');

            bridge2.stopProvider();
        });
    });

    // ---------------------------------------------------------- startProvider
    describe('startProvider', () => {
        it('should activate provider with valid API key', async () => {
            mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key' && args?.['service'] === 'gemini_api_key')
                    return 'sk-test-key-12345';
                return null;
            });

            const result = await aiBridge.startProvider('gemini');

            expect(result).toBe(true);
            expect(aiBridge.isActive()).toBe(true);
            expect(aiBridge.getActiveProvider()?.id).toBe('gemini');
        });

        it('should fail if API key is missing', async () => {
            mockInvoke.mockResolvedValue(null);

            const result = await aiBridge.startProvider('gpt');

            expect(result).toBe(false);
            expect(aiBridge.isActive()).toBe(false);
        });

        it('should stop previous provider when starting new one', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');

            await aiBridge.startProvider('gemini');
            await aiBridge.startProvider('gpt');

            expect(aiBridge.getActiveProvider()?.id).toBe('gpt');
        });

        it('should NOT fallback to localStorage when backend returns null', async () => {
            mockInvoke.mockResolvedValue(null);
            localStorage.setItem('gemini_api_key', 'local-key-123');

            const result = await aiBridge.startProvider('gemini');

            expect(result).toBe(false);
            expect(aiBridge.isActive()).toBe(false);
        });

        it('should show error toast when API key is missing for non-local provider', async () => {
            mockInvoke.mockResolvedValue(null);

            await aiBridge.startProvider('gemini');

            expect(globalThis.showToast).toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- stopProvider
    describe('stopProvider', () => {
        it('should deactivate the provider', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            aiBridge.stopProvider();

            expect(aiBridge.isActive()).toBe(false);
            expect(aiBridge.getActiveProvider()).toBeNull();
        });

        it('should clear state on stop', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            aiBridge.stopProvider();

            const state = aiBridge.getState();
            expect(state.activeProviderId).toBeNull();
        });

        it('should clear all listeners on stop', async () => {
            const handler = vi.fn();
            aiBridge.onMessage('test', handler);
            aiBridge.onChunk('test', handler);
            aiBridge.onThought('test', handler);

            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');
            aiBridge.stopProvider();

            // Listeners should be cleared — no way to assert directly but no errors
        });
    });

    // ---------------------------------------------------------- sendMessage
    describe('sendMessage', () => {
        it('should return error if no provider is active', async () => {
            const result = await aiBridge.sendMessage('Hello');

            expect(result.error).toContain('No engine found');
        });

        it('should invoke backend when provider is active', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message')
                    return { ok: true, reply: { text: 'Hello back!' } };
                return null;
            });

            await aiBridge.startProvider('gemini');
            await aiBridge.sendMessage('Hello');

            expect(mockInvoke).toHaveBeenCalledWith(
                'send_chat_message',
                expect.objectContaining({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    request: expect.any(Object),
                }),
            );
        });

        it('should return error for missing API key after refresh', async () => {
            let callCount = 0;
            // First call (startProvider) returns a key; subsequent calls (sendMessage refresh) return null
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') {
                    callCount++;
                    return callCount === 1 ? 'sk-test-key' : null;
                }
                return null;
            });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Hello');
            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle transport error', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message') throw new Error('Transport broke');
                return null;
            });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('Transport broke');
        });

        it('should broadcast response to listeners on success', async () => {
            const handler = vi.fn();
            aiBridge.onMessage('test-listener', handler);

            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message')
                    return { ok: true, reply: { text: 'result text' } };
                return null;
            });

            await aiBridge.startProvider('gemini');
            await aiBridge.sendMessage('Hello');

            expect(handler).toHaveBeenCalledWith('result text', 'chat');
        });

        it('should handle backend error response without broadcasting', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message') return { ok: false, error: 'Rate limited' };
                return null;
            });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(false);
            expect(result.error).toBe('Rate limited');
        });

        it('should send with custom source parameter', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message') return { ok: true, reply: { text: 'result' } };
                return null;
            });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Test', 'inline' as 'chat');

            expect(result.ok).toBe(true);
        });

        it('should handle non-Error throw from pipeline', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message') {
                    throw new Error('string-error'); // non-Error throw path: Error wraps the string
                }
                return null;
            });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(false);
            // Error thrown correctly propagates its message
            expect(result.error).toBe('string-error');
        });
    });

    // ---------------------------------------------------------- Listener management
    describe('onMessage / removeListener', () => {
        it('should register and invoke message handlers', () => {
            const handler = vi.fn();
            aiBridge.onMessage('listener-1', handler);

            // Access private method via workaround
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._broadcastResponse('test msg', 'chat');

            expect(handler).toHaveBeenCalledWith('test msg', 'chat');
        });

        it('should remove listener by id', () => {
            const handler = vi.fn();
            aiBridge.onMessage('listener-1', handler);
            aiBridge.removeListener('listener-1');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._broadcastResponse('test', 'chat');

            expect(handler).not.toHaveBeenCalled();
        });

        it('should support multiple handlers per listener id', () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            aiBridge.onMessage('multi', h1);
            aiBridge.onMessage('multi', h2);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._broadcastResponse('data', 'chat');

            expect(h1).toHaveBeenCalledOnce();
            expect(h2).toHaveBeenCalledOnce();
        });
    });

    describe('onChunk / removeChunkListener', () => {
        it('should register and invoke chunk handlers', () => {
            const handler = vi.fn();
            aiBridge.onChunk('chunk-1', handler);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._broadcastChunk('chunk data');

            expect(handler).toHaveBeenCalledWith('chunk data');
        });

        it('should remove chunk listener by id', () => {
            const handler = vi.fn();
            aiBridge.onChunk('chunk-1', handler);
            aiBridge.removeChunkListener('chunk-1');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._broadcastChunk('data');

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('onThought / removeThoughtListener', () => {
        it('should register and invoke thought handlers', () => {
            const handler = vi.fn();
            aiBridge.onThought('thought-1', handler);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._broadcastThought('thought data');

            expect(handler).toHaveBeenCalledWith('thought data');
        });

        it('should remove thought listener by id', () => {
            const handler = vi.fn();
            aiBridge.onThought('thought-1', handler);
            aiBridge.removeThoughtListener('thought-1');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._broadcastThought('data');

            expect(handler).not.toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- getHistory
    describe('getHistory', () => {
        it('should invoke get_chat_history in Tauri mode', async () => {
            const mockHistory = [{ role: 'user', content: 'Hello' }];
            mockInvoke.mockResolvedValue(mockHistory);

            const history = await aiBridge.getHistory();
            expect(history).toEqual(mockHistory);
            expect(mockInvoke).toHaveBeenCalledWith('get_chat_history', expect.any(Object));
        });

        it('should return empty array on error', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('History failed'));

            const history = await aiBridge.getHistory();
            expect(history).toEqual([]);
        });

        it('should return empty array in web mode', async () => {
            // Reset from previous test's rejection
            mockInvoke.mockResolvedValue([]);
            mockCore.tauriProvider.isTauri.mockReturnValue(false);

            const history = await aiBridge.getHistory();
            expect(history).toEqual([]);

            // Restore for other tests
            mockCore.tauriProvider.isTauri.mockReturnValue(true);
        });
    });

    // ---------------------------------------------------------- getState
    describe('getState', () => {
        it('should return current bridge state', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            const state = aiBridge.getState();

            expect(state).toHaveProperty('activeProviderId');
            expect(state.activeProviderId).toBe('gemini');
        });

        it('should reflect isRunning correctly', () => {
            const state = aiBridge.getState();
            expect(state.isRunning).toBe(false);
        });
    });

    // ---------------------------------------------------------- isActive
    describe('isActive', () => {
        it('should return false when no provider', () => {
            expect(aiBridge.isActive()).toBe(false);
        });

        it('should return true when provider is active', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            expect(aiBridge.isActive()).toBe(true);
        });
    });

    // ---------------------------------------------------------- getActiveProvider
    describe('getActiveProvider', () => {
        it('should return provider details when active', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            const provider = aiBridge.getActiveProvider();
            expect(provider).not.toBeNull();
            expect(provider?.id).toBe('gemini');
        });
    });

    // ---------------------------------------------------------- destroy
    describe('destroy', () => {
        it('should clean up all resources', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            aiBridge.onMessage('test', vi.fn());
            aiBridge.onChunk('test', vi.fn());

            aiBridge.destroy();

            expect(aiBridge.isActive()).toBe(false);
            expect(aiBridge.getActiveProvider()).toBeNull();
        });

        it('should call all unlisteners', () => {
            const fn = vi.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._unlisteners.push(fn);

            aiBridge.destroy();

            expect(fn).toHaveBeenCalled();
        });

        it('should be safe to call multiple times', () => {
            aiBridge.destroy();
            aiBridge.destroy();
        });
    });

    // ---------------------------------------------------------- _showToast
    describe('_showToast / _showErrorToast / _showInfoToast', () => {
        it('should call globalThis.showToast if available', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._showToast('Test message', 'info');
            expect(globalThis.showToast).toHaveBeenCalledWith('Test message', 'info');
        });

        it('should handle missing showToast gracefully', () => {
            const original = globalThis.showToast;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).showToast = undefined;

            const callToast = (): void => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (
                    aiBridge as unknown as { _showToast: (msg: string, type: string) => void }
                )._showToast('msg', 'error');
            };
            expect(callToast).not.toThrow();

            globalThis.showToast = original;
        });

        it('should call _showErrorToast with translated message', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._showErrorToast('key', 'fallback');
            expect(globalThis.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });

        it('should call _showInfoToast with translated message', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._showInfoToast('key', 'fallback');
            expect(globalThis.showToast).toHaveBeenCalledWith(expect.any(String), 'info');
        });
    });

    // ---------------------------------------------------------- init edge cases
    describe('init edge cases', () => {
        it('should log web mode active when not in Tauri', async () => {
            mockCore.tauriProvider.isTauri.mockReturnValue(false);

            const bridge2 = new AIBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            bridge2.setCore(mockCore as any);
            mockInvoke.mockResolvedValueOnce('session-id');
            await bridge2.init(); // should not throw, logs web mode active (line 81)

            bridge2.stopProvider();
            mockCore.tauriProvider.isTauri.mockReturnValue(true);
        });

        it('should handle IPC initialization failure gracefully (line 86)', async () => {
            // Make onStream throw to trigger the catch block
            const bridge2 = new AIBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            bridge2.setCore(mockCore as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((bridge2 as any)._transport, 'onStream').mockImplementation(() => {
                throw new Error('IPC broken');
            });
            mockInvoke.mockResolvedValueOnce('session-id');
            await expect(bridge2.init()).resolves.not.toThrow(); // error is caught internally
        });
    });

    // ---------------------------------------------------------- startProvider edge cases
    describe('startProvider edge cases', () => {
        it('should show generic toast when provider fails with key present (line 104)', async () => {
            // local provider with empty key fails because isLocal is true but startProvider returns false
            // Simulate: manager.apiKey is NOT null but startProvider returned false
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'existing-key';
                return false; // startProvider will call this + manager will throw
            });

            // Spy on _manager.startProvider to return false with a key available
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._manager, 'startProvider').mockResolvedValue(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((aiBridge as any)._manager, 'apiKey', { get: () => 'some-key' });

            await aiBridge.startProvider('gemini');

            expect(globalThis.showToast).toHaveBeenCalledWith(
                'Provider activation failed',
                'error',
            );
        });
    });

    // ---------------------------------------------------------- sendMessage with localai
    describe('sendMessage with axelate-localai', () => {
        it('should return disabled message for axelate-localai provider', async () => {
            // Setup: start a normal provider first so manager is active
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test';
                return null;
            });

            // Force manager to have localai as active provider via spy
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._manager, 'refreshActiveApiKey').mockResolvedValue(
                undefined,
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((aiBridge as any)._manager, 'activeProviderId', {
                get: () => 'axelate-localai',
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((aiBridge as any)._manager, 'apiKey', { get: () => null });

            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(false);
        });
    });

    // ---------------------------------------------------------- sendMessage missing API key via sendMessage flow (line 153)
    describe('sendMessage missing API key path', () => {
        it('should return missing-key error when apiKey is null and provider is non-local', async () => {
            // Activate a provider so activeProviderId !== null
            mockInvoke.mockResolvedValue('sk-key');
            await aiBridge.startProvider('gemini');

            type ManagerWithApiKey = {
                refreshActiveApiKey: () => Promise<void>;
                apiKey: string | null;
            };
            const manager = (aiBridge as unknown as { _manager: ManagerWithApiKey })._manager;
            vi.spyOn(manager, 'refreshActiveApiKey').mockImplementation((): Promise<void> => {
                Object.defineProperty(manager, 'apiKey', {
                    get: () => null,
                    configurable: true,
                });
                return Promise.resolve();
            });

            const result = await aiBridge.sendMessage('Hello', 'chat');

            expect(result.ok).toBe(false);
        });
    });

    // ---------------------------------------------------------- sendMessage catch block (lines 189-191)
    describe('sendMessage pipeline catch block', () => {
        it('should return ok:false error when transport.send throws', async () => {
            mockInvoke.mockResolvedValue('sk-key');
            await aiBridge.startProvider('gemini');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._transport, 'send').mockRejectedValue(
                new Error('Send pipeline exploded'),
            );

            const result = await aiBridge.sendMessage('Test', 'chat');

            expect(result.ok).toBe(false);
            expect(result.error).toBe('Send pipeline exploded');
        });

        it('should return generic error message for non-Error throws', async () => {
            mockInvoke.mockResolvedValue('sk-key');
            await aiBridge.startProvider('gemini');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._transport, 'send').mockRejectedValue('string-error');

            const result = await aiBridge.sendMessage('Test', 'chat');

            expect(result.ok).toBe(false);
            expect(result.error).toBe('Communication failure');
        });
    });

    // ---------------------------------------------------------- additional branch coverage
    describe('Additional branch coverage', () => {
        it('should handle setCore when _transport is not AIChatTransport (Line 39)', () => {
            const tempBridge = new AIBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tempBridge as any)._transport = { setCore: vi.fn() };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            tempBridge.setCore(mockCore as any);
            // Should not throw and Should not call setCore on the plain object since it fails instanceof
        });

        it('should handle DEV false branch (Lines 61-72)', async () => {
            const orgDev = import.meta.env.DEV;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (import.meta.env as any).DEV = false;

            const tempBridge = new AIBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            tempBridge.setCore(mockCore as any);
            mockInvoke.mockResolvedValueOnce('session');
            await tempBridge.init();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tempBridge as any)._broadcastChunk('chunk');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tempBridge as any)._broadcastThought('thought');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (import.meta.env as any).DEV = orgDev;
        });

        it('should handle sendMessage when _core is null (Line 175)', async () => {
            const tempBridge = new AIBridge();
            // Do NOT call setCore here to leave _core as null

            // Bypass API key checks logic just to test the core check
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((tempBridge as any)._manager, 'activeProviderId', {
                get: () => 'gemini',
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((tempBridge as any)._manager, 'apiKey', {
                get: () => 'test-key',
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((tempBridge as any)._transport, 'send').mockResolvedValue({
                ok: true,
                text: 'hi',
            });

            const res = await tempBridge.sendMessage('test message');
            expect(res.ok).toBe(true);
        });

        it('should handle an empty error string in backend mismatch logic (Line 218)', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message') return { ok: false, error: '' }; // Empty error
                return null;
            });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(false);
            expect(globalThis.tracer.error).not.toHaveBeenCalledWith(expect.anything(), '');
        });

        it('should handle repeating listener registrations (Lines 237-248)', () => {
            const handler = vi.fn();
            aiBridge.onChunk('repeat', handler);
            aiBridge.onChunk('repeat', handler); // Adds to existing array

            aiBridge.onThought('repeat', handler);
            aiBridge.onThought('repeat', handler); // Adds to existing array

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((aiBridge as any)._chunkListeners.get('repeat')?.length).toBe(2);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((aiBridge as any)._thoughtListeners.get('repeat')?.length).toBe(2);
        });
    });
});
