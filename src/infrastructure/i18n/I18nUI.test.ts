import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nUI } from './I18nUI';

describe('I18nUI', () => {
    const translations: Record<string, string> = {
        hello: 'Привет',
        placeholder_key: 'Введите текст',
        title_key: 'Заголовок',
        aria_key: 'Описание',
    };

    const service = {
        t: vi.fn((key: string, fallback: string) => translations[key] ?? fallback),
        getCurrentLang: vi.fn(() => 'ru'),
        loadTranslations: vi.fn(async () => {}),
    };

    let ui: I18nUI;

    beforeEach(() => {
        document.body.innerHTML = `
            <div class="lang-switcher-root">
                <button id="current-lang-trigger" aria-expanded="false">
                    <span class="flag-icon flag-gb"></span>
                </button>
                <div id="lang-menu-items" class="lang-menu-items open" aria-hidden="false">
                    <button class="lang-btn" data-lang="ru"></button>
                    <button class="lang-btn" data-lang="en"></button>
                </div>
            </div>
            <button id="sidebar-lang-trigger" aria-expanded="false"></button>
            <div id="sidebar-lang-menu"></div>
            <div id="lang-modal" class="visible"></div>
            <button class="lang-modal-btn" data-lang="en"></button>
            <button class="lang-modal-btn selected" data-lang="ru"></button>
            <div id="text-node" data-i18n="hello">Hello</div>
            <div id="svg-node" data-i18n="hello"><svg></svg></div>
            <input id="main-input" data-i18n="hello" value="">
            <textarea id="main-textarea" data-i18n="hello"></textarea>
            <input id="placeholder" data-i18n-placeholder="placeholder_key" placeholder="Fallback">
            <div id="title-node" data-i18n-title="title_key" title="Fallback title"></div>
            <button id="aria-node" data-i18n-aria-label="aria_key" aria-label="Fallback aria"></button>
            <div class="lang-option" data-i18n="hello">Skip me</div>
            <button class="lang-dropdown-btn" data-i18n="hello">Skip me too</button>
        `;
        document.documentElement.lang = 'en';
        ui = new I18nUI(service as never);
    });

    afterEach(() => {
        ui.destroy();
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('applies translations to text, placeholders, titles and aria labels', () => {
        ui.applyTranslations();

        expect(document.getElementById('text-node')?.textContent).toBe('Привет');
        expect(document.getElementById('svg-node')?.textContent).toBe(' Привет');
        expect((document.getElementById('main-input') as HTMLInputElement).placeholder).toBe(
            'Привет',
        );
        expect((document.getElementById('main-textarea') as HTMLTextAreaElement).placeholder).toBe(
            'Привет',
        );
        expect((document.getElementById('placeholder') as HTMLInputElement).placeholder).toBe(
            'Введите текст',
        );
        expect((document.getElementById('title-node') as HTMLElement).title).toBe('Заголовок');
        expect(
            (document.getElementById('aria-node') as HTMLElement).getAttribute('aria-label'),
        ).toBe('Описание');
        expect(document.querySelector('.lang-option')?.textContent).toBe('Skip me');
    });

    it('updates switcher UI and menu state based on current language', () => {
        ui.updateSwitcherUI();

        const triggerFlag = document.querySelector('#current-lang-trigger .flag-icon');
        const ruButton = document.querySelector('.lang-btn[data-lang="ru"]') as HTMLButtonElement;
        const enButton = document.querySelector('.lang-btn[data-lang="en"]') as HTMLButtonElement;

        expect(triggerFlag?.className).toContain('flag-ru');
        expect(ruButton.style.display).toBe('none');
        expect(ruButton.disabled).toBe(true);
        expect(ruButton.tabIndex).toBe(-1);
        expect(enButton.style.display).toBe('flex');
        expect(enButton.tabIndex).toBe(0);
    });

    it('toggles topbar and sidebar language menus', () => {
        ui.toggleMenu();
        ui.toggleSidebarLangMenu();

        expect(document.getElementById('lang-menu-items')?.classList.contains('open')).toBe(false);
        expect(document.getElementById('lang-menu-items')?.getAttribute('aria-hidden')).toBe(
            'true',
        );
        expect(
            (document.querySelector('.lang-btn[data-lang="en"]') as HTMLButtonElement).tabIndex,
        ).toBe(-1);
        expect(document.getElementById('current-lang-trigger')?.getAttribute('aria-expanded')).toBe(
            'false',
        );
        expect(document.getElementById('sidebar-lang-menu')?.classList.contains('open')).toBe(true);
        expect(document.getElementById('sidebar-lang-trigger')?.getAttribute('aria-expanded')).toBe(
            'true',
        );
    });

    it('sets the language, closes menus and confirms modal selection', async () => {
        await ui.setLanguage('ru');

        expect(service.loadTranslations).toHaveBeenCalledWith('ru');
        expect(document.documentElement.lang).toBe('ru');
        expect(document.getElementById('lang-menu-items')?.classList.contains('open')).toBe(false);
        expect(document.getElementById('current-lang-trigger')?.getAttribute('aria-expanded')).toBe(
            'false',
        );
        expect(document.getElementById('sidebar-lang-menu')?.classList.contains('open')).toBe(
            false,
        );
        expect(document.getElementById('sidebar-lang-trigger')?.getAttribute('aria-expanded')).toBe(
            'false',
        );

        ui.selectLangInModal('en');
        expect(
            document
                .querySelector('.lang-modal-btn[data-lang="en"]')
                ?.classList.contains('selected'),
        ).toBe(true);

        await ui.confirmLanguage();
        expect(service.loadTranslations).toHaveBeenLastCalledWith('en');
        expect(document.getElementById('lang-modal')?.classList.contains('hidden')).toBe(true);
    });

    it('closes the open language menu on outside click and cleans up on destroy', () => {
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('lang-menu-items')?.classList.contains('open')).toBe(false);
        expect(document.getElementById('lang-menu-items')?.getAttribute('aria-hidden')).toBe(
            'true',
        );
        expect(document.getElementById('current-lang-trigger')?.getAttribute('aria-expanded')).toBe(
            'false',
        );

        document.getElementById('lang-menu-items')?.classList.add('open');
        ui.destroy();
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('lang-menu-items')?.classList.contains('open')).toBe(true);
    });
});
