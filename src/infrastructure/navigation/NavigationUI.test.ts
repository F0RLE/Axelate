import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationUI } from './NavigationUI';
import type { NavigationService } from './NavigationService';
import type { SoundService } from '@/shared/services/SoundService';
import { eventBus } from '@/shared/services/EventBus';

function setupDOM(): void {
    document.body.innerHTML = `
        <div id="sidebar">
            <button class="nav-btn" data-page="settings">
                <span class="nav-label">Settings</span>
            </button>
        </div>
        <div id="home" class="page active"></div>
        <div id="settings" class="page"></div>
    `;
}

describe('NavigationUI', () => {
    let navigationService: NavigationService;
    let soundService: SoundService;
    let navigationUI: NavigationUI;

    beforeEach(() => {
        setupDOM();

        navigationService = {
            getCurrentPage: vi.fn(() => 'home'),
            setCurrentPage: vi.fn(),
            goBack: vi.fn(() => 'home'),
            goForward: vi.fn(() => 'settings'),
            popBackAction: vi.fn(() => false),
            popForwardAction: vi.fn(() => false),
        } as unknown as NavigationService;

        soundService = {
            playToggle: vi.fn(),
        } as unknown as SoundService;

        navigationUI = new NavigationUI(navigationService, soundService);
    });

    it('should be idempotent across repeated init calls', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        const button = document.querySelector<HTMLElement>('.nav-btn');

        navigationUI.init();
        navigationUI.init();
        button?.click();

        expect(showPageSpy).toHaveBeenCalledTimes(1);
    });

    it('should remove sidebar and global listeners on destroy', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();

        navigationUI.init();
        navigationUI.destroy();

        document.querySelector<HTMLElement>('.nav-btn')?.click();
        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 3 }));
        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(showPageSpy).not.toHaveBeenCalled();
        expect(navigationService.goBack).not.toHaveBeenCalled();
        expect(navigationService.popBackAction).not.toHaveBeenCalled();
    });

    it('should allow re-init after destroy without duplicating listeners', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();

        navigationUI.init();
        navigationUI.destroy();
        navigationUI.init();

        document.querySelector<HTMLElement>('.nav-btn')?.click();

        expect(showPageSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle back, forward and escape navigation branches', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        navigationUI.init();

        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 3 }));
        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 4 }));

        expect(navigationService.goBack).toHaveBeenCalled();
        expect(navigationService.goForward).toHaveBeenCalled();
        expect(showPageSpy).toHaveBeenCalledWith('home', null, false, true);
        expect(showPageSpy).toHaveBeenCalledWith('settings', null, false, true);

        vi.mocked(navigationService.popBackAction).mockReturnValue(true);
        const escapeEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        globalThis.dispatchEvent(escapeEvent);
        expect(escapeEvent.defaultPrevented).toBe(true);
    });

    it('should show target page, emit navigation payload and update active sidebar state', async () => {
        const emitSpy = vi.spyOn(eventBus, 'emit');
        const button = document.querySelector<HTMLElement>('.nav-btn');

        await navigationUI.showPage('settings', button);

        expect(soundService.playToggle).toHaveBeenCalledWith(true);
        expect(document.getElementById('settings')?.classList.contains('active')).toBe(true);
        expect(button?.classList.contains('active')).toBe(true);
        expect(button?.getAttribute('aria-current')).toBe('page');
        expect(navigationService.setCurrentPage).toHaveBeenCalledWith('settings', false);
        expect(emitSpy).toHaveBeenCalledWith('page:change', {
            pageId: 'settings',
            previousPageId: 'home',
        });
    });

    it('should support silent and buttonless navigation and warn on missing pages', async () => {
        await navigationUI.showPage('settings', null, true, true);
        expect(soundService.playToggle).not.toHaveBeenCalled();
        expect(navigationService.setCurrentPage).toHaveBeenCalledWith('settings', true);

        await navigationUI.showPage('missing');
        expect(navigationService.setCurrentPage).toHaveBeenCalledTimes(1);
    });
});
