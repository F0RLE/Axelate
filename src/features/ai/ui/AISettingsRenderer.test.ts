import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dompurify', () => ({
    default: {
        sanitize: vi.fn((value: string) => value),
    },
}));

vi.mock('@/shared/utils/globalAccessor', () => ({
    getGlobalWin: () => globalThis,
}));

import { aiSettingsRenderer } from './AISettingsRenderer';

describe('AISettingsRenderer', () => {
    const settingsService = {
        getSecureKeyMeta: vi.fn(),
        saveSecureKey: vi.fn(),
        hasSecureKey: vi.fn(),
        validateApiKey: vi.fn(),
        validateStoredApiKey: vi.fn(),
    };

    const aiSettings = {
        getSelectedAIModel: vi.fn(),
        setSelectedAIModel: vi.fn(),
        getThinkingLevel: vi.fn(),
        setThinkingLevel: vi.fn(),
    };

    const tauri = {
        invoke: vi.fn(),
        openUrl: vi.fn(),
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
        settingsService.getSecureKeyMeta.mockResolvedValue({ exists: true, length: 16 });
        settingsService.saveSecureKey.mockResolvedValue(undefined);
        settingsService.hasSecureKey.mockResolvedValue(true);
        settingsService.validateApiKey.mockResolvedValue(true);
        settingsService.validateStoredApiKey.mockResolvedValue(true);
        aiSettings.getSelectedAIModel.mockReturnValue('reasoner');
        aiSettings.getThinkingLevel.mockReturnValue('medium');
        tauri.invoke.mockResolvedValue(true);
        tauri.openUrl.mockResolvedValue(undefined);

        (globalThis as unknown as { t?: (key: string, fallback: string) => string }).t = (
            key,
            fallback,
        ) => `${key}:${fallback}`;
        (globalThis as unknown as { showToast?: ReturnType<typeof vi.fn> }).showToast = vi.fn();
        (
            globalThis as unknown as { applyTranslations?: ReturnType<typeof vi.fn> }
        ).applyTranslations = vi.fn();

        aiSettingsRenderer.destroy();
        await aiSettingsRenderer.init(
            settingsService as never,
            aiSettings as never,
            tauri as never,
        );
    });

    afterEach(() => {
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
        expect(
            (globalThis as unknown as { applyTranslations: ReturnType<typeof vi.fn> })
                .applyTranslations,
        ).toHaveBeenCalled();
    });

    it('keeps stored key hidden and updates selected model stats', async () => {
        const container = document.getElementById('root') as HTMLElement;
        await aiSettingsRenderer.render(container, {
            id: 'gpt',
            name: 'GPT',
            apiProviderData: { models },
        } as never);

        const input = document.getElementById('gpt-api-key-input') as HTMLInputElement;
        expect(input.type).toBe('text');
        expect(input.dataset['storedMasked']).toBe('true');
        aiSettingsRenderer.toggleKeyVisibility('gpt');
        expect(input.value).toBe('••••••••••••••••');
        expect(input.dataset['storedMasked']).toBe('true');
        expect(input.dataset['storedRevealed']).toBeUndefined();
        expect(
            (globalThis as unknown as { showToast: ReturnType<typeof vi.fn> }).showToast,
        ).toHaveBeenCalledWith(
            'ui.settings.stored_key_hidden:Stored key stays hidden. Type a new key to replace it.',
            'info',
        );

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
        const showToast = (globalThis as unknown as { showToast: ReturnType<typeof vi.fn> })
            .showToast;

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
});
