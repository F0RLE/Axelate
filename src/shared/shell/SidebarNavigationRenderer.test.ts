import { describe, expect, it, vi } from 'vitest';
import { SidebarNavigationRenderer } from './SidebarNavigationRenderer';

describe('SidebarNavigationRenderer', () => {
    function setupDom(): HTMLElement {
        document.body.innerHTML = `
            <div id="sidebar">
                <div class="main-menu"></div>
                <div class="bottom-menu"></div>
            </div>
        `;

        return document.getElementById('sidebar') as HTMLElement;
    }

    it('renders main and bottom navigation buttons', () => {
        const sidebar = setupDom();
        const renderer = new SidebarNavigationRenderer({
            getHiddenNavItems: vi.fn(() => []),
        });

        renderer.render(sidebar);

        expect(document.querySelectorAll('.main-menu .nav-btn')).toHaveLength(6);
        expect(document.querySelectorAll('.bottom-menu .nav-btn')).toHaveLength(1);
        expect(document.querySelector('.console-trigger')?.getAttribute('data-page')).toBe(
            'console',
        );

        const homeButton = document.querySelector<HTMLButtonElement>('.nav-btn[data-page="home"]');
        const homeIcon = homeButton?.querySelector('svg');
        expect(homeButton?.title).toBe('Home');
        expect(homeButton?.getAttribute('aria-label')).toBe('Home');
        expect(homeButton?.dataset['i18nTitle']).toBe('ui.launcher.web.home');
        expect(homeButton?.dataset['i18nAriaLabel']).toBe('ui.launcher.web.home');
        expect(homeIcon?.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(homeIcon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('marks hidden items as inaccessible', () => {
        const sidebar = setupDom();
        const renderer = new SidebarNavigationRenderer({
            getHiddenNavItems: vi.fn(() => ['chat', 'downloads']),
        });

        renderer.render(sidebar);

        const chatButton = document.querySelector('.nav-btn[data-page="chat"]');
        const downloadsButton = document.querySelector('.nav-btn[data-page="downloads"]');

        expect(chatButton?.classList.contains('hidden')).toBe(true);
        expect(downloadsButton?.classList.contains('hidden')).toBe(true);
        expect(chatButton?.getAttribute('aria-hidden')).toBe('true');
        expect(chatButton?.getAttribute('tabindex')).toBe('-1');
        expect((chatButton as HTMLButtonElement | null)?.disabled).toBe(true);
    });
});
