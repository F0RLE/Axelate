import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Deep mock of Tauri API
const mockInvoke = vi.fn();
const mockListen = vi.fn().mockResolvedValue(() => {});
const mockEmit = vi.fn();

const tauriMock = {
    core: { invoke: mockInvoke },
    event: { listen: mockListen, emit: mockEmit },
};

// Set before import
(globalThis as Record<string, unknown>).__TAURI__ = tauriMock;

// Mock showToast
vi.stubGlobal('showToast', vi.fn());

import { AIBridge } from '../modules/ai/AIBridge';

describe('AIBridge', () => {
    let aiBridge: AIBridge;

    beforeEach(async () => {
        vi.clearAllMocks();
        (globalThis as Record<string, unknown>).__TAURI__ = tauriMock;
        localStorage.clear();
        aiBridge = new AIBridge();

        // Mock session ID for init
        mockInvoke.mockResolvedValueOnce('test-session-123');
        await aiBridge.init();
    });

    afterEach(() => {
        aiBridge.stopProvider();
    });

    describe('constructor', () => {
        it('should register itself on globalThis', () => {
            const global = globalThis as unknown as { aiBridge: AIBridge };
            expect(global.aiBridge).toBeDefined();
        });

        it('should start with no active provider', () => {
            expect(aiBridge.isActive()).toBe(false);
        });

        it('should return null for active provider when none started', () => {
            expect(aiBridge.getActiveProvider()).toBeNull();
        });
    });

    describe('init', () => {
        it('should be callable without errors', async () => {
            await expect(aiBridge.init()).resolves.not.toThrow();
        });
    });

    describe('startProvider', () => {
        it('should activate provider with valid API key', async () => {
            mockInvoke.mockImplementation(async (cmd, args) => {
                if (cmd === 'get_secure_key' && args.service === 'gemini_api_key')
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

        it('should fallback to localStorage when backend returns null', async () => {
            mockInvoke.mockResolvedValue(null);
            localStorage.setItem('gemini_api_key', 'local-key-123');

            const result = await aiBridge.startProvider('gemini');

            expect(result).toBe(true);
        });
    });

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
    });

    describe('sendMessage', () => {
        it('should return message if no provider is active', async () => {
            const result = await aiBridge.sendMessage('Hello');

            expect(result).toContain('No active');
        });

        it('should invoke backend when provider is active', async () => {
            mockInvoke.mockImplementation(async (cmd) => {
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
                    request: expect.any(Object),
                }),
            );
        });
    });

    describe('getState', () => {
        it('should return current bridge state', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            const state = aiBridge.getState();

            expect(state).toHaveProperty('activeProviderId');
            expect(state.activeProviderId).toBe('gemini');
        });
    });

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

    describe('getActiveProvider', () => {
        it('should return provider details when active', async () => {
            mockInvoke.mockResolvedValue('sk-test-key');
            await aiBridge.startProvider('gemini');

            const provider = aiBridge.getActiveProvider();
            expect(provider).not.toBeNull();
            expect(provider?.id).toBe('gemini');
        });
    });
});
