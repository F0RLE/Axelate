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
        <dialog id="app-selection-modal" class="hidden"></dialog>
    `;
}

function dispatchWindowEventWithTarget(event: Event, target: EventTarget): void {
    Object.defineProperty(event, 'target', {
        configurable: true,
        value: target,
    });
}

function dispatchNavigationKey(
    navigationUI: NavigationUI,
    event: KeyboardEvent,
    target: EventTarget,
): void {
    dispatchWindowEventWithTarget(event, target);
    (
        navigationUI as unknown as {
            _keyDownHandler: ((e: KeyboardEvent) => void) | null;
        }
    )._keyDownHandler?.(event);
}

function dispatchNavigationMouse(
    navigationUI: NavigationUI,
    event: MouseEvent,
    target: EventTarget,
): void {
    dispatchWindowEventWithTarget(event, target);
    (
        navigationUI as unknown as {
            _mouseUpHandler: ((e: MouseEvent) => void) | null;
        }
    )._mouseUpHandler?.(event);
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
        navigationUI.init();
        navigationUI.init();

        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 3 }));

        expect(navigationService.goBack).toHaveBeenCalledTimes(1);
    });

    it('should remove global listeners on destroy', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();

        navigationUI.init();
        navigationUI.destroy();

        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 3 }));
        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(showPageSpy).not.toHaveBeenCalled();
        expect(navigationService.goBack).not.toHaveBeenCalled();
        expect(navigationService.popBackAction).not.toHaveBeenCalled();
    });

    it('should allow re-init after destroy without duplicating listeners', () => {
        navigationUI.init();
        navigationUI.destroy();
        navigationUI.init();

        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 3 }));

        expect(navigationService.goBack).toHaveBeenCalledTimes(1);
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

    it('should ignore side-button navigation with modifier keys', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        navigationUI.init();

        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 3, ctrlKey: true }));
        globalThis.dispatchEvent(new MouseEvent('mouseup', { button: 4, shiftKey: true }));

        expect(navigationService.goBack).not.toHaveBeenCalled();
        expect(navigationService.goForward).not.toHaveBeenCalled();
        expect(showPageSpy).not.toHaveBeenCalled();
    });

    it('should ignore escape back actions while typing in editable controls', () => {
        navigationUI.init();
        const input = document.createElement('input');
        document.body.appendChild(input);

        const escapeEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(escapeEvent);

        expect(navigationService.popBackAction).not.toHaveBeenCalled();
    });

    it('should ignore side mouse navigation from editable controls', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        navigationUI.init();
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);

        textarea.dispatchEvent(
            new MouseEvent('mouseup', {
                button: 3,
                bubbles: true,
                cancelable: true,
            }),
        );

        expect(navigationService.goBack).not.toHaveBeenCalled();
        expect(showPageSpy).not.toHaveBeenCalled();
    });

    it('should allow escape back actions while focused on a button', () => {
        navigationUI.init();
        const button = document.createElement('button');
        document.body.appendChild(button);
        vi.mocked(navigationService.popBackAction).mockReturnValue(true);

        const escapeEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        dispatchNavigationKey(navigationUI, escapeEvent, button);

        expect(navigationService.popBackAction).toHaveBeenCalledTimes(1);
        expect(escapeEvent.defaultPrevented).toBe(true);
    });

    it('should use side-button back actions from button targets instead of ignoring them', () => {
        navigationUI.init();
        const button = document.createElement('button');
        document.body.appendChild(button);
        vi.mocked(navigationService.popBackAction).mockReturnValue(true);

        dispatchNavigationMouse(
            navigationUI,
            new MouseEvent('mouseup', {
                button: 3,
                bubbles: true,
                cancelable: true,
            }),
            button,
        );

        expect(navigationService.popBackAction).toHaveBeenCalledTimes(1);
        expect(navigationService.goBack).not.toHaveBeenCalled();
    });

    it('should not navigate page history while a dialog is open and no back action exists', () => {
        navigationUI.init();
        const dialog = document.getElementById('app-selection-modal') as HTMLDialogElement;
        dialog.classList.remove('hidden');
        dialog.setAttribute('open', '');

        dispatchNavigationMouse(
            navigationUI,
            new MouseEvent('mouseup', {
                button: 3,
                bubbles: true,
                cancelable: true,
            }),
            dialog,
        );

        expect(navigationService.popBackAction).toHaveBeenCalledTimes(1);
        expect(navigationService.goBack).not.toHaveBeenCalled();
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
        const setCurrentPageMock = navigationService.setCurrentPage as ReturnType<typeof vi.fn>;
        expect(setCurrentPageMock.mock.invocationCallOrder[0]).toBeLessThan(
            emitSpy.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
        );
    });

    it('should support silent and buttonless navigation and warn on missing pages', async () => {
        await navigationUI.showPage('settings', null, true, true);
        expect(soundService.playToggle).not.toHaveBeenCalled();
        expect(navigationService.setCurrentPage).toHaveBeenCalledWith('settings', true);

        await navigationUI.showPage('missing');
        expect(navigationService.setCurrentPage).toHaveBeenCalledTimes(1);
    });
});
