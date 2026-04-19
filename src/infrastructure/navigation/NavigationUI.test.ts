import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationUI } from './NavigationUI';
import type { NavigationService } from './NavigationService';
import type { SoundService } from '@/shared/services/SoundService';
import { EventBus } from '@/shared/services/EventBus';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

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
    if (event.type === 'mouseup') {
        (
            navigationUI as unknown as {
                _mouseUpHandler: ((e: MouseEvent) => void) | null;
            }
        )._mouseUpHandler?.(event);
        return;
    }

    (
        navigationUI as unknown as {
            _mouseDownHandler: ((e: MouseEvent) => void) | null;
        }
    )._mouseDownHandler?.(event);
}

function dispatchNativeSuppressionMouse(
    navigationUI: NavigationUI,
    handler: '_mouseUpHandler' | '_auxClickHandler',
    event: MouseEvent,
    target: EventTarget,
): void {
    dispatchWindowEventWithTarget(event, target);
    (navigationUI as unknown as Record<typeof handler, ((e: MouseEvent) => void) | null>)[
        handler
    ]?.(event);
}

describe('NavigationUI', () => {
    let navigationService: NavigationService;
    let soundService: SoundService;
    let navigationUI: NavigationUI;
    let testEventBus: EventBus;
    let tracer: LoggerService;
    let runtime: {
        addWindowListener: ReturnType<typeof vi.fn>;
        removeWindowListener: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        setupDOM();
        testEventBus = new EventBus();

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

        tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService;

        const nativeAdd = globalThis.addEventListener.bind(globalThis);
        const nativeRemove = globalThis.removeEventListener.bind(globalThis);
        runtime = {
            addWindowListener: vi.fn((...args: Parameters<typeof globalThis.addEventListener>) => {
                nativeAdd(...args);
            }),
            removeWindowListener: vi.fn(
                (...args: Parameters<typeof globalThis.removeEventListener>) => {
                    nativeRemove(...args);
                },
            ),
        };

        navigationUI = new NavigationUI(
            navigationService,
            testEventBus,
            tracer,
            soundService,
            runtime as unknown as ConstructorParameters<typeof NavigationUI>[4],
        );
    });

    it('should be idempotent across repeated init calls', () => {
        navigationUI.init();
        navigationUI.init();

        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 3 }));

        expect(navigationService.goBack).toHaveBeenCalledTimes(1);
    });

    it('should remove global listeners on destroy', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();

        navigationUI.init();
        navigationUI.destroy();

        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 3 }));
        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 3 }));
        globalThis.dispatchEvent(new MouseEvent('auxclick', { button: 3 }));
        globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(showPageSpy).not.toHaveBeenCalled();
        expect(navigationService.goBack).not.toHaveBeenCalled();
        expect(navigationService.popBackAction).not.toHaveBeenCalled();
    });

    it('should navigate on side-button mousedown before WebView native navigation can run', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        navigationUI.init();
        const button = document.createElement('button');
        document.body.appendChild(button);

        const mouseDown = new MouseEvent('mousedown', {
            button: 3,
            bubbles: true,
            cancelable: true,
        });

        dispatchNavigationMouse(navigationUI, mouseDown, button);

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(navigationService.goBack).toHaveBeenCalledTimes(1);
        expect(showPageSpy).toHaveBeenCalledWith('home', null, false, true);
    });

    it('should suppress duplicate side-button mouseup and auxclick without executing app navigation', () => {
        navigationUI.init();
        const button = document.createElement('button');
        document.body.appendChild(button);

        dispatchNavigationMouse(
            navigationUI,
            new MouseEvent('mousedown', {
                button: 3,
                bubbles: true,
                cancelable: true,
            }),
            button,
        );

        const mouseUp = new MouseEvent('mouseup', {
            button: 3,
            bubbles: true,
            cancelable: true,
        });
        const auxClick = new MouseEvent('auxclick', {
            button: 4,
            bubbles: true,
            cancelable: true,
        });

        dispatchNativeSuppressionMouse(navigationUI, '_mouseUpHandler', mouseUp, button);
        dispatchNativeSuppressionMouse(navigationUI, '_auxClickHandler', auxClick, button);

        expect(mouseUp.defaultPrevented).toBe(true);
        expect(auxClick.defaultPrevented).toBe(true);
        expect(navigationService.goBack).toHaveBeenCalledTimes(1);
        expect(navigationService.goForward).not.toHaveBeenCalled();
        expect(navigationService.popBackAction).toHaveBeenCalledTimes(1);
        expect(navigationService.popForwardAction).not.toHaveBeenCalled();
    });

    it('should handle side-button mouseup when mousedown is not delivered', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        navigationUI.init();
        const button = document.createElement('button');
        document.body.appendChild(button);

        const mouseUp = new MouseEvent('mouseup', {
            button: 3,
            bubbles: true,
            cancelable: true,
        });

        dispatchNavigationMouse(navigationUI, mouseUp, button);

        expect(mouseUp.defaultPrevented).toBe(true);
        expect(navigationService.goBack).toHaveBeenCalledTimes(1);
        expect(showPageSpy).toHaveBeenCalledWith('home', null, false, true);
    });

    it('should not treat side-button events from different targets as duplicates', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        navigationUI.init();
        const firstButton = document.createElement('button');
        const secondButton = document.createElement('button');
        document.body.appendChild(firstButton);
        document.body.appendChild(secondButton);

        dispatchNavigationMouse(
            navigationUI,
            new MouseEvent('mousedown', {
                button: 3,
                bubbles: true,
                cancelable: true,
            }),
            firstButton,
        );

        const mouseUp = new MouseEvent('mouseup', {
            button: 3,
            bubbles: true,
            cancelable: true,
        });
        dispatchNavigationMouse(navigationUI, mouseUp, secondButton);

        expect(mouseUp.defaultPrevented).toBe(true);
        expect(navigationService.goBack).toHaveBeenCalledTimes(2);
        expect(showPageSpy).toHaveBeenNthCalledWith(1, 'home', null, false, true);
        expect(showPageSpy).toHaveBeenNthCalledWith(2, 'home', null, false, true);
    });

    it('should allow re-init after destroy without duplicating listeners', () => {
        navigationUI.init();
        navigationUI.destroy();
        navigationUI.init();

        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 3 }));

        expect(navigationService.goBack).toHaveBeenCalledTimes(1);
    });

    it('should handle back, forward and escape navigation branches', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        navigationUI.init();

        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 3 }));
        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 4 }));

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

        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 3, ctrlKey: true }));
        globalThis.dispatchEvent(new MouseEvent('mousedown', { button: 4, shiftKey: true }));

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

    it('should use side-button back actions from editable controls', () => {
        navigationUI.init();
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        vi.mocked(navigationService.popBackAction).mockReturnValue(true);

        const event = new MouseEvent('mouseup', {
            button: 3,
            bubbles: true,
            cancelable: true,
        });
        dispatchNavigationMouse(navigationUI, event, textarea);

        expect(navigationService.popBackAction).toHaveBeenCalledTimes(1);
        expect(navigationService.goBack).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
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
            new MouseEvent('mousedown', {
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
            new MouseEvent('mousedown', {
                button: 3,
                bubbles: true,
                cancelable: true,
            }),
            dialog,
        );

        expect(navigationService.popBackAction).toHaveBeenCalledTimes(1);
        expect(navigationService.goBack).not.toHaveBeenCalled();
    });

    it('should prefer page forward history before reopening modal forward actions', () => {
        const showPageSpy = vi.spyOn(navigationUI, 'showPage').mockResolvedValue();
        vi.mocked(navigationService.goForward)
            .mockReturnValueOnce('modules')
            .mockReturnValueOnce(undefined);
        vi.mocked(navigationService.popForwardAction).mockReturnValue(true);

        navigationUI.init();
        const button = document.createElement('button');
        document.body.appendChild(button);

        dispatchNavigationMouse(
            navigationUI,
            new MouseEvent('mousedown', {
                button: 4,
                bubbles: true,
                cancelable: true,
            }),
            button,
        );

        expect(showPageSpy).toHaveBeenCalledWith('modules', null, false, true);
        expect(navigationService.popForwardAction).not.toHaveBeenCalled();

        dispatchNavigationMouse(
            navigationUI,
            new MouseEvent('mousedown', {
                button: 4,
                bubbles: true,
                cancelable: true,
            }),
            button,
        );

        expect(navigationService.popForwardAction).toHaveBeenCalledTimes(1);
    });

    it('should show target page, emit navigation payload and update active sidebar state', async () => {
        const emitSpy = vi.spyOn(testEventBus, 'emit');
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
