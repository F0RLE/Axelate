import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowUI } from './WindowUI';
import type { WindowService } from '../services/WindowService';
import type { UISettingsService } from '../services/ui/UISettingsService';
import type { SoundService } from '../services/SoundService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

describe('WindowUI lifecycle', () => {
    let ui: WindowUI | null = null;
    let reloadSpy: ReturnType<typeof vi.fn>;
    let runtime: {
        addWindowListener: ReturnType<typeof vi.fn>;
        getScreen: ReturnType<typeof vi.fn>;
        getInnerSize: ReturnType<typeof vi.fn>;
        reload: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="splash-screen" class="hidden"></div>
            <dialog id="global-width-warning"></dialog>
            <button id="maximize-btn"></button>
            <div id="maximize-icon"><svg><use href="#icon-maximize"></use></svg></div>
            <button id="sound-toggle-btn"><svg><use href="#icon-volume"></use></svg></button>
        `;
        vi.clearAllMocks();
        reloadSpy = vi.fn();
        Object.defineProperty(globalThis, 'location', {
            configurable: true,
            value: { reload: reloadSpy },
        });
        const nativeAdd = globalThis.addEventListener.bind(globalThis);
        runtime = {
            addWindowListener: vi.fn((...args: Parameters<typeof globalThis.addEventListener>) => {
                nativeAdd(...args);
            }),
            getScreen: vi.fn(() => globalThis.screen),
            getInnerSize: vi.fn(() => ({
                width: globalThis.innerWidth,
                height: globalThis.innerHeight,
            })),
            reload: reloadSpy,
        };
    });

    afterEach(() => {
        ui?.destroy();
        ui = null;
        document.body.innerHTML = '';
    });

    function createWindowUI(): WindowUI {
        const service = {
            checkPolicy: vi.fn().mockResolvedValue({ isSmallScreen: false, showWarning: false }),
            setMonitoringPaused: vi.fn().mockResolvedValue(undefined),
            checkResolutionChange: vi.fn(),
            isMaximized: vi.fn().mockResolvedValue(false),
            toggleMaximize: vi.fn().mockResolvedValue(undefined),
            setSize: vi.fn().mockResolvedValue(undefined),
            changeZoom: vi.fn().mockResolvedValue(1),
            getZoom: vi.fn().mockReturnValue(1),
            getConfig: vi.fn().mockReturnValue(null),
        } as unknown as WindowService;

        const state = {
            getSoundEnabled: vi.fn().mockReturnValue(true),
            setSoundEnabled: vi.fn(),
        } as unknown as UISettingsService;

        const sound = {
            setEnabled: vi.fn(),
            isEnabled: vi.fn().mockReturnValue(true),
        } as unknown as SoundService;

        const i18n = {
            t: vi.fn((_: string, fallback: string = ''): string => fallback),
        } as unknown as I18nService;
        const tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService;

        return new WindowUI(
            service,
            state,
            sound,
            tracer,
            i18n,
            runtime as unknown as ConstructorParameters<typeof WindowUI>[5],
        );
    }

    it('should remove and restore contextmenu prevention across destroy and re-init', () => {
        ui = createWindowUI();
        ui.init();

        const firstEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        document.body.dispatchEvent(firstEvent);
        expect(firstEvent.defaultPrevented).toBe(true);

        ui.destroy();

        const secondEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        document.body.dispatchEvent(secondEvent);
        expect(secondEvent.defaultPrevented).toBe(false);

        ui.init();

        const thirdEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        document.body.dispatchEvent(thirdEvent);
        expect(thirdEvent.defaultPrevented).toBe(true);
    });

    it('should toggle sound state and update maximize/sound UI', () => {
        ui = createWindowUI();
        ui.init();

        ui.toggleSound();
        expect(
            (ui as unknown as { _sound: { setEnabled: ReturnType<typeof vi.fn> } })._sound
                .setEnabled,
        ).toHaveBeenCalledWith(false);
        expect(
            (ui as unknown as { _state: { setSoundEnabled: ReturnType<typeof vi.fn> } })._state
                .setSoundEnabled,
        ).toHaveBeenCalledWith(false);
        expect(document.getElementById('sound-toggle-btn')?.classList.contains('muted')).toBe(true);

        ui.updateMaximizeIcon(true);
        expect(document.body.classList.contains('maximized')).toBe(true);
        expect(document.getElementById('maximize-btn')?.getAttribute('aria-label')).toBe('Restore');
        expect(document.querySelector('#maximize-icon use')?.getAttribute('href')).toBe(
            '#icon-restore',
        );
    });

    it('should sync maximize state on init', async () => {
        const uiLocal = createWindowUI();
        ui = uiLocal;
        const service = (uiLocal as unknown as { _service: WindowService })._service as unknown as {
            isMaximized: ReturnType<typeof vi.fn>;
        };
        service.isMaximized.mockResolvedValue(true);

        uiLocal.init();
        await Promise.resolve();

        expect(document.body.classList.contains('maximized')).toBe(true);
        expect(document.getElementById('maximize-btn')?.getAttribute('aria-label')).toBe('Restore');
        expect(document.querySelector('#maximize-icon use')?.getAttribute('href')).toBe(
            '#icon-restore',
        );
    });

    it('should update maximize UI immediately after toggle', async () => {
        const uiLocal = createWindowUI();
        ui = uiLocal;
        const service = (uiLocal as unknown as { _service: WindowService })._service as unknown as {
            toggleMaximize: ReturnType<typeof vi.fn>;
            isMaximized: ReturnType<typeof vi.fn>;
        };
        service.isMaximized.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        uiLocal.init();
        await Promise.resolve();
        await uiLocal.toggleMaximize();

        expect(service.toggleMaximize).toHaveBeenCalledTimes(1);
        expect(document.body.classList.contains('maximized')).toBe(true);
        expect(document.getElementById('maximize-btn')?.getAttribute('aria-label')).toBe('Restore');
        expect(document.querySelector('#maximize-icon use')?.getAttribute('href')).toBe(
            '#icon-restore',
        );
    });

    it('should handle resize warnings, splash hiding and keyboard shortcuts', () => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <div id="splash-screen"></div>
            <dialog id="global-width-warning"></dialog>
            <button id="maximize-btn"></button>
            <div id="maximize-icon"></div>
            <button id="sound-toggle-btn"><svg><use href="#icon-volume"></use></svg></button>
            <div id="sidebar"></div>
            <div id="app-header"></div>
            <div id="main-area"></div>
        `;

        const uiLocal = createWindowUI();
        ui = uiLocal;
        const service = (
            uiLocal as unknown as {
                _service: ReturnType<typeof createWindowUI> extends infer _T
                    ? WindowService
                    : never;
            }
        )._service as unknown as {
            getConfig: ReturnType<typeof vi.fn>;
            toggleMaximize: ReturnType<typeof vi.fn>;
            changeZoom: ReturnType<typeof vi.fn>;
        };
        service.getConfig.mockReturnValue({
            thresholds: { warningWidth: 1500, warningHeight: 900 },
        });

        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1000 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 700 });
        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            value: 1000,
        });

        uiLocal.init();

        const dialog = document.getElementById('global-width-warning') as HTMLDialogElement;
        dialog.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
            Object.defineProperty(this, 'open', { configurable: true, value: true });
        });
        dialog.close = vi.fn(function close(this: HTMLDialogElement) {
            Object.defineProperty(this, 'open', { configurable: true, value: false });
        });

        document.getElementById('splash-screen')?.classList.add('hidden');
        (uiLocal as unknown as { _checkWidth: () => void })._checkWidth();
        expect(dialog.showModal).toHaveBeenCalled();
        expect(document.body.classList.contains('ui-hidden')).toBe(true);

        const maximizeEvent = new KeyboardEvent('keydown', {
            key: 'F11',
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(maximizeEvent);
        expect(service.toggleMaximize).toHaveBeenCalled();
        expect(maximizeEvent.defaultPrevented).toBe(true);

        uiLocal.hideSplashScreen();
        expect(document.getElementById('sidebar')?.classList.contains('visible')).toBe(true);
        vi.advanceTimersByTime(180);
        expect(document.getElementById('splash-screen')?.classList.contains('hidden')).toBe(true);
        expect(document.getElementById('sidebar')?.classList.contains('visible')).toBe(true);
    });

    it('should handle devtools, refresh, selection prevention and allowed context-menu branches', () => {
        document.body.innerHTML = `
            <div id="splash-screen" class="hidden"></div>
            <dialog id="global-width-warning"></dialog>
            <button id="maximize-btn" title="Maximize"></button>
            <div id="maximize-icon"></div>
            <button id="sound-toggle-btn"><svg><use href="#icon-volume"></use></svg></button>
            <div class="allow-context-menu"><span id="context-target">ok</span></div>
            <div id="plain-target">plain</div>
            <input id="editor-input" />
        `;

        ui = createWindowUI();
        ui.init();

        const devToolsEvent = new KeyboardEvent('keydown', {
            key: 'F12',
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(devToolsEvent);
        expect(devToolsEvent.defaultPrevented).toBe(true);

        const refreshEvent = new KeyboardEvent('keydown', {
            key: 'r',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(refreshEvent);
        expect(refreshEvent.defaultPrevented).toBe(true);
        expect(reloadSpy).toHaveBeenCalled();

        const blockedShortcut = new KeyboardEvent('keydown', {
            key: 'u',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(blockedShortcut);
        expect(blockedShortcut.defaultPrevented).toBe(true);

        const plainContext = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
        });
        document.getElementById('plain-target')?.dispatchEvent(plainContext);
        expect(plainContext.defaultPrevented).toBe(true);

        const allowedContext = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
        });
        document.getElementById('context-target')?.dispatchEvent(allowedContext);
        expect(allowedContext.defaultPrevented).toBe(false);

        const inputContext = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
        });
        document.getElementById('editor-input')?.dispatchEvent(inputContext);
        expect(inputContext.defaultPrevented).toBe(false);

        const selectionBlocked = new Event('selectstart', { bubbles: true, cancelable: true });
        document.getElementById('plain-target')?.dispatchEvent(selectionBlocked);
        expect(selectionBlocked.defaultPrevented).toBe(true);

        const selectionAllowed = new Event('selectstart', { bubbles: true, cancelable: true });
        document.getElementById('editor-input')?.dispatchEvent(selectionAllowed);
        expect(selectionAllowed.defaultPrevented).toBe(false);

        const dblClick = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            detail: 2,
        });
        document.getElementById('plain-target')?.dispatchEvent(dblClick);
        expect(dblClick.defaultPrevented).toBe(true);
    });

    it('should block window-level shortcuts while a dialog is open', () => {
        document.body.innerHTML = `
            <div id="splash-screen" class="hidden"></div>
            <dialog id="global-width-warning"></dialog>
            <dialog id="module-settings-modal" open></dialog>
            <button id="maximize-btn" title="Maximize"></button>
            <div id="maximize-icon"></div>
            <button id="sound-toggle-btn"><svg><use href="#icon-volume"></use></svg></button>
        `;

        ui = createWindowUI();
        ui.init();

        const service = (ui as unknown as { _service: WindowService })._service as unknown as {
            toggleMaximize: ReturnType<typeof vi.fn>;
        };

        const maximizeEvent = new KeyboardEvent('keydown', {
            key: 'F11',
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(maximizeEvent);
        expect(maximizeEvent.defaultPrevented).toBe(true);
        expect(service.toggleMaximize).not.toHaveBeenCalled();

        const refreshEvent = new KeyboardEvent('keydown', {
            key: 'r',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(refreshEvent);
        expect(refreshEvent.defaultPrevented).toBe(true);
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('should manage monitoring, wheel zoom, tooltip suppression and maximize icon rebuild', async () => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <div id="splash-screen" class="hidden"></div>
            <dialog id="global-width-warning"></dialog>
            <button id="maximize-btn" title="Maximize"></button>
            <div id="maximize-icon"></div>
            <button id="sound-toggle-btn"><svg><use href="#icon-volume"></use></svg></button>
            <div id="hover-target" title="Tooltip text"><span id="hover-child">child</span></div>
        `;

        ui = createWindowUI();
        const service = (ui as unknown as { _service: WindowService })._service as unknown as {
            setMonitoringPaused: ReturnType<typeof vi.fn>;
            changeZoom: ReturnType<typeof vi.fn>;
        };
        ui.init();

        const maximizeIcon = document.getElementById('maximize-icon') as HTMLElement;
        maximizeIcon.innerHTML = '';
        ui.updateMaximizeIcon(false);
        expect(maximizeIcon.querySelector('use')?.getAttribute('href')).toBe('#icon-maximize');

        const maximizeBtn = document.getElementById('maximize-btn') as HTMLElement;
        expect(maximizeBtn.getAttribute('title')).toBe('Maximize');
        expect(maximizeBtn.dataset['title']).toBe('Maximize');

        document
            .getElementById('hover-child')
            ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect((document.getElementById('hover-target') as HTMLElement).dataset['title']).toBe(
            'Tooltip text',
        );

        vi.advanceTimersByTime(2000);
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        document.dispatchEvent(new Event('visibilitychange'));
        globalThis.dispatchEvent(new Event('blur'));
        expect(service.setMonitoringPaused).toHaveBeenCalledWith(true);

        focusSpy.mockReturnValue(true);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        globalThis.dispatchEvent(new Event('focus'));
        expect(service.setMonitoringPaused).toHaveBeenCalledWith(false);

        document.dispatchEvent(
            new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                ctrlKey: true,
                deltaY: -100,
            }),
        );
        await Promise.resolve();
        vi.advanceTimersByTime(20);
        expect(service.changeZoom).toHaveBeenCalledWith(0.07);

        service.changeZoom.mockRejectedValueOnce(new Error('zoom failed'));
        document.dispatchEvent(
            new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                ctrlKey: true,
                deltaY: 100,
            }),
        );
        await Promise.resolve();
    });

    it('should cancel pending zoom width check on destroy', async () => {
        vi.useFakeTimers();
        ui = createWindowUI();
        ui.init();

        const checkWidthSpy = vi.spyOn(ui as unknown as { _checkWidth: () => void }, '_checkWidth');
        checkWidthSpy.mockClear();

        document.dispatchEvent(
            new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                ctrlKey: true,
                deltaY: -100,
            }),
        );
        await Promise.resolve();

        ui.destroy();
        vi.advanceTimersByTime(20);

        expect(checkWidthSpy).not.toHaveBeenCalled();
    });

    it('should ignore stale resize check results', async () => {
        let releasePolicy!: (value: { isSmallScreen: boolean }) => void;
        let releaseMaximized!: (value: boolean) => void;

        ui = createWindowUI();
        const service = (ui as unknown as { _service: WindowService })._service as unknown as {
            checkPolicy: ReturnType<typeof vi.fn>;
            isMaximized: ReturnType<typeof vi.fn>;
        };

        service.checkPolicy.mockImplementationOnce(
            () =>
                new Promise((resolve: (value: { isSmallScreen: boolean }) => void) => {
                    releasePolicy = resolve;
                }),
        );
        service.isMaximized.mockImplementationOnce(
            () =>
                new Promise((resolve: (value: boolean) => void) => {
                    releaseMaximized = resolve;
                }),
        );

        ui.init();
        const updateMaximizeIconSpy = vi.spyOn(
            ui as unknown as { updateMaximizeIcon: (isMaximized: boolean) => void },
            'updateMaximizeIcon',
        );
        updateMaximizeIconSpy.mockClear();

        (ui as unknown as { _resizeCheckVersion: number })._resizeCheckVersion = 1;
        const staleResizeCheck = (
            ui as unknown as { _performResizeCheck: (resizeCheckVersion: number) => Promise<void> }
        )._performResizeCheck(1);

        ui.destroy();
        releasePolicy({ isSmallScreen: true });
        releaseMaximized(true);
        await staleResizeCheck;

        expect(updateMaximizeIconSpy).toHaveBeenCalledTimes(1);
        expect(updateMaximizeIconSpy).toHaveBeenCalledWith(true);
    });

    it('should apply small-screen protection, resize safely and close warnings when size recovers', async () => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <div id="splash-screen" class="hidden"></div>
            <dialog id="global-width-warning"></dialog>
            <button id="maximize-btn"></button>
            <div id="maximize-icon"><svg><use href="#icon-maximize"></use></svg></div>
            <button id="sound-toggle-btn"><svg><use href="#icon-volume"></use></svg></button>
        `;

        const uiLocal = createWindowUI();
        ui = uiLocal;
        const service = (uiLocal as unknown as { _service: WindowService })._service as unknown as {
            checkPolicy: ReturnType<typeof vi.fn>;
            toggleMaximize: ReturnType<typeof vi.fn>;
            setSize: ReturnType<typeof vi.fn>;
            isMaximized: ReturnType<typeof vi.fn>;
            getConfig: ReturnType<typeof vi.fn>;
            checkResolutionChange: ReturnType<typeof vi.fn>;
        };
        service.checkPolicy.mockResolvedValue({ isSmallScreen: true });
        service.getConfig.mockReturnValue({
            thresholds: { warningWidth: 1500, warningHeight: 900 },
        });
        service.isMaximized.mockResolvedValue(false);

        const dialog = document.getElementById('global-width-warning') as HTMLDialogElement;
        dialog.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
            Object.defineProperty(this, 'open', { configurable: true, value: true });
        });
        dialog.close = vi.fn(function close(this: HTMLDialogElement) {
            Object.defineProperty(this, 'open', { configurable: true, value: false });
        });

        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1000 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 700 });
        Object.defineProperty(globalThis, 'screen', {
            configurable: true,
            value: { availWidth: 1920, availHeight: 1080, width: 1920, height: 1080 },
        });

        uiLocal.init();
        await vi.runAllTimersAsync();
        expect(service.toggleMaximize).toHaveBeenCalled();
        (
            uiLocal as unknown as {
                _isSmallScreen: boolean;
                _wasMaximizedOnSmallScreen: boolean;
            }
        )._isSmallScreen = true;
        (
            uiLocal as unknown as {
                _isSmallScreen: boolean;
                _wasMaximizedOnSmallScreen: boolean;
            }
        )._wasMaximizedOnSmallScreen = true;

        globalThis.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(250);
        expect(dialog.open).toBe(true);
        expect(service.checkResolutionChange).toHaveBeenCalled();
        await (
            uiLocal as unknown as {
                _handleSmallScreenUnmaximize: (isMaximized: boolean) => Promise<void>;
            }
        )._handleSmallScreenUnmaximize(false);
        expect(service.setSize).toHaveBeenCalled();

        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 2000 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 1200 });
        (uiLocal as unknown as { _checkWidth: () => void })._checkWidth();
        expect(dialog.close).toHaveBeenCalled();

        service.isMaximized.mockRejectedValueOnce(new Error('policy failed'));
        await (
            uiLocal as unknown as { _performResizeCheck: () => Promise<void> }
        )._performResizeCheck();
    });

    it('should account for css zoom when checking warnings', () => {
        document.body.innerHTML = `
            <div id="splash-screen" class="hidden"></div>
            <dialog id="global-width-warning"></dialog>
            <button id="maximize-btn"></button>
            <div id="maximize-icon"><svg><use href="#icon-maximize"></use></svg></div>
            <button id="sound-toggle-btn"><svg><use href="#icon-volume"></use></svg></button>
        `;

        runtime.getInnerSize.mockReturnValue({ width: 900, height: 700 });

        const uiLocal = createWindowUI();
        ui = uiLocal;
        const service = (uiLocal as unknown as { _service: WindowService })._service as unknown as {
            getConfig: ReturnType<typeof vi.fn>;
            getZoom: ReturnType<typeof vi.fn>;
        };
        service.getConfig.mockReturnValue({
            thresholds: { warningWidth: 800, warningHeight: 600 },
        });
        service.getZoom.mockReturnValue(2);

        const dialog = document.getElementById('global-width-warning') as HTMLDialogElement;
        dialog.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
            Object.defineProperty(this, 'open', { configurable: true, value: true });
        });
        dialog.close = vi.fn(function close(this: HTMLDialogElement) {
            Object.defineProperty(this, 'open', { configurable: true, value: false });
        });

        uiLocal.init();

        expect(dialog.showModal).toHaveBeenCalled();
    });

    it('should not toggle maximize on small-screen init if window is already maximized', async () => {
        const uiLocal = createWindowUI();
        ui = uiLocal;
        const service = (uiLocal as unknown as { _service: WindowService })._service as unknown as {
            checkPolicy: ReturnType<typeof vi.fn>;
            isMaximized: ReturnType<typeof vi.fn>;
            toggleMaximize: ReturnType<typeof vi.fn>;
        };

        service.checkPolicy.mockResolvedValue({ isSmallScreen: true });
        service.isMaximized.mockResolvedValue(true);

        uiLocal.init();
        await Promise.resolve();
        await Promise.resolve();

        expect(service.toggleMaximize).not.toHaveBeenCalled();
    });
});
