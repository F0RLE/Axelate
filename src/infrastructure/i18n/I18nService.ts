/**
 * @module core/services/I18nService
 * @description Internationalization service for managing translations and language settings
 */

import { tracer } from '@/infrastructure/logging/LoggerService';
import { eventBus } from '@/shared/services/EventBus';
import { type IBridge } from '@/shared/types/IBridge';

export class I18nService {
    private _translations: Record<string, string> = {};
    private _currentLang = 'en';
    private _initialized = false;

    constructor(private readonly _bridge: IBridge) {}

    /**
     * Initializes the i18n service by detecting system language and loading translations.
     */
    public async init(initialLang?: string): Promise<void> {
        if (this._initialized) {
            tracer.warn('[I18n] Already initialized');
            return;
        }

        // Always trust the backend/system language as the source of truth
        const sysLang = await this.getSystemLanguage();
        const lang = initialLang !== undefined && initialLang !== '' ? initialLang : sysLang;
        await this.loadTranslations(lang);
        this._initialized = true;
    }

    /**
     * Detects the system language from backend or browser API.
     */
    public async getSystemLanguage(): Promise<string> {
        try {
            const backendLang = await this._getBackendLanguage();
            if (backendLang !== null && backendLang !== '') return backendLang;
        } catch (e) {
            tracer.warn('[I18n] Failed to get backend language', e);
        }
        return 'en';
    }

    /**
     * Fetches language from the backend (Tauri or Mock API).
     */
    private async _getBackendLanguage(): Promise<string | null> {
        if (this._bridge.isTauri()) {
            return await this._getTauriLanguage();
        } else {
            return await this._getBrowserApiLanguage();
        }
    }

    /**
     * Invokes Tauri command to get system language.
     */
    private async _getTauriLanguage(): Promise<string | null> {
        try {
            const invokePromise = this._bridge.invoke('get_system_language');
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => {
                    reject(new Error('Timeout'));
                }, 1000),
            );
            const res = (await Promise.race([invokePromise, timeoutPromise])) as string | undefined;

            if (res !== undefined && res !== 'unknown') return res;
        } catch {
            tracer.warn('[I18n] Native system language check failed or timed out');
        }
        return null;
    }

    /**
     * Fetches language from browser-based mock API.
     */
    private async _getBrowserApiLanguage(): Promise<string | null> {
        try {
            const res = await fetch('/api/system/language');
            if (res.ok) {
                const data = (await res.json()) as { language?: string };
                if (data.language !== undefined && data.language !== 'unknown')
                    return data.language;
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    /**
     * Loads translation files for the specified language.
     */
    public async loadTranslations(lang: string): Promise<void> {
        tracer.info(`[I18n] Loading ${lang}...`);
        const previousLang = this._currentLang;

        try {
            // Backend now handles merging base (en) with target lang
            const translations = await this._fetchTranslations(lang);
            this._translations = translations;
            this._currentLang = lang;
            document.documentElement.lang = lang;

            // Persist only to backend
            this._syncToBackend(lang).catch((e: unknown) => {
                tracer.error(String(e));
            });

            this._notifyLanguageChange(lang, previousLang);
        } catch (e) {
            tracer.error(`[I18n] Failed to load translations for ${lang}`, e);
            // Fallback to empty or keep existing?
            // If failed, we might want to try 'en' explicitly if we haven't already
            if (lang !== 'en') {
                try {
                    this._translations = await this._fetchTranslations('en');
                    this._currentLang = 'en';
                    document.documentElement.lang = 'en';
                    this._notifyLanguageChange('en', previousLang);
                } catch (err) {
                    tracer.error('[I18n] Critical: Failed to load fallback English', err);
                }
            }
        }
    }

    /**
     * Fetches translation JSON from host or mock API.
     */
    private async _fetchTranslations(lang: string): Promise<Record<string, string>> {
        const timeoutMs = 2000;
        const failMsg = `Timeout loading translations for ${lang}`;

        if (this._bridge.isTauri()) {
            const p = this._bridge.invoke<Record<string, string>>('get_translations', { lang });
            const t = new Promise<Record<string, string>>((_, r) =>
                setTimeout(() => {
                    r(new Error(failMsg));
                }, timeoutMs),
            );
            return await Promise.race([p, t]);
        } else {
            const res = await fetch(`/api/translations?lang=${lang}`);
            if (!res.ok) throw new Error(res.statusText);
            return (await res.json()) as Record<string, string>;
        }
    }

    /**
     * Synchronizes the selected language to the backend settings.
     */
    private async _syncToBackend(lang: string) {
        try {
            if (this._bridge.isTauri()) {
                const uiState = await this._bridge.invoke<Record<string, unknown>>('get_ui_state');
                await this._bridge.invoke('save_ui_state', {
                    state: {
                        ...uiState,
                        preferred_language: lang.toLowerCase(),
                    },
                });
            } else {
                await fetch('/api/settings/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'LANGUAGE', value: lang }),
                });
            }
        } catch (e) {
            tracer.warn('[I18n] Sync to settings failed', e);
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
        eventBus.emit('i18n:language:change', { lang, previousLang });
        eventBus.emit('i18n:translations:loaded', { lang });
        tracer.info(`[I18n] Language changed to ${lang}, notifications dispatched`);
    }
}
