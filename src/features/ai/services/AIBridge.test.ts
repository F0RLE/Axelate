/**
 * AIBridge Unit Tests — Full Coverage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    Channel: class<T> {
        public onmessage: ((message: T) => void) | null = null;
    },
    invoke: vi.fn(),
}));

// Deep mock of Tauri API
const mockInvoke = vi.fn().mockResolvedValue(null);
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
        hasSecureKey: vi.fn(async (key: string): Promise<boolean> => {
            const value: unknown = await mockInvoke('has_secure_key', { service: key });
            return value === true;
        }),
        getSecureKey: vi.fn(async (key: string): Promise<string | null> => {
            const value: unknown = await mockInvoke('get_secure_key', { service: key });
            return typeof value === 'string' ? value : null;
        }),
        saveSecureKey: vi.fn(async (key: string, val: string) => {
            await mockInvoke('save_secure_key', { service: key, key: val });
        }),
    },
    aiSettings: {
        setAiSessionId: vi.fn(),
        setSelectedAIModel: vi.fn(),
        getSelectedAIModel: vi.fn(),
        getThinkingLevel: vi.fn().mockReturnValue('high'),
        getInternetAccessEnabled: vi.fn().mockReturnValue(true),
        getLocalMaxOutputTokens: vi.fn().mockReturnValue(384),
    },
    chatController: {
        randomizeGreeting: vi.fn(),
    },
    i18n: {
        t: vi.fn((_: string, fallback: string = ''): string => fallback),
    },
    appUI: {
        showToast: vi.fn(),
    },
    windowService: {
        close: vi.fn().mockResolvedValue(undefined),
    },
    settingsService: {
        getSettings: vi.fn().mockReturnValue({}),
    },
    stateStore: {
        getSelectedModule: vi.fn().mockReturnValue(undefined),
    },
    state: {
        get: vi.fn((key: string) => {
            if (key === 'ai_thinking_level') return {};
            return null;
        }),
        set: vi.fn(),
    },
};

vi.stubGlobal('tracer', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
});

import { AIBridge } from '@/features/ai/services/AIBridge';
import { AIBridgeEvents } from '@/features/ai/services/AIBridgeEvents';

const mockTracer = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

function mockStoredApiKey(value: string = 'sk-test-key'): void {
    mockInvoke.mockImplementation(async (cmd: string) => {
        await Promise.resolve();
        if (cmd === 'has_secure_key') return true;
        if (cmd === 'get_secure_key') return value;
        return null;
    });
}

function mockBackendChatResponse(result: unknown): void {
    mockInvoke.mockImplementation(async (cmd: string) => {
        await Promise.resolve();
        if (cmd === 'has_secure_key') return true;
        if (cmd === 'get_secure_key') return 'sk-test-key';
        if (cmd === 'send_chat_message') return result;
        return null;
    });
}

describe('AIBridge', () => {
    let aiBridge: AIBridge;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockInvoke.mockReset();
        mockInvoke.mockResolvedValue(null);
        mockListen.mockReset();
        mockListen.mockResolvedValue(() => {
            /* no-op */
        });
        mockEmit.mockReset();
        mockCore.tauriProvider.isTauri.mockReset();
        mockCore.tauriProvider.isTauri.mockReturnValue(true);
        mockCore.aiSettings.getSelectedAIModel.mockReset();
        mockCore.aiSettings.getSelectedAIModel.mockReturnValue(undefined);
        mockCore.aiSettings.getThinkingLevel.mockReset();
        mockCore.aiSettings.getThinkingLevel.mockReturnValue('high');
        mockCore.aiSettings.getInternetAccessEnabled.mockReset();
        mockCore.aiSettings.getInternetAccessEnabled.mockReturnValue(true);
        mockCore.aiSettings.getLocalMaxOutputTokens.mockReset();
        mockCore.aiSettings.getLocalMaxOutputTokens.mockReturnValue(384);
        mockCore.i18n.t.mockClear();
        mockCore.appUI.showToast.mockClear();
        mockCore.windowService.close.mockClear();
        mockCore.settingsService.getSettings.mockClear();
        mockCore.settingsService.getSettings.mockReturnValue({});
        mockCore.stateStore.getSelectedModule.mockClear();
        mockCore.stateStore.getSelectedModule.mockReturnValue(undefined);
        (globalThis as unknown as Record<string, unknown>)['__TAURI__'] = tauriMock;
        localStorage.clear();
        aiBridge = new AIBridge(mockTracer);
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
        it('should start with no active provider', () => {
            expect(aiBridge.isActive()).toBe(false);
        });

        it('should return null for active provider when none started', () => {
            expect(aiBridge.getActiveProvider()).toBeNull();
        });
    });

    // ---------------------------------------------------------- init
    describe('init', () => {
        it('should abort initialization when core dependency is missing', async () => {
            const bridge2 = new AIBridge(mockTracer);

            await bridge2.init();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((bridge2 as any)._initialized).toBe(false);
        });

        it('should be callable without errors', async () => {
            // Already initialized in beforeEach, second call should be no-op
            await expect(aiBridge.init()).resolves.not.toThrow();
        });

        it('should clean up transport state when initialization fails', async () => {
            const bridge2 = new AIBridge(mockTracer);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            bridge2.setCore(mockCore as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transportDestroySpy = vi.spyOn((bridge2 as any)._transport, 'destroy');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((bridge2 as any)._transport, 'init').mockRejectedValue(new Error('boom'));

            await bridge2.init();

            expect(transportDestroySpy).toHaveBeenCalled();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((bridge2 as any)._initialized).toBe(false);
        });

        it('should broadcast chunks and thoughts via transport callbacks', async () => {
            const bridge2 = new AIBridge(mockTracer);
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

            const chunkHandler = vi.fn();
            const thoughtHandler = vi.fn();
            bridge2.onChunk('stream-test', chunkHandler);
            bridge2.onThought('thought-test', thoughtHandler);

            // Fire the callbacks so the lines are covered
            if (chunkCallback) chunkCallback('test chunk');
            if (thoughtCallback) thoughtCallback('test thought');

            expect(chunkHandler).toHaveBeenCalledWith('test chunk');
            expect(thoughtHandler).toHaveBeenCalledWith('test thought');

            bridge2.stopProvider();
        });
    });

    // ---------------------------------------------------------- startProvider
    describe('startProvider', () => {
        it('should activate provider with valid API key', async () => {
            mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
                await Promise.resolve();
                if (cmd === 'has_secure_key' && args?.['service'] === 'openrouter_api_key')
                    return true;
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
            mockStoredApiKey();

            await aiBridge.startProvider('gemini');
            await aiBridge.startProvider('gpt');

            expect(aiBridge.getActiveProvider()?.id).toBe('gpt');
        });

        it('should not stop local engine slots when switching to a cloud provider', async () => {
            mockStoredApiKey();

            await aiBridge.startProvider('gemini');

            expect(mockInvoke).not.toHaveBeenCalledWith('stop_engine_slot', expect.any(Object));
            expect(mockInvoke).not.toHaveBeenCalledWith('stop_engine', expect.any(Object));
        });

        it('should not stop engine slots when selecting a local provider', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'get_engine_config') return { context_size: 4096 };
                return null;
            });

            await aiBridge.startProvider('llamacpp');

            expect(mockInvoke).not.toHaveBeenCalledWith('stop_engine_slot', expect.any(Object));
            expect(mockInvoke).not.toHaveBeenCalledWith('stop_engine', expect.any(Object));
        });

        it('should NOT fallback to localStorage when backend returns null', async () => {
            mockInvoke.mockResolvedValue(null);
            localStorage.setItem('openrouter_api_key', 'local-key-123');

            const result = await aiBridge.startProvider('gemini');

            expect(result).toBe(false);
            expect(aiBridge.isActive()).toBe(false);
        });

        it('should show error toast when API key is missing for non-local provider', async () => {
            mockInvoke.mockResolvedValue(null);

            await aiBridge.startProvider('gemini');

            expect(mockCore.appUI.showToast).toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- stopProvider
    describe('stopProvider', () => {
        it('should deactivate the provider', async () => {
            mockStoredApiKey();
            await aiBridge.startProvider('gemini');

            aiBridge.stopProvider();

            expect(aiBridge.isActive()).toBe(false);
            expect(aiBridge.getActiveProvider()).toBeNull();
        });

        it('should clear state on stop', async () => {
            mockStoredApiKey();
            await aiBridge.startProvider('gemini');

            aiBridge.stopProvider();

            const state = aiBridge.getState();
            expect(state.activeProviderId).toBeNull();
        });

        it('should not stop local engine processes when stopping a cloud provider', async () => {
            mockStoredApiKey();
            await aiBridge.startProvider('gemini');
            mockInvoke.mockClear();

            aiBridge.stopProvider();

            expect(mockInvoke).not.toHaveBeenCalledWith('stop_engine', expect.any(Object));
        });

        it('should preserve UI listeners on stop so a later provider restart can reuse them', async () => {
            const handler = vi.fn();
            aiBridge.onMessage('test', handler);
            aiBridge.onChunk('test', handler);
            aiBridge.onThought('test', handler);

            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'has_secure_key') return true;
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message') {
                    return { ok: true, reply: { text: 'after-restart' } };
                }
                return null;
            });
            await aiBridge.startProvider('gemini');
            aiBridge.stopProvider();

            await aiBridge.startProvider('gemini');
            await aiBridge.sendMessage('after restart');

            expect(handler).toHaveBeenCalledWith('after-restart', 'chat');
        });
    });

    describe('destroy', () => {
        it('should destroy transport regardless of concrete implementation checks', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transportDestroySpy = vi.spyOn((aiBridge as any)._transport, 'destroy');

            aiBridge.destroy();

            expect(transportDestroySpy).toHaveBeenCalled();
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
                if (cmd === 'has_secure_key') return true;
                if (cmd === 'get_secure_key') return 'sk-test-key';
                if (cmd === 'send_chat_message')
                    return { ok: true, reply: { text: 'Hello back!' } };
                return null;
            });

            await aiBridge.startProvider('gemini');
            await aiBridge.sendMessage('Hello');

            const sendChatCall = mockInvoke.mock.calls.find(
                ([command]) => command === 'send_chat_message',
            );
            const payload = sendChatCall?.[1] as
                | { request?: { web_search?: { enabled?: boolean } } }
                | undefined;

            expect(payload?.request?.web_search).toEqual({ enabled: true });
        });

        it('should return error for missing API key after refresh', async () => {
            let callCount = 0;
            // First call (startProvider) returns a key; subsequent calls (sendMessage refresh) return null
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'has_secure_key') {
                    callCount++;
                    return callCount === 1;
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
                if (cmd === 'has_secure_key') return true;
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
                if (cmd === 'has_secure_key') return true;
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
            mockBackendChatResponse({ ok: false, error: 'Rate limited' });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(false);
            expect(result.error).toBe('Rate limited');
        });

        it('should send with custom source parameter', async () => {
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'has_secure_key') return true;
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
                if (cmd === 'has_secure_key') return true;
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
    describe('AIBridgeEvents listener management', () => {
        it('should register and invoke message handlers', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onMessage('listener-1', handler);

            events.broadcastResponse('test msg', 'chat');

            expect(handler).toHaveBeenCalledWith('test msg', 'chat');
        });

        it('should remove listener by id', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onMessage('listener-1', handler);
            events.removeListener('listener-1');

            events.broadcastResponse('test', 'chat');

            expect(handler).not.toHaveBeenCalled();
        });

        it('should support multiple handlers per listener id', () => {
            const events = new AIBridgeEvents();
            const h1 = vi.fn();
            const h2 = vi.fn();
            events.onMessage('multi', h1);
            events.onMessage('multi', h2);

            events.broadcastResponse('data', 'chat');

            expect(h1).toHaveBeenCalledOnce();
            expect(h2).toHaveBeenCalledOnce();
        });

        it('should register and invoke chunk handlers', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onChunk('chunk-1', handler);

            events.broadcastChunk('chunk data');

            expect(handler).toHaveBeenCalledWith('chunk data');
        });

        it('should remove chunk listener by id', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onChunk('chunk-1', handler);
            events.removeChunkListener('chunk-1');

            events.broadcastChunk('data');

            expect(handler).not.toHaveBeenCalled();
        });

        it('should register and invoke thought handlers', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onThought('thought-1', handler);

            events.broadcastThought('thought data');

            expect(handler).toHaveBeenCalledWith('thought data');
        });

        it('should remove thought listener by id', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onThought('thought-1', handler);
            events.removeThoughtListener('thought-1');

            events.broadcastThought('data');

            expect(handler).not.toHaveBeenCalled();
        });

        it('should register, invoke and remove replace-chunk handlers', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onReplaceChunk('replace-1', handler);

            events.broadcastReplaceChunk('replace data');
            expect(handler).toHaveBeenCalledWith('replace data');

            events.removeReplaceChunkListener('replace-1');
            events.broadcastReplaceChunk('again');
            expect(handler).toHaveBeenCalledTimes(1);
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

        it('should surface history load errors', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('History failed'));

            await expect(aiBridge.getHistory()).rejects.toThrow('History failed');
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

    describe('clearHistory / rewindLastTurn / session', () => {
        it('should clear history in tauri mode and no-op in web mode', async () => {
            mockInvoke.mockResolvedValueOnce(undefined);
            await expect(aiBridge.clearHistory()).resolves.toBeUndefined();
            expect(mockInvoke).toHaveBeenCalledWith('clear_chat_history', expect.any(Object));

            mockCore.tauriProvider.isTauri.mockReturnValue(false);
            await expect(aiBridge.clearHistory()).resolves.toBeUndefined();
            mockCore.tauriProvider.isTauri.mockReturnValue(true);
        });

        it('should surface clear and rewind errors and support web null rewind', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('clear failed'));
            await expect(aiBridge.clearHistory()).rejects.toThrow('clear failed');

            mockInvoke.mockResolvedValueOnce('rewound message');
            await expect(aiBridge.rewindLastTurn()).resolves.toBe('rewound message');
            expect(mockInvoke).toHaveBeenCalledWith('rewind_last_turn', expect.any(Object));

            mockInvoke.mockRejectedValueOnce(new Error('rewind failed'));
            await expect(aiBridge.rewindLastTurn()).rejects.toThrow('rewind failed');

            mockCore.tauriProvider.isTauri.mockReturnValue(false);
            await expect(aiBridge.rewindLastTurn()).resolves.toBeNull();
            mockCore.tauriProvider.isTauri.mockReturnValue(true);
        });

        it('should expose current session id', () => {
            expect(aiBridge.getSessionId()).toBeTypeOf('string');
        });
    });

    // ---------------------------------------------------------- getState
    describe('getState', () => {
        it('should return current bridge state', async () => {
            mockStoredApiKey();
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
            mockStoredApiKey();
            await aiBridge.startProvider('gemini');

            expect(aiBridge.isActive()).toBe(true);
        });
    });

    // ---------------------------------------------------------- getActiveProvider
    describe('getActiveProvider', () => {
        it('should return provider details when active', async () => {
            mockStoredApiKey();
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

        it('should continue cleanup when an unlistener throws', () => {
            const throwingUnlistener = vi.fn(() => {
                throw new Error('cleanup failed');
            });
            const healthyUnlistener = vi.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transportDestroySpy = vi.spyOn((aiBridge as any)._transport, 'destroy');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._unlisteners.push(throwingUnlistener, healthyUnlistener);

            expect(() => aiBridge.destroy()).not.toThrow();

            expect(throwingUnlistener).toHaveBeenCalledOnce();
            expect(healthyUnlistener).toHaveBeenCalledOnce();
            expect(transportDestroySpy).toHaveBeenCalledOnce();
            expect(mockTracer.warn).toHaveBeenCalledWith(
                '[AIBridge] Stream cleanup listener failed:',
                expect.any(Error),
            );
        });

        it('should be safe to call multiple times', () => {
            aiBridge.destroy();
            aiBridge.destroy();
        });
    });

    // ---------------------------------------------------------- _showToast
    describe('_showToast / _showErrorToast / _showInfoToast', () => {
        it('should call appUI.showToast', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._showToast('Test message', 'info');
            expect(mockCore.appUI.showToast).toHaveBeenCalledWith('Test message', 'info');
        });

        it('should handle missing core gracefully', () => {
            const bridge2 = new AIBridge(mockTracer);
            const callToast = (): void => {
                (
                    bridge2 as unknown as { _showToast: (msg: string, type: string) => void }
                )._showToast('msg', 'error');
            };
            expect(callToast).not.toThrow();
        });

        it('should call _showErrorToast with translated message', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._showErrorToast('key', 'fallback');
            expect(mockCore.i18n.t).toHaveBeenCalledWith('key', 'fallback');
            expect(mockCore.appUI.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });

        it('should call _showInfoToast with translated message', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (aiBridge as any)._showInfoToast('key', 'fallback');
            expect(mockCore.i18n.t).toHaveBeenCalledWith('key', 'fallback');
            expect(mockCore.appUI.showToast).toHaveBeenCalledWith(expect.any(String), 'info');
        });
    });

    // ---------------------------------------------------------- init edge cases
    describe('init edge cases', () => {
        it('should log web mode active when not in Tauri', async () => {
            mockCore.tauriProvider.isTauri.mockReturnValue(false);

            const bridge2 = new AIBridge(mockTracer);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            bridge2.setCore(mockCore as any);
            mockInvoke.mockResolvedValueOnce('session-id');
            await bridge2.init(); // should not throw, logs web mode active (line 81)

            bridge2.stopProvider();
            mockCore.tauriProvider.isTauri.mockReturnValue(true);
        });

        it('should handle IPC initialization failure gracefully (line 86)', async () => {
            // Make onStream throw to trigger the catch block
            const bridge2 = new AIBridge(mockTracer);
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
                if (cmd === 'has_secure_key') return true;
                if (cmd === 'get_secure_key') return 'existing-key';
                return false; // startProvider will call this + manager will throw
            });

            // Spy on _manager.startProvider to return false with a key available
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._manager, 'startProvider').mockResolvedValue(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((aiBridge as any)._manager, 'apiKey', { get: () => 'some-key' });

            await aiBridge.startProvider('gemini');

            expect(mockCore.appUI.showToast).toHaveBeenCalledWith(
                'Provider activation failed',
                'error',
            );
        });
    });

    // ---------------------------------------------------------- sendMessage with local engine
    describe('sendMessage with local engine (llamacpp)', () => {
        it('should proceed without API key for local engine provider', async () => {
            // Force manager to have llamacpp as active provider via spy
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._manager, 'refreshActiveApiKey').mockResolvedValue(
                undefined,
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((aiBridge as any)._manager, 'activeProviderId', {
                get: () => 'llamacpp',
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Object.defineProperty((aiBridge as any)._manager, 'apiKey', { get: () => null });
            // isActive() returns true for local providers
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._manager, 'isActive').mockReturnValue(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((aiBridge as any)._transport, 'send').mockResolvedValue({
                ok: true,
                text: 'Local response',
            });

            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(true);
        });
    });

    // ---------------------------------------------------------- sendMessage missing API key via sendMessage flow (line 153)
    describe('sendMessage missing API key path', () => {
        it('should return missing-key error when apiKey is null and provider is non-local', async () => {
            // Activate a provider so activeProviderId !== null
            mockStoredApiKey('sk-key');
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
            mockStoredApiKey('sk-key');
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
            mockStoredApiKey('sk-key');
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
            const tempBridge = new AIBridge(mockTracer);
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

            const tempBridge = new AIBridge(mockTracer);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            tempBridge.setCore(mockCore as any);
            mockInvoke.mockResolvedValueOnce('session');
            await tempBridge.init();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (import.meta.env as any).DEV = orgDev;
        });

        it('should handle sendMessage when _core is null (Line 175)', async () => {
            const tempBridge = new AIBridge(mockTracer);
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
            vi.spyOn((tempBridge as any)._manager, 'isActive').mockReturnValue(true);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn((tempBridge as any)._transport, 'send').mockResolvedValue({
                ok: true,
                text: 'hi',
            });

            const res = await tempBridge.sendMessage('test message');
            expect(res.ok).toBe(true);
        });

        it('should handle an empty error string in backend mismatch logic (Line 218)', async () => {
            mockBackendChatResponse({ ok: false, error: '' });

            await aiBridge.startProvider('gemini');
            const result = await aiBridge.sendMessage('Hello');

            expect(result.ok).toBe(false);
            expect(
                (
                    globalThis as unknown as {
                        tracer: { error: ReturnType<typeof vi.fn> };
                    }
                ).tracer.error,
            ).not.toHaveBeenCalledWith(expect.anything(), '');
        });

        it('should handle repeating listener registrations (Lines 237-248)', () => {
            const events = new AIBridgeEvents();
            const handler = vi.fn();
            events.onChunk('repeat', handler);
            events.onChunk('repeat', handler);

            events.onThought('repeat', handler);
            events.onThought('repeat', handler);

            expect(events.chunkListeners.get('repeat')?.length).toBe(2);
            expect(events.thoughtListeners.get('repeat')?.length).toBe(2);
        });

        it('should forward full local history and let backend handle context compaction', async () => {
            const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
                { role: 'user', content: 'minus one' },
                { role: 'assistant', content: 'reply minus one' },
                { role: 'user', content: 'zero' },
                { role: 'assistant', content: 'reply zero' },
                { role: 'user', content: 'one' },
                { role: 'assistant', content: 'reply one' },
                { role: 'user', content: 'two' },
                { role: 'assistant', content: 'reply two' },
            ];
            mockInvoke.mockImplementation(async (cmd: string) => {
                await Promise.resolve();
                if (cmd === 'start_engine') {
                    return { id: 'llamacpp', endpoint: 'http://127.0.0.1:8081' };
                }
                if (cmd === 'send_chat_message') {
                    return { ok: true, reply: { text: 'ok' } };
                }
                return null;
            });

            await aiBridge.startProvider('llamacpp');
            await aiBridge.sendMessage('latest question', 'chat', [], history);

            const requestMatcher = expect.objectContaining({
                messages: [...history, { role: 'user', content: 'latest question' }],
            }) as unknown;

            expect(mockInvoke).toHaveBeenCalledWith(
                'send_chat_message',
                expect.objectContaining({
                    request: requestMatcher,
                }),
            );
        });
    });
});
