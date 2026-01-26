import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nService } from '../modules/core/services/I18nService';

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
        i18n = new I18nService(mockTauri as any);
        localStorage.clear();
    });

    describe('getCurrentLang', () => {
        it('should return default language "en"', () => {
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
            (i18n as any)._translations = {
                greeting: 'Hello, {name}!',
            };

            expect(i18n.t('greeting', '', { name: 'World' })).toBe('Hello, World!');
        });

        it('should replace multiple params', () => {
            (i18n as any)._translations = {
                message: '{action} {count} items',
            };

            expect(i18n.t('message', '', { action: 'Found', count: '5' })).toBe('Found 5 items');
        });
    });

    const mockFetchResponse = (data: any, ok = true) => {
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
            const lang = await i18n.getSystemLanguage();
            expect(lang).toBe('ru');
            vi.unstubAllGlobals();
        });

        it('should detect Chinese from backend API', async () => {
            mockFetchResponse({ language: 'zh' });
            const lang = await i18n.getSystemLanguage();
            expect(lang).toBe('zh');
            vi.unstubAllGlobals();
        });

        it('should fallback to English when backend fails', async () => {
            mockFetchResponse({}, false);
            const lang = await i18n.getSystemLanguage();
            expect(lang).toBe('en');
            vi.unstubAllGlobals();
        });
    });

    describe('loadTranslations', () => {
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

            await i18n.init();
            expect(i18n.getCurrentLang()).toBe('ru');
            vi.unstubAllGlobals();
        });
    });
});
