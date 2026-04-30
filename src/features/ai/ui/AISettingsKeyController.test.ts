import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AISettingsKeyController } from './AISettingsKeyController';

describe('AISettingsKeyController', () => {
    const tracer = {
        error: vi.fn(),
    };
    const settingsService = {
        getSecureKeyMeta: vi.fn(),
        getSecureKey: vi.fn(),
        saveSecureKey: vi.fn(),
        removeSecureKey: vi.fn(),
        validateApiKey: vi.fn(),
        validateStoredApiKey: vi.fn(),
    };

    const getTranslator = () => (key: string, fallback: string) => `${key}:${fallback}`;
    const scheduleButtonReset = vi.fn((_button: HTMLButtonElement, callback: () => void) =>
        callback(),
    );

    const controller = new AISettingsKeyController({
        getSettingsService: () => settingsService as never,
        getTranslator,
        scheduleButtonReset,
        showToast: vi.fn(),
        icons: {
            visible: '<visible>',
            hidden: '<hidden>',
            check: '<check>',
            x: '<x>',
            spinner: '<spinner>',
        },
        tracer,
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('should hydrate and reveal stored keys', async () => {
        const input = document.createElement('input');
        const button = document.createElement('button');
        document.body.append(input, button);

        settingsService.getSecureKeyMeta.mockResolvedValue({ exists: true, length: 8 });
        settingsService.getSecureKey.mockResolvedValue('secret-1');

        await controller.hydrateStoredMask(input, 'openrouter');
        expect(input.value).toBe('••••••••');
        expect(input.dataset['storedMasked']).toBe('true');

        await controller.toggleVisibility(input, button, 'openrouter');
        expect(input.value).toBe('secret-1');
        expect(input.dataset['storedRevealed']).toBe('true');
        expect(button.innerHTML).toContain('<visible>');
    });

    it('should validate typed keys, save them and reset button state', async () => {
        const input = document.createElement('input');
        const button = document.createElement('button');
        button.innerHTML = 'Check';
        document.body.append(input, button);

        input.value = 'typed-key';
        input.dataset['keyDirty'] = 'true';
        settingsService.validateApiKey.mockResolvedValue(true);
        settingsService.saveSecureKey.mockResolvedValue(undefined);

        await controller.checkKey(input, button, 'openrouter');

        expect(settingsService.validateApiKey).toHaveBeenCalledWith('openrouter', 'typed-key');
        expect(settingsService.saveSecureKey).toHaveBeenCalledWith('openrouter', 'typed-key');
        expect(input.dataset['storedMasked']).toBe('true');
        expect(button.disabled).toBe(false);
        expect(button.innerHTML).toBe('Check');
    });

    it('should remove stored keys when a dirty key input is cleared', async () => {
        const input = document.createElement('input');
        const button = document.createElement('button');
        button.innerHTML = 'Check';
        document.body.append(input, button);

        input.dataset['keyDirty'] = 'true';
        input.value = '';
        settingsService.removeSecureKey.mockResolvedValue(undefined);

        await controller.checkKey(input, button, 'openrouter');

        expect(settingsService.removeSecureKey).toHaveBeenCalledWith('openrouter');
        expect(settingsService.saveSecureKey).not.toHaveBeenCalled();
        expect(input.dataset['storedMasked']).toBeUndefined();
        expect(input.value).toBe('');
        expect(button.disabled).toBe(false);
    });
});
