/**
 * AIProviderManager Unit Tests — Full Coverage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProviderManager } from '@/features/ai/services/AIProviderManager';
import type { Core } from '@/app/init';
import { getMostPowerfulModel, getModelData } from '@/features/ai/utils/catalogHelpers';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { CUSTOM_TEXT_PROVIDER_ID } from '@/shared/utils/customProviderSupport';

// Mock catalogHelpers used internally
vi.mock('@/features/ai/utils/catalogHelpers', () => ({
    getModelData: vi.fn(() => null),
    getMostPowerfulModel: vi.fn(() => null),
}));

function createMockCore(
    getKeyFn: (k: string) => Promise<string | null> = () => Promise.resolve(null),
    hasKeyFn: (k: string) => Promise<boolean> = async (key: string) => {
        const value = await getKeyFn(key);
        return value !== null && value !== '';
    },
): Core {
    return {
        tauriProvider: {
            getSecureKey: vi.fn(getKeyFn),
            saveSecureKey: vi.fn().mockResolvedValue(undefined),
            hasSecureKey: vi.fn(hasKeyFn),
        },
        catalog: {
            getCatalog: vi.fn().mockReturnValue({ ai: [], services: [] }),
        },
        aiSettings: {
            setAiSessionId: vi.fn(),
            setSelectedAIModel: vi.fn(),
            getSelectedAIModel: vi.fn().mockReturnValue(null),
        },
    } as unknown as Core;
}

describe('AIProviderManager', () => {
    let manager: AIProviderManager;
    let tracer: Pick<LoggerService, 'info' | 'error'>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getMostPowerfulModel).mockReturnValue('');
        vi.mocked(getModelData).mockReturnValue(null);
        tracer = {
            info: vi.fn(),
            error: vi.fn(),
        };
        manager = new AIProviderManager(tracer);
    });

    // ---------------------------------------------------------- init
    describe('init', () => {
        it('should generate and save a new session ID if none exists', async () => {
            const mockCore = createMockCore(() => Promise.resolve(null));
            manager.setCore(mockCore);

            await manager.init();

            expect(mockCore.tauriProvider.saveSecureKey).toHaveBeenCalledWith(
                'ai_session_id',
                expect.any(String),
            );
            expect(mockCore.aiSettings.setAiSessionId).toHaveBeenCalledWith(expect.any(String));
            expect(manager.sessionId).not.toBe('default');
        });

        it('should restore existing session ID without saving', async () => {
            const mockCore = createMockCore(() => Promise.resolve('existing-session-abc'));
            manager.setCore(mockCore);

            await manager.init();

            expect(mockCore.tauriProvider.saveSecureKey).not.toHaveBeenCalled();
            expect(manager.sessionId).toBe('existing-session-abc');
        });

        it('should work without core set (generates UUID session)', async () => {
            await expect(manager.init()).resolves.not.toThrow();
            // Without core, _getSecureVal returns null → randomUUID is generated
            expect(manager.sessionId).not.toBe('default');
            expect(manager.sessionId.length).toBeGreaterThan(0);
        });
    });

    // ---------------------------------------------------------- startProvider
    describe('startProvider', () => {
        it('should return true immediately if same provider already active', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            manager.setCore(mockCore);
            await manager.startProvider('gemini');

            const result = await manager.startProvider('gemini');
            expect(result).toBe(true);
        });

        it('should stop previous provider when switching', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            manager.setCore(mockCore);

            await manager.startProvider('gemini');
            await manager.startProvider('gpt');

            expect(manager.activeProviderId).toBe('gpt');
        });

        it('should return false if API key is empty for non-local provider', async () => {
            const mockCore = createMockCore(() => Promise.resolve(''));
            manager.setCore(mockCore);

            const result = await manager.startProvider('gemini');
            expect(result).toBe(false);
            expect(manager.isActive()).toBe(false);
            expect(mockCore.tauriProvider.hasSecureKey).toHaveBeenCalledWith('openrouter_api_key');
        });

        it('should succeed for local provider without a key', async () => {
            const mockCore = createMockCore(() => Promise.resolve(''));
            manager.setCore(mockCore);

            const result = await manager.startProvider('local');
            expect(result).toBe(true);
        });

        it('should return false and log on exception (lines 71-72)', async () => {
            const mockCore = createMockCore(() =>
                Promise.reject(new Error('Secure storage crash')),
            );
            manager.setCore(mockCore);

            const result = await manager.startProvider('gemini');
            expect(result).toBe(false);
        });

        it('should persist the resolved model via aiSettings', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-test'));
            manager.setCore(mockCore);

            await manager.startProvider('gemini');

            expect(mockCore.aiSettings.setSelectedAIModel).toHaveBeenCalledWith(
                'gemini',
                expect.any(String),
            );
        });
    });

    // ---------------------------------------------------------- stopProvider
    describe('stopProvider', () => {
        it('should clear state when active', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            manager.setCore(mockCore);
            await manager.startProvider('gemini');

            manager.stopProvider();

            expect(manager.activeProviderId).toBeNull();
            expect(manager.apiKey).toBeNull();
            expect(manager.isActive()).toBe(false);
        });

        it('should be a no-op when not active', () => {
            manager.stopProvider();
            expect(manager.activeProviderId).toBeNull();
        });
    });

    // ---------------------------------------------------------- isActive
    describe('isActive', () => {
        it('should return false when no provider', () => {
            expect(manager.isActive()).toBe(false);
        });

        it('should return true for local engine without key', async () => {
            const mockCore = createMockCore(() => Promise.resolve(''));
            manager.setCore(mockCore);
            await manager.startProvider('llamacpp');

            expect(manager.isActive()).toBe(true);
        });

        it('should treat custom providers as cloud providers requiring the shared key', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            manager.setCore(mockCore);

            const result = await manager.startProvider(CUSTOM_TEXT_PROVIDER_ID);

            expect(result).toBe(true);
            expect(manager.isActive()).toBe(true);
            expect(mockCore.tauriProvider.hasSecureKey).toHaveBeenCalledWith('openrouter_api_key');
        });
    });

    // ---------------------------------------------------------- refreshActiveApiKey
    describe('refreshActiveApiKey', () => {
        it('should update apiKey if it changed', async () => {
            let hasKey = true;
            const mockCore = createMockCore(
                () => Promise.resolve('original-key'),
                () => Promise.resolve(hasKey),
            );
            manager.setCore(mockCore);
            await manager.startProvider('gemini');

            hasKey = false;
            await manager.refreshActiveApiKey();

            expect(manager.apiKey).toBeNull();
            expect(mockCore.tauriProvider.hasSecureKey).toHaveBeenLastCalledWith(
                'openrouter_api_key',
            );
        });

        it('should do nothing if no active provider', async () => {
            await manager.refreshActiveApiKey();
        });
    });

    // ---------------------------------------------------------- _saveSecureVal (lines 163-168)
    describe('_saveSecureVal (via init)', () => {
        it('should save session ID when core is present and no session exists', async () => {
            const mockCore = createMockCore(() => Promise.resolve(null));
            manager.setCore(mockCore);

            await manager.init();

            expect(mockCore.tauriProvider.saveSecureKey).toHaveBeenCalled();
        });

        it('should silently skip save when core is absent', async () => {
            await expect(manager.init()).resolves.not.toThrow();
        });
    });

    // ---------------------------------------------------------- getters
    describe('getters', () => {
        it('maxOutputTokens should return undefined when inactive', () => {
            expect(manager.maxOutputTokens).toBeUndefined();
        });

        it('getProviderDisplayName should return known names', () => {
            expect(manager.getProviderDisplayName('gpt')).toBe('OpenAI GPT');
            expect(manager.getProviderDisplayName('gemini')).toBe('Google Gemini');
            expect(manager.getProviderDisplayName(CUSTOM_TEXT_PROVIDER_ID)).toBe('Custom');
            expect(manager.getProviderDisplayName('llamacpp')).toBe('llamacpp');
            expect(manager.getProviderDisplayName('unknown-id')).toBe('unknown-id');
        });
    });

    // ---------------------------------------------------------- _getPersistedModel / _getDefaultModel
    describe('model resolution branches', () => {
        it('should use persisted model from aiSettings when available (L143)', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockReturnValue('custom-model');
            manager.setCore(mockCore);

            await manager.startProvider('gemini');

            expect(manager.model).toBe('custom-model');
        });

        it('should use catalog model from getMostPowerfulModel when available (L149)', async () => {
            const { getMostPowerfulModel } = await import('@/features/ai/utils/catalogHelpers');
            vi.mocked(getMostPowerfulModel).mockReturnValue('catalog-best-model');

            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockReturnValue(
                null as unknown as string,
            );
            manager.setCore(mockCore);

            await manager.startProvider('gemini');

            expect(manager.model).toBe('catalog-best-model');
            vi.mocked(getMostPowerfulModel).mockReturnValue(null as unknown as string);
        });

        it('should return null from _getPersistedModel when core is not set (L143 true branch)', async () => {
            // No setCore() called — _core is null → _getPersistedModel returns null
            // startProvider('local') resolves with fallback model from _getDefaultModel
            //  'local' provider: _resolveApiKey returns '' (no core), isLocal=true → proceeds
            const result = await manager.startProvider('local');
            expect(result).toBe(true);
            // Model comes from _getDefaultModel since _getPersistedModel returned null
            expect(manager.model).toBe('default');
        });

        it('should ignore empty persisted models and fall back to a non-empty default', async () => {
            const mockCore = createMockCore(() => Promise.resolve(''));
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockReturnValue('');
            manager.setCore(mockCore);

            const result = await manager.startProvider('llamacpp');

            expect(result).toBe(true);
            expect(manager.model).toBe('default');
        });

        it('should reflect model changes from settings without restarting the provider', async () => {
            let selectedModel = 'gemini-3.1-pro';
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockImplementation(
                () => selectedModel,
            );
            manager.setCore(mockCore);

            await manager.startProvider('gemini');
            expect(manager.model).toBe('gemini-3.1-pro');

            selectedModel = 'gemini-3-flash';
            expect(manager.model).toBe('gemini-3-flash');
        });
    });
});
