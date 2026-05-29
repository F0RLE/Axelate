/**
 * AIProviderManager Unit Tests — Full Coverage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProviderManager } from '@/features/ai/services/AIProviderManager';
import { getMostPowerfulModel, getModelData } from '@/features/ai/utils/catalogHelpers';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { CUSTOM_TEXT_PROVIDER_ID } from '@/shared/utils/customProviderSupport';
import type { AIProviderManagerContext } from './AIBridgeContext';

const cloudProviderPolicy = {
    isCloudProvider: true,
    isCustomProvider: false,
    isCleanApp: false,
    secretService: 'cloud_api_key',
    keyProviderId: 'cloud',
    keyProviderUrl: 'https://openrouter.ai/settings/keys',
    usesCustomProviderKey: false,
    showApiEndpointSelector: false,
    showCustomModelComposer: false,
    showModelStats: true,
    supportsInternetAccess: true,
    supportsThinking: true,
    imageOnly: false,
};

const customTextProviderPolicy = {
    ...cloudProviderPolicy,
    isCustomProvider: true,
    secretService: 'custom_text_api_key',
    keyProviderId: CUSTOM_TEXT_PROVIDER_ID,
    keyProviderUrl: null,
    usesCustomProviderKey: true,
    showApiEndpointSelector: true,
    showCustomModelComposer: true,
    showModelStats: false,
    supportsInternetAccess: false,
    supportsThinking: false,
};

const localProviderPolicy = {
    ...cloudProviderPolicy,
    isCloudProvider: false,
    secretService: null,
    keyProviderId: null,
    keyProviderUrl: null,
    supportsInternetAccess: false,
    supportsThinking: false,
};

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
): AIProviderManagerContext {
    const context: AIProviderManagerContext = {
        tauriProvider: {
            isTauri: vi.fn().mockReturnValue(true),
            invoke: vi.fn(),
            listen: vi.fn(),
            getSecureKey: vi.fn(getKeyFn),
            saveSecureKey: vi.fn().mockResolvedValue(undefined),
            hasSecureKey: vi.fn(hasKeyFn),
        },
        catalog: {
            getCatalog: vi.fn().mockReturnValue({
                ai: [
                    { id: 'gpt', capability: 'text', providerPolicy: cloudProviderPolicy },
                    { id: 'gemini', capability: 'text', providerPolicy: cloudProviderPolicy },
                    { id: 'local', capability: 'text', providerPolicy: localProviderPolicy },
                    { id: 'llamacpp', capability: 'text', providerPolicy: localProviderPolicy },
                    {
                        id: CUSTOM_TEXT_PROVIDER_ID,
                        capability: 'text',
                        providerPolicy: customTextProviderPolicy,
                    },
                ],
            }),
        },
        aiSettings: {
            setSelectedAIModel: vi.fn(),
            getSelectedAIModel: vi.fn().mockReturnValue(undefined),
            getApiBaseUrl: vi.fn(
                (_appId: string, fallback?: string) => fallback ?? 'https://openrouter.ai/api/v1',
            ),
            setApiBaseUrl: vi.fn().mockReturnValue(true),
            getThinkingLevel: vi.fn().mockReturnValue('auto'),
            getInternetAccessEnabled: vi.fn().mockReturnValue(false),
        },
    };
    return context;
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
            manager.setContext(mockCore);

            await manager.init();

            expect(mockCore.tauriProvider.saveSecureKey).toHaveBeenCalledWith(
                'ai_session_id',
                expect.any(String),
            );
            expect(manager.sessionId).not.toBe('default');
        });

        it('should restore existing session ID without saving', async () => {
            const mockCore = createMockCore(() => Promise.resolve('existing-session-abc'));
            manager.setContext(mockCore);

            await manager.init();

            expect(mockCore.tauriProvider.saveSecureKey).not.toHaveBeenCalled();
            expect(manager.sessionId).toBe('existing-session-abc');
        });

        it('should generate session ID when secure storage is empty', async () => {
            const mockCore = createMockCore(() => Promise.resolve(null));
            manager.setContext(mockCore);

            await manager.init();

            expect(mockCore.tauriProvider.saveSecureKey).toHaveBeenCalledWith(
                'ai_session_id',
                manager.sessionId,
            );
            expect(manager.sessionId).not.toBe('default');
        });

        it('should generate session ID when secure read fails', async () => {
            const mockCore = createMockCore(() => Promise.reject(new Error('secure read failed')));
            manager.setContext(mockCore);

            await manager.init();

            expect(mockCore.tauriProvider.getSecureKey).toHaveBeenCalledTimes(1);
            expect(mockCore.tauriProvider.saveSecureKey).toHaveBeenCalledWith(
                'ai_session_id',
                manager.sessionId,
            );
            expect(manager.sessionId).not.toBe('default');
            expect(tracer.error).toHaveBeenCalledWith(
                '[AIProviderManager] Failed to read ai_session_id:',
                expect.any(Error),
            );
        });

        it('should continue with generated session ID when secure persistence fails', async () => {
            const mockCore = createMockCore(() => Promise.resolve(null));
            vi.mocked(mockCore.tauriProvider.saveSecureKey ?? vi.fn()).mockRejectedValueOnce(
                new Error('secure unavailable'),
            );
            manager.setContext(mockCore);

            await expect(manager.init()).resolves.toBeUndefined();

            expect(manager.sessionId).not.toBe('default');
            expect(tracer.error).toHaveBeenCalled();
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
            manager.setContext(mockCore);
            await manager.startProvider('gemini');

            const result = await manager.startProvider('gemini');
            expect(result).toBe(true);
            expect(mockCore.tauriProvider.hasSecureKey).toHaveBeenCalledTimes(2);
        });

        it('should deactivate a cloud provider when its key was removed before restart', async () => {
            let hasKey = true;
            const mockCore = createMockCore(
                () => Promise.resolve(hasKey ? 'sk-key' : null),
                () => Promise.resolve(hasKey),
            );
            manager.setContext(mockCore);
            await manager.startProvider('gemini');

            hasKey = false;
            const result = await manager.startProvider('gemini');

            expect(result).toBe(false);
            expect(manager.activeProviderId).toBeNull();
            expect(manager.apiKey).toBeNull();
            expect(manager.isActive()).toBe(false);
        });

        it('should stop previous provider when switching', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            manager.setContext(mockCore);

            await manager.startProvider('gemini');
            await manager.startProvider('gpt');

            expect(manager.activeProviderId).toBe('gpt');
        });

        it('should return false if API key is empty for non-local provider', async () => {
            const mockCore = createMockCore(() => Promise.resolve(''));
            manager.setContext(mockCore);

            const result = await manager.startProvider('gemini');
            expect(result).toBe(false);
            expect(manager.isActive()).toBe(false);
            expect(mockCore.tauriProvider.hasSecureKey).toHaveBeenCalledWith('cloud_api_key');
        });

        it('should succeed for local provider without a key', async () => {
            const mockCore = createMockCore(() => Promise.resolve(''));
            manager.setContext(mockCore);

            const result = await manager.startProvider('local');
            expect(result).toBe(true);
        });

        it('should return false and log on exception (lines 71-72)', async () => {
            const mockCore = createMockCore(() =>
                Promise.reject(new Error('Secure storage crash')),
            );
            manager.setContext(mockCore);

            const result = await manager.startProvider('gemini');
            expect(result).toBe(false);
        });

        it('should persist the resolved model via aiSettings', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-test'));
            manager.setContext(mockCore);

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
            manager.setContext(mockCore);
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
            manager.setContext(mockCore);
            await manager.startProvider('llamacpp');

            expect(manager.isActive()).toBe(true);
        });

        it('should treat custom providers as cloud providers requiring their own key', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            manager.setContext(mockCore);

            const result = await manager.startProvider(CUSTOM_TEXT_PROVIDER_ID);

            expect(result).toBe(true);
            expect(manager.isActive()).toBe(true);
            expect(mockCore.tauriProvider.hasSecureKey).toHaveBeenCalledWith('custom_text_api_key');
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
            manager.setContext(mockCore);
            await manager.startProvider('gemini');

            hasKey = false;
            await manager.refreshActiveApiKey();

            expect(manager.apiKey).toBeNull();
            expect(manager.activeProviderId).toBeNull();
            expect(mockCore.tauriProvider.hasSecureKey).toHaveBeenLastCalledWith('cloud_api_key');
        });

        it('should do nothing if no active provider', async () => {
            await manager.refreshActiveApiKey();
        });
    });

    // ---------------------------------------------------------- _saveSecureVal (lines 163-168)
    describe('_saveSecureVal (via init)', () => {
        it('should save session ID when core is present and no session exists', async () => {
            const mockCore = createMockCore(() => Promise.resolve(null));
            manager.setContext(mockCore);

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

        it('getProviderDisplayName should prefer catalog names', () => {
            const mockCore = createMockCore();
            vi.mocked(mockCore.catalog.getCatalog).mockReturnValue({
                ai: [
                    {
                        id: 'gpt',
                        name: 'OpenAI GPT',
                        apiProviderData: {
                            id: 'gpt',
                            name: 'OpenAI GPT',
                            type: 'api',
                            baseUrl: ' https://api.openai.com/v1 ',
                            models: [],
                        },
                    },
                    { id: 'gemini', name: 'Google Gemini' },
                ],
            });
            manager.setContext(mockCore);

            expect(manager.getProviderDisplayName('gpt')).toBe('OpenAI GPT');
            expect(manager.getProviderDisplayName('gemini')).toBe('Google Gemini');
            expect(manager.getProviderDisplayName(CUSTOM_TEXT_PROVIDER_ID)).toBe('Custom');
            expect(manager.getProviderDisplayName('llamacpp')).toBe('llamacpp');
            expect(manager.getProviderDisplayName('unknown-id')).toBe('unknown-id');
            expect(manager.getProviderBaseUrl('gpt')).toBe('https://api.openai.com/v1');
            expect(manager.getProviderBaseUrl('gemini')).toBeUndefined();
        });

        it('uses saved API base URLs only for custom text providers', () => {
            const mockCore = createMockCore();
            vi.mocked(mockCore.aiSettings.getApiBaseUrl).mockReturnValue(
                'https://api.groq.com/openai/v1',
            );
            vi.mocked(mockCore.catalog.getCatalog).mockReturnValue({
                ai: [
                    {
                        id: 'gpt',
                        apiProviderData: {
                            id: 'gpt',
                            name: 'GPT',
                            type: 'api',
                            baseUrl: 'https://openrouter.ai/api/v1',
                            models: [],
                        },
                    },
                ],
            });
            manager.setContext(mockCore);

            expect(manager.getProviderBaseUrl('gpt')).toBe('https://openrouter.ai/api/v1');
            expect(manager.getProviderBaseUrl(CUSTOM_TEXT_PROVIDER_ID)).toBe(
                'https://api.groq.com/openai/v1',
            );
        });
    });

    // ---------------------------------------------------------- _getPersistedModel / _getDefaultModel
    describe('model resolution branches', () => {
        it('should use persisted model from aiSettings when available (L143)', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockReturnValue('custom-model');
            manager.setContext(mockCore);

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
            manager.setContext(mockCore);

            await manager.startProvider('gemini');

            expect(manager.model).toBe('catalog-best-model');
        });

        it('should fail closed when core is not set', async () => {
            const result = await manager.startProvider('local');
            expect(result).toBe(false);
            expect(manager.model).toBe('');
        });

        it('should ignore empty persisted local models and fall back to a non-empty default', async () => {
            const mockCore = createMockCore(() => Promise.resolve(''));
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockReturnValue('');
            manager.setContext(mockCore);

            const result = await manager.startProvider('llamacpp');

            expect(result).toBe(true);
            expect(manager.model).toBe('default');
        });

        it('should deny providers without backend policy', async () => {
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            vi.mocked(mockCore.catalog.getCatalog).mockReturnValue({ ai: [] });
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockReturnValue('');
            manager.setContext(mockCore);

            const result = await manager.startProvider('gemini');

            expect(result).toBe(false);
            expect(manager.model).toBe('');
            expect(mockCore.aiSettings.setSelectedAIModel).not.toHaveBeenCalled();
        });

        it('should reflect model changes from settings without restarting the provider', async () => {
            let selectedModel = 'gemini-3.1-pro';
            const mockCore = createMockCore(() => Promise.resolve('sk-key'));
            vi.mocked(mockCore.aiSettings.getSelectedAIModel).mockImplementation(
                () => selectedModel,
            );
            manager.setContext(mockCore);

            await manager.startProvider('gemini');
            expect(manager.model).toBe('gemini-3.1-pro');

            selectedModel = 'gemini-3-flash';
            expect(manager.model).toBe('gemini-3-flash');
        });
    });
});
