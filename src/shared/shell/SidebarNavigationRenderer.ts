import { APP_PAGES, type IAppPage } from '@/shared/config/AppPages';

type SidebarNavigationRendererDeps = {
    getHiddenNavItems: () => string[];
};

type SidebarMenus = {
    mainMenu: HTMLElement;
    bottomMenu: HTMLElement;
};

export class SidebarNavigationRenderer {
    constructor(private readonly _deps: SidebarNavigationRendererDeps) {}

    public render(sidebar: HTMLElement): void {
        const menus = this._getMenus(sidebar);
        if (menus === null) {
            return;
        }

        const mainButtons = APP_PAGES.filter((page) => page.isBottom !== true).map((page) =>
            this._createNavButton(page),
        );
        const bottomButtons = APP_PAGES.filter((page) => page.isBottom === true).map((page) =>
            this._createNavButton(page),
        );

        menus.mainMenu.replaceChildren(...mainButtons);
        menus.bottomMenu.replaceChildren(...bottomButtons);
    }

    private _getMenus(sidebar: HTMLElement): SidebarMenus | null {
        const mainMenu = sidebar.querySelector('.main-menu');
        const bottomMenu = sidebar.querySelector('.bottom-menu');
        if (!(mainMenu instanceof HTMLElement) || !(bottomMenu instanceof HTMLElement)) {
            return null;
        }

        return { mainMenu, bottomMenu };
    }

    private _createNavButton(page: IAppPage): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nav-btn';
        this._applyHiddenNavState(button, page.id);
        if (page.id === 'console') {
            button.classList.add('console-trigger');
        }
        button.dataset['page'] = page.id;
        button.dataset['i18nTitle'] = page.i18nKey;
        button.dataset['i18nAriaLabel'] = page.i18nKey;
        button.title = page.defaultLabel;
        button.setAttribute('aria-label', page.defaultLabel);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');

        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', page.icon);
        svg.appendChild(use);

        const label = document.createElement('span');
        label.dataset['i18n'] = page.i18nKey;
        label.textContent = page.defaultLabel;

        button.appendChild(svg);
        button.appendChild(label);
        return button;
    }

    private _applyHiddenNavState(button: HTMLButtonElement, pageId: string): void {
        if (!this._deps.getHiddenNavItems().includes(pageId)) {
            return;
        }

        button.classList.add('hidden');
        button.setAttribute('aria-hidden', 'true');
        button.setAttribute('tabindex', '-1');
        button.disabled = true;
    }
}
