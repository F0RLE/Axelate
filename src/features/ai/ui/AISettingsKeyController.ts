import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { SettingsService } from '@/features/settings/services/SettingsService';

type TranslateFunc = (key: string, fallback: string) => string;
type KeyInput = HTMLInputElement | HTMLTextAreaElement;
type KeyButton = HTMLButtonElement;
type KeyControllerLogger = Pick<LoggerService, 'error'>;

type KeyControllerOptions = {
    getSettingsService: () => SettingsService | null;
    getTranslator: () => TranslateFunc;
    scheduleButtonReset: (button: KeyButton, callback: () => void) => void;
    showToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
    icons: {
        visible: string;
        hidden: string;
        check: string;
        x: string;
        spinner: string;
    };
    tracer: KeyControllerLogger;
};

export class AISettingsKeyController {
    public constructor(private readonly _options: KeyControllerOptions) {}

    public async hydrateStoredMask(input: KeyInput, providerId: string): Promise<void> {
        const meta = await this._options.getSettingsService()?.getSecureKeyMeta(providerId);
        if (meta?.exists === true) {
            this.applyStoredKeyMask(input, meta.length);
        }
    }

    public normalizeInput(event: Event): void {
        const target = event.target as KeyInput;
        const normalizedValue = target.value.replaceAll(/[\r\n]+/g, '');
        if (normalizedValue !== target.value) {
            target.value = normalizedValue;
        }
        delete target.dataset['storedMasked'];
        delete target.dataset['storedRevealed'];
        target.dataset['keyDirty'] = 'true';
    }

    public async removeClearedStoredKey(input: KeyInput, providerId: string): Promise<boolean> {
        if (input.value.trim() !== '') {
            return false;
        }

        if (input.dataset['keyRemoveInFlight'] === 'true') {
            return false;
        }

        input.dataset['keyRemoveInFlight'] = 'true';
        try {
            await this._options.getSettingsService()?.removeSecureKey(providerId);
            this.clearStoredKeyMask(input);
            this._showToast(
                this._options.getTranslator()('ui.settings.key_removed', 'API key removed'),
                'success',
            );
            return true;
        } catch (error: unknown) {
            this._options.tracer.error('[AISettingsKeyController] Key removal failed:', error);
            this._showToast(
                this._options.getTranslator()('ui.settings.key_remove_error', 'Key remove error'),
                'error',
            );
            return false;
        } finally {
            delete input.dataset['keyRemoveInFlight'];
        }
    }

    public resetButtonState(button: KeyButton, label: string): void {
        button.disabled = false;
        button.style.width = '';
        button.classList.remove('success', 'error', 'checking');
        button.textContent = label;
    }

    public maybeClearStoredMask(event: Event): void {
        const target = event.target as KeyInput;
        const inputType = (event as InputEvent).inputType;

        if (target.dataset['storedMasked'] === 'true' && !inputType.startsWith('delete')) {
            this.clearStoredKeyMask(target);
        }
    }

    public async toggleVisibility(
        input: KeyInput | null,
        button: KeyButton | null,
        providerId: string,
    ): Promise<void> {
        if (input === null || button === null) {
            return;
        }

        if (
            input.dataset['storedMasked'] === 'true' &&
            input.dataset['storedRevealed'] !== 'true'
        ) {
            const settingsService = this._options.getSettingsService();
            const revealedKey = await settingsService?.getSecureKey(providerId);
            if (revealedKey === undefined || revealedKey === null || revealedKey === '') {
                this._showToast(
                    this._options.getTranslator()(
                        'ui.settings.key_reveal_error',
                        'Failed to reveal stored key',
                    ),
                    'error',
                );
                return;
            }

            input.value = revealedKey;
            input.dataset['storedRevealed'] = 'true';
            input.classList.remove('is-masked');
            button.innerHTML = this._options.icons.visible;
            return;
        }

        const isMasked = input.classList.contains('is-masked');
        input.classList.toggle('is-masked', !isMasked);
        button.innerHTML = isMasked ? this._options.icons.visible : this._options.icons.hidden;
    }

    public async checkKey(
        input: KeyInput | null,
        button: KeyButton | null,
        providerId: string,
    ): Promise<void> {
        if (input === null || button === null) {
            return;
        }

        if (button.disabled || button.classList.contains('checking')) {
            return;
        }

        const t = this._options.getTranslator();
        const originalHtml = button.innerHTML;
        const originalWidth = button.offsetWidth;
        button.style.width = `${String(originalWidth)}px`;
        button.innerHTML = this._options.icons.spinner;
        button.classList.add('checking');
        button.disabled = true;

        try {
            const isStoredMask = input.dataset['storedMasked'] === 'true';
            const isDirtyReplacement = input.dataset['keyDirty'] === 'true';
            const key = input.value.trim();
            const shouldRemoveStoredKey = isDirtyReplacement && key === '';
            const shouldValidateTypedKey =
                (isDirtyReplacement && key !== '') || (!isStoredMask && key !== '');
            const shouldValidateStoredKey = !isDirtyReplacement && isStoredMask && key !== '';

            let isValid = false;
            if (shouldRemoveStoredKey) {
                await this._options.getSettingsService()?.removeSecureKey(providerId);
                this.clearStoredKeyMask(input);
                this.updateButtonState(button, 'success', this._options.icons.check);
                this._showToast(t('ui.settings.key_removed', 'API key removed'), 'success');
                return;
            } else if (shouldValidateTypedKey) {
                isValid = await this._validateKey(providerId, key);
            } else if (shouldValidateStoredKey) {
                isValid = Boolean(
                    await this._options.getSettingsService()?.validateStoredApiKey(providerId),
                );
            }

            if (isValid) {
                if (shouldValidateTypedKey && key !== '') {
                    await this._options.getSettingsService()?.saveSecureKey(providerId, key);
                    this.applyStoredKeyMask(input, key.length);
                }
                this.updateButtonState(button, 'success', this._options.icons.check);
                this._showToast(t('ui.settings.key_valid', 'Key is valid'), 'success');
            } else {
                this.updateButtonState(button, 'error', this._options.icons.x);
                this._showToast(
                    t('ui.settings.key_invalid_check', 'Key is invalid or missing'),
                    'error',
                );
            }
        } catch (error: unknown) {
            this._options.tracer.error('[AISettingsKeyController] Key check failed:', error);
            this.updateButtonState(button, 'error', this._options.icons.x);
            this._showToast(t('ui.settings.key_check_error', 'Key check error'), 'error');
        } finally {
            this._options.scheduleButtonReset(button, () => {
                if (!document.body.contains(button)) {
                    return;
                }

                button.disabled = false;
                button.style.width = '';
                button.classList.remove('success', 'error', 'checking');
                button.innerHTML = originalHtml;
            });
        }
    }

    public applyStoredKeyMask(input: KeyInput, length?: number): void {
        input.dataset['storedMasked'] = 'true';
        delete input.dataset['storedRevealed'];
        delete input.dataset['keyDirty'];
        input.classList.remove('is-masked');
        input.value = this._buildStoredKeyMask(length);
        input.placeholder = this._options.getTranslator()(
            'ui.settings.stored_key_placeholder',
            'Stored locally. Type to replace.',
        );
    }

    public clearStoredKeyMask(input: KeyInput): void {
        delete input.dataset['storedMasked'];
        delete input.dataset['storedRevealed'];
        delete input.dataset['keyDirty'];
        input.value = '';
        input.classList.add('is-masked');
        input.placeholder = this._options.getTranslator()(
            'ui.settings.enter_key_placeholder',
            'Enter your API key here',
        );
    }

    public updateButtonState(button: HTMLElement, state: 'success' | 'error', icon: string): void {
        button.classList.remove('success', 'error', 'checking');
        button.classList.add(state);
        button.innerHTML = icon;
    }

    private _buildStoredKeyMask(length?: number): string {
        const count = typeof length === 'number' && length > 0 ? length : 16;
        return '•'.repeat(count);
    }

    private async _validateKey(providerId: string, key: string): Promise<boolean> {
        const settingsService = this._options.getSettingsService();
        if (!settingsService) {
            return false;
        }

        try {
            return await settingsService.validateApiKey(providerId, key);
        } catch (error) {
            this._options.tracer.error('[AISettingsKeyController] Key validation failed:', error);
            return false;
        }
    }

    private _showToast(message: string, type: string): void {
        this._options.showToast(message, type as 'success' | 'error' | 'warning' | 'info');
    }
}
