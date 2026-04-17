import { tracer } from '@/infrastructure/logging/LoggerService';

type TranslateFn = (key: string, defaultValue?: string) => string;
type SaveSettingFn = (key: string, value: string) => Promise<void>;

export class ModuleSettingsAutosaveController {
    private readonly _saveTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    private _saveSessionVersion = 0;

    constructor(
        private readonly _translate: TranslateFn,
        private readonly _saveSetting: SaveSettingFn,
    ) {}

    public reset(): void {
        this._saveSessionVersion += 1;
        this._saveTimeouts.forEach((timeoutId) => {
            clearTimeout(timeoutId);
        });
        this._saveTimeouts.clear();
        this._hideSaveIndicator();
    }

    public showPending(): void {
        this._showSaveIndicator('var(--text-primary)', 'ui.settings.saved_message', 'Settings Saved');
    }

    public showError(): void {
        this._showSaveIndicator('var(--error)', 'ui.settings.save_failed', 'Save failed');
    }

    public hide(): void {
        this._hideSaveIndicator();
    }

    public debouncedSave(key: string, value: string | number | boolean | null): void {
        const saveSessionVersion = this._saveSessionVersion;
        const existingTimeout = this._saveTimeouts.get(key);
        if (existingTimeout !== undefined) {
            clearTimeout(existingTimeout);
        }

        this.showPending();
        const timeout = setTimeout(async () => {
            try {
                await this._saveSetting(key, String(value));
                if (saveSessionVersion !== this._saveSessionVersion) {
                    return;
                }

                this._saveTimeouts.delete(key);
                if (this._saveTimeouts.size === 0) {
                    this._hideSaveIndicator();
                }
            } catch (err: unknown) {
                if (saveSessionVersion !== this._saveSessionVersion) {
                    return;
                }

                tracer.error(`[ModuleSettingsUI] Failed to autosave setting ${key}:`, err);
                this.showError();
                this._saveTimeouts.delete(key);
            }
        }, 1000);

        this._saveTimeouts.set(key, timeout);
    }

    private _showSaveIndicator(color: string, labelKey: string, fallback: string): void {
        const indicator = document.getElementById('save-indicator');
        if (!(indicator instanceof HTMLElement)) {
            return;
        }

        indicator.classList.add('show');
        const span = indicator.querySelector('span');
        if (span instanceof HTMLElement) {
            span.style.color = color;
            span.textContent = this._translate(labelKey, fallback);
        }
    }

    private _hideSaveIndicator(): void {
        const indicator = document.getElementById('save-indicator');
        if (indicator instanceof HTMLElement) {
            indicator.classList.remove('show');
        }
    }
}
