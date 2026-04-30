import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dompurify', () => ({
    default: {
        sanitize: vi.fn((value: string) => value),
    },
}));

import { aiSettingsRenderer } from './AISettingsRenderer';
import { CUSTOM_TEXT_PROVIDER_ID } from '@/shared/utils/customProviderSupport';

describe('AISettingsRenderer', () => {
    let customModelsState: Array<{
        id: string;
        name: string;
        provider_id: string;
        base_model_id: string;
    }>;

    const settingsService = {
        getSecureKeyMeta: vi.fn(),
        getSecureKey: vi.fn(),
        saveSecureKey: vi.fn(),
        removeSecureKey: vi.fn(),
        hasSecureKey: vi.fn(),
        validateApiKey: vi.fn(),
        validateStoredApiKey: vi.fn(),
        addCustomModel: vi.fn(),
        getCustomModels: vi.fn(),
        removeCustomModel: vi.fn(),
    };

    const aiSettings = {
        getSelectedAIModel: vi.fn(),
        setSelectedAIModel: vi.fn(),
        getThinkingLevel: vi.fn(),
        setThinkingLevel: vi.fn(),
        getInternetAccessEnabled: vi.fn(),
        setInternetAccessEnabled: vi.fn(),
    };

    const tauri = {
        invoke: vi.fn(),
        openUrl: vi.fn(),
    };

    const i18nUI = {
        applyTranslations: vi.fn(),
    };
    const tracer = {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    };
    const showToast = vi.fn();

    const translate = (key: string, fallback: string): string => `${key}:${fallback}`;
    const flushAsyncWork = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    };

    const models = [
        {
            id: 'reasoner',
            name: 'Reasoner',
            desc: 'Reasoning model',
            descKey: 'model.reasoner',
            pricing: { input_per_1m: 1, output_per_1m: 2, currency: 'USD' },
            contextWindow: 128000,
            capabilities: { reasoning: true },
            stats: { speed: 8, logic: 10, creative: 6 },
        },
        {
            id: 'fast',
            name: 'Fast',
            desc: 'Fast model',
            pricing: [{ tier: 'free', note: '0 / 0' }],
            contextWindow: 8000,
            capabilities: { reasoning: false },
        },
    ];

    beforeEach(async () => {
        document.body.innerHTML = `<div id="root"></div>`;
        customModelsState = [];
        settingsService.getSecureKeyMeta.mockResolvedValue({ exists: true, length: 16 });
        settingsService.getSecureKey.mockResolvedValue('stored-secret');
        settingsService.saveSecureKey.mockResolvedValue(undefined);
        settingsService.removeSecureKey.mockResolvedValue(undefined);
        settingsService.hasSecureKey.mockResolvedValue(true);
        settingsService.validateApiKey.mockResolvedValue(true);
        settingsService.validateStoredApiKey.mockResolvedValue(true);
        settingsService.getCustomModels.mockImplementation(() =>
            Promise.resolve([...customModelsState]),
        );
        settingsService.addCustomModel.mockImplementation(
            (providerId: string, id: string, name: string) => {
                customModelsState = customModelsState.filter(
                    (model) => !(model.provider_id === providerId && model.id === id),
                );
                customModelsState.push({
                    id,
                    name,
                    provider_id: providerId,
                    base_model_id: id,
                });
                return Promise.resolve();
            },
        );
        settingsService.removeCustomModel.mockImplementation((id: string) => {
            customModelsState = customModelsState.filter((model) => model.id !== id);
            return Promise.resolve();
        });
        aiSettings.getSelectedAIModel.mockReturnValue('reasoner');
        aiSettings.getThinkingLevel.mockReturnValue('medium');
        aiSettings.getInternetAccessEnabled.mockReturnValue(true);
        tauri.invoke.mockResolvedValue(true);
        tauri.openUrl.mockResolvedValue(undefined);

        aiSettingsRenderer.destroy();
        await aiSettingsRenderer.init(
            settingsService as never,
            aiSettings as never,
            tauri as never,
            i18nUI as never,
            translate,
            tracer,
            showToast,
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        aiSettingsRenderer.destroy();
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('renders clean apps without extra settings', async () => {
        const container = document.getElementById('root') as HTMLElement;

        await aiSettingsRenderer.render(container, {
            id: 'axelate',
            name: 'Axelate',
        } as never);

        expect(container.textContent).toContain('Axelate Settings');
        expect(container.textContent).toContain('No additional settings required for this module.');
    });

    it('renders provider settings without hydrating the secure key and handles interactions', async () => {
        const container = document.getElementById('root') as HTMLElement;

        await aiSettingsRenderer.render(container, {
            id: 'gpt',
            name: 'GPT',
            apiProviderData: { models },
        } as never);

        const input = container.querySelector('#gpt-api-key-input') as HTMLInputElement;
        const link = container.querySelector('#gpt-api-link') as HTMLElement;
        const modelCard = container.querySelector(
            '.ai-model-card[data-model-key="fast"]',
        ) as HTMLElement;
        const thinkingCard = container.querySelector(
            '.thinking-option-card[data-value="high"]',
        ) as HTMLElement;
        const internetCard = container.querySelector(
            '.internet-access-card[data-value="off"]',
        ) as HTMLElement;

        expect(input.value).toBe('••••••••••••••••');
        expect(input.dataset['storedMasked']).toBe('true');
        expect(container.querySelectorAll('.ai-model-card')).toHaveLength(2);
        expect(container.textContent).toContain('Ctx: 128K');

        input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        input.value = 'new-secret';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(settingsService.saveSecureKey).not.toHaveBeenCalled();

        link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(tauri.openUrl).toHaveBeenCalledWith('https://openrouter.ai/settings/keys');

        modelCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(aiSettings.setSelectedAIModel).toHaveBeenCalledWith('gpt', 'fast');

        thinkingCard.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
        expect(aiSettings.setThinkingLevel).toHaveBeenCalledWith('gpt', 'high');

        internetCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(aiSettings.setInternetAccessEnabled).toHaveBeenCalledWith('gpt', false);
        expect(i18nUI.applyTranslations).toHaveBeenCalled();
    });

    it('reveals stored key on demand and updates selected model stats', async () => {
        const container = document.getElementById('root') as HTMLElement;
        await aiSettingsRenderer.render(container, {
            id: 'gpt',
            name: 'GPT',
            apiProviderData: { models },
        } as never);

        const input = document.getElementById('gpt-api-key-input') as HTMLInputElement;
        expect(input.type).toBe('text');
        expect(input.dataset['storedMasked']).toBe('true');
        await aiSettingsRenderer.toggleKeyVisibility('gpt');
        expect(settingsService.getSecureKey).toHaveBeenCalledWith('openrouter');
        expect(input.value).toBe('stored-secret');
        expect(input.dataset['storedMasked']).toBe('true');
        expect(input.dataset['storedRevealed']).toBe('true');

        aiSettingsRenderer.selectModel('gpt', 'fast');
        expect(
            document
                .querySelector('.ai-model-card[data-model-key="fast"]')
                ?.classList.contains('selected'),
        ).toBe(true);
        expect(
            document.getElementById('gpt-thinking-section')?.classList.contains('is-hidden'),
        ).toBe(true);
        expect(document.getElementById('gpt-model-stats')?.textContent).toContain(
            'Stats unavailable',
        );
        expect(document.getElementById('gpt-model-stats')?.textContent).toContain('Model Stats');
    });

    it('shows an error toast when stored key reveal fails', async () => {
        const container = document.getElementById('root') as HTMLElement;
        settingsService.getSecureKey.mockResolvedValueOnce(null);

        await aiSettingsRenderer.render(container, {
            id: 'gpt',
            name: 'GPT',
            apiProviderData: { models },
        } as never);

        await aiSettingsRenderer.toggleKeyVisibility('gpt');

        expect(showToast).toHaveBeenCalledWith(
            'ui.settings.key_reveal_error:Failed to reveal stored key',
            'error',
        );
    });

    it('checks API keys across invalid, success and failure states', async () => {
        vi.useFakeTimers();
        const container = document.getElementById('root') as HTMLElement;
        await aiSettingsRenderer.render(container, {
            id: 'gpt',
            name: 'GPT',
            apiProviderData: { models },
        } as never);

        const input = document.getElementById('gpt-api-key-input') as HTMLInputElement;
        const button = document.getElementById('gpt-key-check-btn') as HTMLButtonElement;
        input.value = '••••••••••••••••';
        await aiSettingsRenderer.checkKey('gpt');
        expect(showToast).toHaveBeenCalledWith('ui.settings.key_valid:Key is valid', 'success');
        vi.advanceTimersByTime(3000);

        input.value = 'valid-key';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        settingsService.validateApiKey.mockResolvedValueOnce(true);
        await aiSettingsRenderer.checkKey('gpt');
        expect(button.classList.contains('success')).toBe(true);
        expect(showToast).toHaveBeenCalledWith('ui.settings.key_valid:Key is valid', 'success');
        expect(settingsService.saveSecureKey).toHaveBeenCalledWith('openrouter', 'valid-key');
        expect(input.value).toBe('•••••••••');
        expect(input.dataset['storedMasked']).toBe('true');

        vi.advanceTimersByTime(3000);
        expect(button.disabled).toBe(false);

        button.classList.add('success');
        button.innerHTML = '<check>';
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
        expect(settingsService.removeSecureKey).toHaveBeenCalledWith('openrouter');
        expect(showToast).toHaveBeenCalledWith(
            'ui.settings.key_removed:API key removed',
            'success',
        );
        expect(input.value).toBe('');
        expect(input.dataset['storedMasked']).toBeUndefined();
        expect(button.classList.contains('success')).toBe(false);
        expect(button.textContent).toBe('ui.gpt.key_check_btn:Check');

        input.value = 'bad-key';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        settingsService.validateApiKey.mockRejectedValueOnce(new Error('boom'));
        await aiSettingsRenderer.checkKey('gpt');
        expect(showToast).toHaveBeenCalledWith(
            'ui.settings.key_invalid_check:Key is invalid or missing',
            'error',
        );

        vi.advanceTimersByTime(3000);
        input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        input.value = 'https://reddit.com/r/not-a-key';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        settingsService.validateStoredApiKey.mockClear();
        settingsService.validateApiKey.mockResolvedValueOnce(false);

        await aiSettingsRenderer.checkKey('gpt');

        expect(settingsService.validateStoredApiKey).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
            'ui.settings.key_invalid_check:Key is invalid or missing',
            'error',
        );
    });

    it('does not reset a success check state when secure key removal fails', async () => {
        const container = document.getElementById('root') as HTMLElement;
        await aiSettingsRenderer.render(container, {
            id: 'gpt',
            name: 'GPT',
            apiProviderData: { models },
        } as never);

        const input = document.getElementById('gpt-api-key-input') as HTMLInputElement;
        const button = document.getElementById('gpt-key-check-btn') as HTMLButtonElement;
        button.classList.add('success');
        button.innerHTML = '<check>';
        settingsService.removeSecureKey.mockRejectedValueOnce(new Error('secure storage failed'));

        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(button.classList.contains('success')).toBe(true);
        expect(button.innerHTML).toContain('check');
        expect(showToast).toHaveBeenCalledWith(
            'ui.settings.key_remove_error:Key remove error',
            'error',
        );
    });

    it('hides model stats for custom providers', async () => {
        const container = document.getElementById('root') as HTMLElement;

        await aiSettingsRenderer.render(container, {
            id: CUSTOM_TEXT_PROVIDER_ID,
            name: 'Custom',
            apiProviderData: { models },
        } as never);

        expect(container.querySelector(`#${CUSTOM_TEXT_PROVIDER_ID}-model-stats`)).toBeNull();
    });

    it('shows the thinking section on first render for custom text providers', async () => {
        const container = document.getElementById('root') as HTMLElement;
        customModelsState = [
            {
                id: 'google/gemma-4-31b-it:free',
                name: 'Gemma 4 31b It:free',
                provider_id: CUSTOM_TEXT_PROVIDER_ID,
                base_model_id: 'google/gemma-4-31b-it:free',
            },
        ];
        aiSettings.getSelectedAIModel.mockReturnValue('google/gemma-4-31b-it:free');

        await aiSettingsRenderer.render(container, {
            id: CUSTOM_TEXT_PROVIDER_ID,
            name: 'Custom',
            apiProviderData: { models: [] },
        } as never);

        expect(
            container
                .querySelector(`#${CUSTOM_TEXT_PROVIDER_ID}-thinking-section`)
                ?.classList.contains('is-hidden'),
        ).toBe(false);
    });

    it('adds a custom model from the composer card and derives the title from model id', async () => {
        const container = document.getElementById('root') as HTMLElement;

        await aiSettingsRenderer.render(container, {
            id: CUSTOM_TEXT_PROVIDER_ID,
            name: 'Custom',
            apiProviderData: { models: [] },
        } as never);

        const input = container.querySelector(
            `#${CUSTOM_TEXT_PROVIDER_ID}-custom-model-id-input`,
        ) as HTMLInputElement;
        const button = container.querySelector(
            `#${CUSTOM_TEXT_PROVIDER_ID}-custom-model-save-btn`,
        ) as HTMLButtonElement;

        input.value = 'openai/gpt-5.4-nano';
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushAsyncWork();

        expect(settingsService.addCustomModel).toHaveBeenCalledWith(
            CUSTOM_TEXT_PROVIDER_ID,
            'openai/gpt-5.4-nano',
            'GPT-5.4 Nano',
        );
        expect(container.textContent).toContain('GPT-5.4 Nano');
    });

    it('shows remove control for custom models and removes on click', async () => {
        const container = document.getElementById('root') as HTMLElement;
        customModelsState = [
            {
                id: 'openai/gpt-5.4-nano',
                name: 'GPT-5.4 Nano',
                provider_id: CUSTOM_TEXT_PROVIDER_ID,
                base_model_id: 'openai/gpt-5.4-nano',
            },
        ];
        aiSettings.getSelectedAIModel.mockReturnValue('openai/gpt-5.4-nano');

        await aiSettingsRenderer.render(container, {
            id: CUSTOM_TEXT_PROVIDER_ID,
            name: 'Custom',
            apiProviderData: { models: [] },
        } as never);

        const removeButton = container.querySelector(
            '.ai-model-card-remove[data-model-remove="openai/gpt-5.4-nano"]',
        ) as HTMLButtonElement;
        removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushAsyncWork();

        expect(settingsService.removeCustomModel).toHaveBeenCalledWith('openai/gpt-5.4-nano');
        expect(
            container.querySelector('.ai-model-card[data-model-key="openai/gpt-5.4-nano"]'),
        ).toBeNull();
    });
});
