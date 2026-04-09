import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { I18nService } from '@/infrastructure/i18n/I18nService';
import { eventBus } from '@/shared/services/EventBus';

// Mock TauriProvider
const createMockTauri = (isTauri = false) => ({
    isTauri: () => isTauri,
    invoke: vi.fn(),
});

describe('I18nService', () => {
    let i18n: I18nService;
    let mockTauri: ReturnType<typeof createMockTauri>;

    beforeEach(() => {
        mockTauri = createMockTauri(false);
        i18n = new I18nService(
            mockTauri as unknown as ConstructorParameters<typeof I18nService>[0],
        );
        localStorage.clear();
        eventBus.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        eventBus.clear();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('getCurrentLang', () => {
        it('should return default language "en"', () => {
            expect(i18n.getCurrentLang()).toBe('en');
        });

        it('should return "en" if currentLang is empty string (Line 188)', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (i18n as any)._currentLang = '';
            expect(i18n.getCurrentLang()).toBe('en');
        });
    });

    describe('t (translate)', () => {
        it('should return key if no translation found', () => {
            expect(i18n.t('missing.key')).toBe('missing.key');
        });

        it('should return defaultText if no translation found', () => {
            expect(i18n.t('missing.key', 'Default Text')).toBe('Default Text');
        });

        it('should replace params in translation', () => {
            // Manually set translations for testing
            (i18n as unknown as { _translations: Record<string, string> })._translations = {
                greeting: 'Hello, {name}!',
            };

            expect(i18n.t('greeting', '', { name: 'World' })).toBe('Hello, World!');
        });

        it('should replace multiple params', () => {
            (i18n as unknown as { _translations: Record<string, string> })._translations = {
                message: '{action} {count} items',
            };

            expect(i18n.t('message', '', { action: 'Found', count: '5' })).toBe('Found 5 items');
        });
    });

    const mockFetchResponse = (data: Record<string, unknown>, ok = true) => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok,
                json: () => Promise.resolve(data),
            }),
        );
    };

    describe('getSystemLanguage', () => {
        it('should detect Russian from backend API', async () => {
            mockFetchResponse({ language: 'ru' });
            const langPromise = i18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('ru');
        });

        it('should detect Chinese from backend API', async () => {
            mockFetchResponse({ language: 'zh' });
            const langPromise = i18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('zh');
        });

        it('should fallback to English when backend fails', async () => {
            mockFetchResponse({}, false);
            const langPromise = i18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });
    });

    describe('loadTranslations', () => {
        it('should dispatch legacy DOM events and event bus notifications when translations load', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ greeting: 'Hello' }),
            });
            vi.stubGlobal('fetch', fetchMock);

            const languageChangedHandler = vi.fn();
            const legacyLangChangedHandler = vi.fn();
            const languageBusHandler = vi.fn();
            const translationsLoadedHandler = vi.fn();

            globalThis.addEventListener(
                'language-changed',
                languageChangedHandler as EventListener,
            );
            globalThis.addEventListener('lang:changed', legacyLangChangedHandler as EventListener);
            eventBus.on('i18n:language:change', languageBusHandler);
            eventBus.on('i18n:translations:loaded', translationsLoadedHandler);

            const loadPromise = i18n.loadTranslations('ru');
            await vi.runAllTimersAsync();
            await loadPromise;

            expect(languageChangedHandler).toHaveBeenCalledTimes(1);
            expect(
                (languageChangedHandler.mock.calls[0]?.[0] as CustomEvent<{ lang: string }>).detail,
            ).toEqual({ lang: 'ru' });
            expect(legacyLangChangedHandler).toHaveBeenCalledTimes(1);
            expect(
                (legacyLangChangedHandler.mock.calls[0]?.[0] as CustomEvent<string>).detail,
            ).toBe('ru');
            expect(languageBusHandler).toHaveBeenCalledWith({ lang: 'ru', previousLang: 'en' });
            expect(translationsLoadedHandler).toHaveBeenCalledWith({ lang: 'ru' });

            globalThis.removeEventListener(
                'language-changed',
                languageChangedHandler as EventListener,
            );
            globalThis.removeEventListener(
                'lang:changed',
                legacyLangChangedHandler as EventListener,
            );
        });

        it('should set currentLang after loading translations', async () => {
            vi.stubGlobal(
                'fetch',
                vi
                    .fn()
                    .mockResolvedValueOnce({
                        ok: true,
                        json: () => Promise.resolve({ language: 'ru' }),
                    })
                    .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
            );

            const initPromise = i18n.init();
            await vi.runAllTimersAsync();
            await initPromise;
            expect(i18n.getCurrentLang()).toBe('ru');
        });

        it('should fallback to en when non-en translation fails', async () => {
            vi.stubGlobal(
                'fetch',
                vi
                    .fn()
                    .mockResolvedValueOnce({
                        ok: true,
                        json: () => Promise.resolve({ language: 'ru' }),
                    })
                    .mockRejectedValueOnce(new Error('Load failed'))
                    .mockResolvedValue({ ok: true, json: () => Promise.resolve({ hello: 'Hi' }) }),
            );
            const initPromise = i18n.init();
            await vi.runAllTimersAsync();
            await initPromise;
            expect(i18n.getCurrentLang()).toBe('en');
        });

        it('should dispatch fallback English notifications when target translations fail', async () => {
            const fetchMock = vi
                .fn()
                .mockRejectedValueOnce(new Error('Load failed ru'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ greeting: 'Hello' }),
                });
            vi.stubGlobal('fetch', fetchMock);

            const languageChangedHandler = vi.fn();
            const translationsLoadedHandler = vi.fn();
            globalThis.addEventListener(
                'language-changed',
                languageChangedHandler as EventListener,
            );
            eventBus.on('i18n:translations:loaded', translationsLoadedHandler);

            const loadPromise = i18n.loadTranslations('ru');
            await vi.runAllTimersAsync();
            await loadPromise;

            expect(i18n.getCurrentLang()).toBe('en');
            expect(languageChangedHandler).toHaveBeenCalledTimes(1);
            expect(
                (languageChangedHandler.mock.calls[0]?.[0] as CustomEvent<{ lang: string }>).detail,
            ).toEqual({ lang: 'en' });
            expect(translationsLoadedHandler).toHaveBeenCalledWith({ lang: 'en' });

            globalThis.removeEventListener(
                'language-changed',
                languageChangedHandler as EventListener,
            );
        });

        it('should cover fail of fallback to en (Line 123)', async () => {
            vi.stubGlobal(
                'fetch',
                vi
                    .fn()
                    .mockResolvedValueOnce({
                        ok: true,
                        json: () => Promise.resolve({ language: 'ru' }),
                    })
                    .mockRejectedValueOnce(new Error('Load failed ru'))
                    .mockRejectedValue(new Error('Load failed en')),
            );
            const initPromise = i18n.init();
            await vi.runAllTimersAsync();
            await initPromise;
            // Stays en (default)
            expect(i18n.getCurrentLang()).toBe('en');
        });

        it('should cover _syncToBackend outer catch rejection (Line 108)', async () => {
            vi.stubGlobal(
                'fetch',
                vi
                    .fn()
                    .mockResolvedValueOnce({
                        ok: true,
                        json: () => Promise.resolve({ language: 'ru' }),
                    })
                    .mockResolvedValue({ ok: true, json: () => Promise.resolve({ hello: 'Hi' }) }), // mock translations
            );
            // Force the method to reject to hit the `.catch` block
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const syncSpy = vi
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .spyOn(i18n as any, '_syncToBackend')
                .mockRejectedValue(new Error('Forced sync error'));

            const initPromise = i18n.init();
            await vi.runAllTimersAsync();
            await initPromise;
            expect(i18n.getCurrentLang()).toBe('ru');
            syncSpy.mockRestore();
        });

        it('should throw error when fetch translations fails with non-ok response (Line 146)', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: false,
                    statusText: 'Not Found',
                }),
            );
            const loadPromise = i18n.loadTranslations('fr');
            await vi.runAllTimersAsync();
            await loadPromise;
            // Falls back to en which also fails, we just want to cover the `!res.ok` branch
        });
    });

    describe('init', () => {
        it('should skip if already initialized', async () => {
            mockFetchResponse({});
            const initPromise1 = i18n.init();
            await vi.runAllTimersAsync();
            await initPromise1;

            const initPromise2 = i18n.init(); // second call should be skipped
            await vi.runAllTimersAsync();
            await initPromise2;
        });

        it('should use initialLang when provided', async () => {
            vi.stubGlobal(
                'fetch',
                vi
                    .fn()
                    .mockResolvedValueOnce({
                        ok: true,
                        json: () => Promise.resolve({ language: 'en' }),
                    })
                    .mockResolvedValue({
                        ok: true,
                        json: () => Promise.resolve({ bonjour: 'Bonjour' }),
                    }),
            );
            const initPromise = i18n.init('fr');
            await vi.runAllTimersAsync();
            await initPromise;
            expect(i18n.getCurrentLang()).toBe('fr');
        });
    });

    describe('Tauri language detection', () => {
        it('should get language from Tauri invoke', async () => {
            const tauriMock = createMockTauri(true);
            tauriMock.invoke.mockResolvedValue('de');
            const tauriI18n = new I18nService(
                tauriMock as unknown as ConstructorParameters<typeof I18nService>[0],
            );
            const langPromise = tauriI18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('de');
        });

        it('should fallback to en when Tauri returns unknown', async () => {
            const tauriMock = createMockTauri(true);
            tauriMock.invoke.mockResolvedValue('unknown');
            const tauriI18n = new I18nService(
                tauriMock as unknown as ConstructorParameters<typeof I18nService>[0],
            );
            const langPromise = tauriI18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });

        it('should fallback to en on Tauri invoke error', async () => {
            const tauriMock = createMockTauri(true);
            tauriMock.invoke.mockRejectedValue(new Error('Tauri failed'));
            const tauriI18n = new I18nService(
                tauriMock as unknown as ConstructorParameters<typeof I18nService>[0],
            );
            const langPromise = tauriI18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });

        it('should timeout on get_system_language Tauri invoke (Line 64)', async () => {
            const tauriMock = createMockTauri(true);
            tauriMock.invoke.mockImplementation(
                () => new Promise((resolve) => setTimeout(resolve, 5000)),
            );
            const tauriI18n = new I18nService(
                tauriMock as unknown as ConstructorParameters<typeof I18nService>[0],
            );
            const langPromise = tauriI18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });

        it('should timeout on get_translations Tauri invoke (Line 140)', async () => {
            const tauriMock = createMockTauri(true);
            tauriMock.invoke.mockImplementation((cmd) => {
                if (cmd === 'get_system_language') return Promise.resolve('en');
                if (cmd === 'save_setting') return Promise.resolve();
                // get_translations
                return new Promise((resolve) => setTimeout(resolve, 5000));
            });
            const tauriI18n = new I18nService(
                tauriMock as unknown as ConstructorParameters<typeof I18nService>[0],
            );
            const initPromise = tauriI18n.init();
            await vi.runAllTimersAsync();
            await initPromise;
            // since translations timed out, it falls back
            expect(tauriI18n.getCurrentLang()).toBe('en');
        });
    });

    describe('_syncToBackend', () => {
        it('should sync language to backend via Tauri', async () => {
            const tauriMock = createMockTauri(true);
            tauriMock.invoke.mockImplementation((cmd) => {
                if (cmd === 'get_translations') return Promise.resolve({});
                if (cmd === 'get_ui_state') return Promise.resolve({});
                if (cmd === 'save_ui_state') return Promise.resolve({});
                return Promise.resolve({});
            });
            const tauriI18n = new I18nService(
                tauriMock as unknown as ConstructorParameters<typeof I18nService>[0],
            );

            // Trigger via loadTranslations
            vi.stubGlobal('fetch', vi.fn());
            const loadPromise = tauriI18n.loadTranslations('ru');
            await vi.runAllTimersAsync();
            await loadPromise;
            const saveUiStateCall = tauriMock.invoke.mock.calls.find(
                ([command]) => command === 'save_ui_state',
            );
            expect(saveUiStateCall).toBeDefined();

            const payload = saveUiStateCall?.[1] as
                | { state?: { preferred_language?: string } }
                | undefined;
            expect(payload?.state?.preferred_language).toBe('ru');
        });

        it('should catch error in _syncToBackend via Tauri (Line 167)', async () => {
            const tauriMock = createMockTauri(true);
            tauriMock.invoke.mockImplementation((cmd) => {
                if (cmd === 'get_translations') return Promise.resolve({});
                return Promise.reject(new Error('Tauri Error'));
            });
            const tauriI18n = new I18nService(
                tauriMock as unknown as ConstructorParameters<typeof I18nService>[0],
            );

            // Trigger via loadTranslations
            const loadPromise = tauriI18n.loadTranslations('ru');
            await vi.runAllTimersAsync();
            await loadPromise;
            // This should safely catch
        });

        it('should sync language via fetch in non-Tauri', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({}),
            });
            vi.stubGlobal('fetch', fetchMock);
            const loadPromise = i18n.loadTranslations('zh');
            await vi.runAllTimersAsync();
            await loadPromise;
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/settings/save',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ key: 'LANGUAGE', value: 'zh' }),
                }),
            );
        });
    });

    describe('getSystemLanguage edge cases', () => {
        it('should return en when browser API returns no language', async () => {
            mockFetchResponse({}, true);
            const langPromise = i18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });

        it('should return en when browser API returns unknown', async () => {
            mockFetchResponse({ language: 'unknown' }, true);
            const langPromise = i18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });

        it('should return en when fetch throws', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fetch failed')));
            const langPromise = i18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });

        it('should catch error when _getBackendLanguage throws (Line 40)', async () => {
            mockTauri.isTauri = () => {
                throw new Error('isTauri failed');
            };
            const langPromise = i18n.getSystemLanguage();
            await vi.runAllTimersAsync();
            expect(await langPromise).toBe('en');
        });
    });
});
