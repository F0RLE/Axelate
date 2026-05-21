/**
 * @module core/ui/I18nUI
 * @description Centralized UI management for internationalization and translation mapping
 */

import { type I18nService } from './I18nService';

export class I18nUI {
    private readonly _cleanupAbort: AbortController = new AbortController();

    constructor(private readonly _service: I18nService) {
        this._bindEvents();
    }

    /**
     * Binds global click events to close dropdown menus.
     * @sideeffect Adds global document listener
     */
    private _bindEvents(): void {
        document.addEventListener(
            'click',
            (e: Event) => {
                const target = e.target as HTMLElement;

                // Top Bar Menu
                const root = document.querySelector('.lang-switcher-root');
                const menu = document.getElementById('lang-menu-items');
                if (menu && menu.classList.contains('open') && root && !root.contains(target)) {
                    menu.classList.remove('open');
                    document
                        .getElementById('current-lang-trigger')
                        ?.setAttribute('aria-expanded', 'false');
                    this._syncTopbarMenuAccessibility();
                }
            },
            { signal: this._cleanupAbort.signal },
        );
    }

    /**
     * Cleans up listeners.
     */
    public destroy(): void {
        this._cleanupAbort.abort();
    }

    /**
     * Applies translations to UI elements, placeholders, and titles.
     * @param container - Optional container to scope the search (defaults to document)
     * @sideeffect Modifies the DOM tree
     */
    public applyTranslations(container: HTMLElement | Document = document): void {
        this._translateElements(container);
        this._translatePlaceholders(container);
        this._translateTitles(container);
        this._translateAriaLabels(container);
        if (container === document) {
            this.updateSwitcherUI();
        }
    }

    /**
     * Translates elements with the [data-i18n] attribute.
     */
    private _translateElements(container: HTMLElement | Document = document): void {
        container.querySelectorAll('[data-i18n]').forEach((el: Element) => {
            const element = el as HTMLElement;

            if (
                element.classList.contains('lang-option') ||
                element.classList.contains('lang-dropdown-btn')
            ) {
                return;
            }

            const key = element.dataset['i18n'];
            if (key === undefined || key === '') return;

            const paramsRaw = element.dataset['i18nParams'];
            let params: Record<string, unknown> = {};
            try {
                if (paramsRaw !== undefined && paramsRaw !== '') {
                    params = JSON.parse(paramsRaw) as Record<string, unknown>;
                }
            } catch {
                /* ignore */
            }

            const text = this._service.t(key, element.textContent || '', params);
            this._updateElementText(element, text);
        });
    }

    /**
     * Updates the text of a single element (handling inputs, options, etc).
     */
    private _updateElementText(element: HTMLElement, text: string): void {
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            this._updateInputPlaceholder(element as HTMLInputElement, text);
        } else if (element.tagName === 'OPTION') {
            element.textContent = text;
        } else {
            this._updateRegularElementText(element, text);
        }
    }

    /**
     * Updates the placeholder of an input element.
     */
    private _updateInputPlaceholder(input: HTMLInputElement, text: string): void {
        if (input.type === 'text' || input.type === 'password' || input.tagName === 'TEXTAREA') {
            input.placeholder = text;
        }
    }

    /**
     * Updates the text content of a regular element (preserving nested SVGs).
     */
    private _updateRegularElementText(element: HTMLElement, text: string): void {
        const svg = element.querySelector('svg');
        if (svg) {
            const textNode = Array.from(element.childNodes).find((n) => n.nodeType === 3);

            if (textNode === undefined) {
                element.appendChild(document.createTextNode(` ${text}`));
            } else {
                (textNode as Node).textContent = ` ${text}`;
            }
        } else if (element.textContent !== text) {
            element.textContent = text;
        }
    }

    /**
     * Translates elements with [data-i18n-placeholder].
     */
    private _translatePlaceholders(container: HTMLElement | Document = document): void {
        container.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const element = el as HTMLInputElement;
            const key = element.dataset['i18nPlaceholder'];
            if (key !== undefined && key !== '') {
                element.placeholder = this._service.t(key, element.placeholder);
            }
        });
    }

    /**
     * Translates elements with [data-i18n-title].
     */
    private _translateTitles(container: HTMLElement | Document = document): void {
        container.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const element = el as HTMLElement;
            const key = element.dataset['i18nTitle'];
            if (key !== undefined && key !== '') {
                element.title = this._service.t(key, element.title);
            }
        });
    }

    /**
     * Translates elements with [data-i18n-aria-label].
     */
    private _translateAriaLabels(container: HTMLElement | Document = document): void {
        container.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            const element = el as HTMLElement;
            const key = element.dataset['i18nAriaLabel'];
            if (key !== undefined && key !== '') {
                element.setAttribute(
                    'aria-label',
                    this._service.t(key, element.getAttribute('aria-label') ?? ''),
                );
            }
        });
    }

    /**
     * Updates the language switcher UI (flag and dropdown options).
     */
    public updateSwitcherUI(): void {
        const lang = this._service.getCurrentLang();
        this._updateFlagIcon(lang);
        this._updateMenuOptions(lang);
    }

    /**
     * Updates the flag icon in the language switcher trigger.
     */
    private _updateFlagIcon(lang: string): void {
        let flagClass = 'flag-gb';
        if (lang === 'ru') {
            flagClass = 'flag-ru';
        } else if (lang === 'zh') {
            flagClass = 'flag-cn';
        }

        const trigger = document.getElementById('current-lang-trigger');
        if (trigger) {
            const span = trigger.querySelector('.flag-icon');
            if (span) {
                span.className = `flag-icon ${flagClass}`;
            } else {
                // Fallback if span is missing
                const newSpan = document.createElement('span');
                newSpan.className = `flag-icon ${flagClass}`;
                trigger.textContent = '';
                trigger.appendChild(newSpan);
            }
        }
    }

    /**
     * Updates the visibility of language options in the menu.
     */
    private _updateMenuOptions(lang: string): void {
        document.querySelectorAll('.lang-menu-items .lang-btn').forEach((btn) => {
            const element = btn as HTMLButtonElement;
            const btnLang = element.dataset['lang'];
            const isCurrentLanguage = btnLang === lang;
            element.style.display = isCurrentLanguage ? 'none' : 'flex';
            element.disabled = isCurrentLanguage;
            if (isCurrentLanguage) {
                element.setAttribute('tabindex', '-1');
            }
        });
        this._syncTopbarMenuAccessibility();
    }

    /**
     * Toggles the top bar language menu.
     */
    public toggleMenu(): void {
        const menu = document.getElementById('lang-menu-items');
        const trigger = document.getElementById('current-lang-trigger');
        if (menu) {
            const isOpen = menu.classList.toggle('open');
            trigger?.setAttribute('aria-expanded', isOpen.toString());
            this._syncTopbarMenuAccessibility();
        }
    }

    private _syncTopbarMenuAccessibility(): void {
        const menu = document.getElementById('lang-menu-items');
        if (menu === null) {
            return;
        }

        const isOpen = menu.classList.contains('open');
        menu.setAttribute('aria-hidden', (!isOpen).toString());
        menu.querySelectorAll<HTMLButtonElement>('.lang-btn[data-lang]').forEach((button) => {
            const isVisibleOption = button.style.display !== 'none';
            button.tabIndex = isOpen && isVisibleOption ? 0 : -1;
        });
    }

    /**
     * Toggles the sidebar language menu.
     */
    public toggleSidebarLangMenu(): void {
        const menu = document.getElementById('sidebar-lang-menu');
        const trigger = document.getElementById('sidebar-lang-trigger');
        if (menu) {
            const isOpen = menu.classList.toggle('open');
            trigger?.setAttribute('aria-expanded', isOpen.toString());
        }
    }

    /**
     * Sets a new language globally.
     */
    public async setLanguage(lang: string): Promise<void> {
        // Close menus
        const menu = document.getElementById('lang-menu-items');
        if (menu) {
            menu.classList.remove('open');
            menu.setAttribute('aria-hidden', 'true');
        }
        document.getElementById('current-lang-trigger')?.setAttribute('aria-expanded', 'false');

        const sidebarMenu = document.getElementById('sidebar-lang-menu');
        if (sidebarMenu) {
            sidebarMenu.classList.remove('open');
        }
        document.getElementById('sidebar-lang-trigger')?.setAttribute('aria-expanded', 'false');

        // Load translations and apply
        await this._service.loadTranslations(lang);
        document.documentElement.lang = lang; // Set explicit lang for font switching
        this.applyTranslations();
        this._syncTopbarMenuAccessibility();
    }

    /**
     * Toggles the language selection in the welcome modal.
     */
    public selectLangInModal(lang: string): void {
        document.querySelectorAll('.lang-modal-btn').forEach((btn) => {
            btn.classList.remove('selected');
        });
        const selectedBtn = document.querySelector(`.lang-modal-btn[data-lang="${lang}"]`);
        if (selectedBtn) {
            selectedBtn.classList.add('selected');
        }
    }

    /**
     * Confirms the selected language from the welcome modal.
     */
    public async confirmLanguage(): Promise<void> {
        const selectedBtn = document.querySelector('.lang-modal-btn.selected');
        if (selectedBtn instanceof HTMLElement && selectedBtn.dataset['lang'] !== undefined) {
            const lang = selectedBtn.dataset['lang'];
            await this.setLanguage(lang);
        }

        const modal = document.getElementById('lang-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    public initEmojiFlags(): void {
        this.updateSwitcherUI();
    }
}
