/**
 * @module core/services/I18nService
 * @description Internationalization service for managing translations and language settings
 */

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { EventBus } from '@/shared/services/EventBus';
import { type IBridge } from '@/shared/types/IBridge';

export class I18nService {
    private _translations: Record<string, string> = {};
    private _currentLang = 'en';
    private _initialized = false;

    constructor(
        private readonly _bridge: IBridge,
        private readonly _eventBus: EventBus,
        private readonly _tracer: LoggerService,
    ) {}

    /**
     * Initializes the i18n service by detecting system language and loading translations.
     */
    public async init(initialLang?: string): Promise<void> {
        if (this._initialized) {
            this._tracer.warn('[I18n] Already initialized');
            return;
        }

        // Always trust the backend/system language as the source of truth
        const sysLang = await this.getSystemLanguage();
        const lang = initialLang !== undefined && initialLang !== '' ? initialLang : sysLang;
        await this.loadTranslations(lang);
        this._initialized = true;
    }

    /**
     * Detects the system language from the bridge backend.
     */
    public async getSystemLanguage(): Promise<string> {
        try {
            const backendLang = await this._getTauriLanguage();
            if (backendLang !== null && backendLang !== '') return backendLang;
        } catch (e) {
            this._tracer.warn('[I18n] Failed to get backend language', e);
        }
        return 'en';
    }

    /**
     * Invokes Tauri command to get system language.
     */
    private async _getTauriLanguage(): Promise<string | null> {
        try {
            const res = await this._runWithTimeout(
                this._bridge.invoke<string | undefined>('get_system_language'),
                1000,
                'Timeout',
            );

            if (res !== undefined && res !== 'unknown') return res;
        } catch {
            this._tracer.warn('[I18n] Native system language check failed or timed out');
        }
        return null;
    }

    /**
     * Loads translation files for the specified language.
     */
    public async loadTranslations(lang: string): Promise<void> {
        const previousLang = this._currentLang;

        try {
            // Backend now handles merging base (en) with target lang
            const translations = await this._fetchTranslations(lang);
            this._translations = translations;
            this._currentLang = lang;
            document.documentElement.lang = lang;

            // Persist only to backend
            this._syncToBackend(lang).catch((e: unknown) => {
                this._tracer.error(String(e));
            });

            this._notifyLanguageChange(lang, previousLang);
        } catch (e) {
            this._tracer.error(`[I18n] Failed to load translations for ${lang}`, e);
            // Fallback to empty or keep existing?
            // If failed, we might want to try 'en' explicitly if we haven't already
            if (lang !== 'en') {
                try {
                    this._translations = await this._fetchTranslations('en');
                    this._currentLang = 'en';
                    document.documentElement.lang = 'en';
                    this._notifyLanguageChange('en', previousLang);
                } catch (err) {
                    this._tracer.error('[I18n] Critical: Failed to load fallback English', err);
                }
            }
        }
    }

    /**
     * Fetches translation JSON from the bridge backend.
     */
    private async _fetchTranslations(lang: string): Promise<Record<string, string>> {
        const timeoutMs = 2000;
        const failMsg = `Timeout loading translations for ${lang}`;
        return await this._runWithTimeout(
            this._bridge.invoke<Record<string, string>>('get_translations', { lang }),
            timeoutMs,
            failMsg,
        );
    }

    private async _runWithTimeout<T>(
        operation: Promise<T>,
        timeoutMs: number,
        timeoutMessage: string,
    ): Promise<T> {
        let timeoutId!: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(timeoutMessage));
            }, timeoutMs);
        });

        try {
            return await Promise.race([operation, timeout]);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Synchronizes the selected language to the backend settings.
     */
    private async _syncToBackend(lang: string) {
        try {
            const uiState = await this._bridge.invoke<Record<string, unknown>>('get_ui_state');
            await this._bridge.invoke('save_ui_state', {
                state: {
                    ...uiState,
                    preferred_language: lang.toLowerCase(),
                },
            });
        } catch (e) {
            this._tracer.warn('[I18n] Sync to settings failed', e);
        }
    }

    /**
     * Translates a key into the current language, with optional parameters.
     */
    public t(key: string, defaultText = '', params: Record<string, unknown> = {}): string {
        let text = this._translations[key] ?? defaultText;
        if (text === '') text = key;

        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, String(v));
        }
        return text;
    }

    /**
     * Gets the current active language code.
     */
    public getCurrentLang(): string {
        return this._currentLang === '' ? 'en' : this._currentLang;
    }

    private _notifyLanguageChange(lang: string, previousLang: string): void {
        globalThis.dispatchEvent(new CustomEvent('language-changed', { detail: { lang } }));
        globalThis.dispatchEvent(new CustomEvent('lang:changed', { detail: lang }));
        this._eventBus.emit('i18n:language:change', { lang, previousLang });
        this._eventBus.emit('i18n:translations:loaded', { lang });
    }
}
