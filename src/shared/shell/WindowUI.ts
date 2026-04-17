/**
 * @module core/ui/WindowUI
 * @description Manages window-related UI events, shortcuts, and screen protection
 */

import { type WindowService } from '../services/WindowService';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { type UISettingsService } from '../services/ui/UISettingsService';
import { type SoundService } from '../services/SoundService';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { WindowViewportController } from './WindowViewportController';
import { type IWindowViewportState } from './WindowViewportController';

type TimeoutField =
    | '_monitoringTimeout'
    | '_splashTimeout'
    | '_gracePeriodTimeout'
    | '_zoomCheckTimeout';

const DEVTOOLS_SHORTCUT_KEYS = ['I', 'J', 'C'] as const;
const RELOAD_SHORTCUT_KEYS = ['r', 'R', 'к', 'К'] as const;
const BLOCKED_CTRL_KEYS = ['u', 'p', 's', 'f', 'g'] as const;

export class WindowUI {
    private _initialized = false;
    private _isSmallScreen = false;
    private _wasMaximizedOnSmallScreen = false;
    private _resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    private _resizeCheckVersion = 0;
    private _cleanupAbort: AbortController | null = null;

    private _splash: HTMLElement | null = null;
    private _globalWarning: HTMLDialogElement | null = null;
    private _maximizeIcon: HTMLElement | null = null;
    private _soundToggle: HTMLElement | null = null;
    private _monitoringTimeout: ReturnType<typeof setTimeout> | null = null;
    private _splashTimeout: ReturnType<typeof setTimeout> | null = null;
    private _gracePeriodTimeout: ReturnType<typeof setTimeout> | null = null;
    private _zoomCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    private _isInGracePeriod = true;
    private readonly _viewportController: WindowViewportController;
    private readonly _viewportState: IWindowViewportState;
    private readonly _boundHandleResize = () => {
        this._handleResize();
    };

    constructor(
        private readonly _service: WindowService,
        private readonly _state: UISettingsService,
        private readonly _sound: SoundService,
    ) {
        this._viewportController = new WindowViewportController(_service);
        this._viewportState = this._createViewportState();
    }

    /**
     * Initializes window event listeners and screen protection.
     * @sideeffect Adds listeners to window and document
     */
    public init(): void {
        if (this._initialized) return;
        this._initialized = true;
        this._cleanupAbort = new AbortController();
        this._cacheElements();
        this._bindGlobalEvents();
        this._suppressNativeTooltips();

        this._applySmallScreenProtection().catch((err: unknown) => {
            tracer.warn('[WindowUI] Failed to apply small screen protection:', err);
        });

        this._checkWidth();
        this._initSoundState();
        this._gracePeriodTimeout = setTimeout(() => {
            this._isInGracePeriod = false;
        }, 2000);
    }

    /**
     * Caches frequently accessed DOM elements to prevent thrashing.
     */
    private _cacheElements(): void {
        this._splash = document.getElementById('splash-screen');
        this._globalWarning = document.getElementById(
            'global-width-warning',
        ) as HTMLDialogElement | null;
        this._maximizeIcon = document.getElementById('maximize-icon');
        this._soundToggle = document.getElementById('sound-toggle-btn');
    }

    /**
     * Cleans up all event listeners and timeouts.
     */
    public destroy(): void {
        this._cleanupAbort?.abort();
        this._cleanupAbort = null;

        if (this._resizeTimeout !== undefined) {
            clearTimeout(this._resizeTimeout);
        }

        this._clearTimeoutField('_monitoringTimeout');
        this._clearTimeoutField('_splashTimeout');
        this._clearTimeoutField('_gracePeriodTimeout');
        this._clearTimeoutField('_zoomCheckTimeout');

        this._resizeTimeout = undefined;
        this._resizeCheckVersion += 1;
        this._initialized = false;
        this._isSmallScreen = false;
        this._wasMaximizedOnSmallScreen = false;
        this._isInGracePeriod = true;
        this._splash = null;
        this._globalWarning = null;
        this._maximizeIcon = null;
        this._soundToggle = null;
    }

    /**
     * Binds global window and document events.
     * @sideeffect Pollutes global namespace with listeners
     */
    private _bindGlobalEvents(): void {
        const signal = this._cleanupAbort?.signal;
        if (signal === undefined) return;

        document.addEventListener(
            'contextmenu',
            (e) => {
                const target = e.target as HTMLElement;
                if (this._shouldAllowContextMenu(target)) {
                    return;
                }
                e.preventDefault();
            },
            { capture: true, signal },
        );

        const updateMonitoring = (): void => {
            const shouldPause = !this._isInGracePeriod && (document.hidden || !document.hasFocus());
            void this._service.setMonitoringPaused(shouldPause);
        };
        document.addEventListener('visibilitychange', updateMonitoring, { signal });
        globalThis.addEventListener('blur', updateMonitoring, { signal });
        globalThis.addEventListener('focus', updateMonitoring, { signal });
        this._monitoringTimeout = setTimeout(updateMonitoring, 1000);

        document.addEventListener(
            'keydown',
            (e) => {
                this._handleKeydown(e);
            },
            {
                capture: true,
                signal,
            },
        );

        document.addEventListener(
            'wheel',
            (e: Event) => {
                const ev = e as WheelEvent;
                if (ev.ctrlKey) {
                    ev.preventDefault();
                    const delta = ev.deltaY < 0 ? 0.1 : -0.1;
                    this._service
                        .changeZoom(delta)
                        .then(() => {
                            this._scheduleZoomWidthCheck();
                        })
                        .catch(() => {
                            /* ignore */
                        });
                }
            },
            { passive: false, signal },
        );

        this._bindSelectionPrevention(signal);
        globalThis.addEventListener('resize', this._boundHandleResize, { signal });
    }

    private _scheduleZoomWidthCheck(): void {
        this._clearTimeoutField('_zoomCheckTimeout');
        this._zoomCheckTimeout = setTimeout(() => {
            this._zoomCheckTimeout = null;
            if (!this._initialized) return;
            this._checkWidth();
        }, 50);
    }

    /**
     * Handles window resize events with debouncing.
     */
    private _handleResize(): void {
        this._checkWidth();
        this._service.checkResolutionChange();

        if (this._resizeTimeout !== undefined) {
            clearTimeout(this._resizeTimeout);
        }
        const resizeCheckVersion = ++this._resizeCheckVersion;
        this._resizeTimeout = setTimeout(() => {
            void this._performResizeCheck(resizeCheckVersion);
        }, 200);
    }

    /**
     * Performs a check on maximization state and window policy after resize.
     */
    private async _performResizeCheck(resizeCheckVersion: number): Promise<void> {
        try {
            await this._viewportController.syncAfterResize(
                this._viewportState,
                () => this._initialized && resizeCheckVersion === this._resizeCheckVersion,
                (isMaximized) => {
                    this.updateMaximizeIcon(isMaximized);
                },
                async (isMaximized, isSmallScreen) => {
                    this._isSmallScreen = isSmallScreen;
                    await this._handleSmallScreenUnmaximize(isMaximized);
                },
            );
        } catch (e) {
            tracer.warn('[WindowUI] Resize check failed:', e);
        }
    }

    /**
     * Handles global keydown events (shortcuts, devtools blocking).
     * @sideeffect Intercepts keyboard events and blocks window shortcuts
     */
    private _handleKeydown(e: KeyboardEvent): void {
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && DEVTOOLS_SHORTCUT_KEYS.includes(e.key.toUpperCase() as never))
        ) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (this._hasOpenDialog() && this._isWindowShortcut(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (e.key === 'F11') {
            e.preventDefault();
            this._service.toggleMaximize().catch(() => {
                /* ignore */
            });
            return;
        }

        if (this._isReloadShortcut(e)) {
            e.preventDefault();
            globalThis.location.reload();
            return;
        }

        if (e.ctrlKey && BLOCKED_CTRL_KEYS.includes(e.key.toLowerCase() as never)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private _shouldAllowContextMenu(target: HTMLElement | null): boolean {
        if (!(target instanceof Element)) return false;

        if (target.closest('.allow-context-menu')) return true;

        return (
            target.closest(
                'input, textarea, select, option, [contenteditable="true"], [role="textbox"]',
            ) !== null
        );
    }

    private _hasOpenDialog(): boolean {
        return document.querySelector('dialog[open]:not(.hidden)') !== null;
    }

    private _isWindowShortcut(e: KeyboardEvent): boolean {
        if (e.key === 'F11' || e.key === 'F5') return true;
        if (this._isReloadShortcut(e)) return true;
        return e.ctrlKey && BLOCKED_CTRL_KEYS.includes(e.key.toLowerCase() as never);
    }

    private _isReloadShortcut(e: KeyboardEvent): boolean {
        return e.key === 'F5' || (e.ctrlKey && RELOAD_SHORTCUT_KEYS.includes(e.key as never));
    }

    /**
     * Prevents text selection in UI elements except where allowed.
     */
    private _bindSelectionPrevention(signal: AbortSignal): void {
        const allowedSelectors =
            'input, textarea, .console-logs-area, [contenteditable], .chat-bubble, .selectable';

        document.addEventListener(
            'selectstart',
            (e: Event) => {
                const target = e.target as HTMLElement;
                if (target instanceof Element && target.closest(allowedSelectors)) {
                    return;
                }
                e.preventDefault();
            },
            { signal },
        );

        document.addEventListener(
            'mousedown',
            (e: Event) => {
                const ev = e as MouseEvent;
                const target = ev.target as HTMLElement;
                if (target instanceof Element && target.closest(allowedSelectors)) {
                    return;
                }
                if (ev.detail > 1) {
                    ev.preventDefault();
                }
            },
            { signal },
        );
    }

    /**
     * Hides native tooltips and stores them in data attributes.
     */
    private _suppressNativeTooltips(): void {
        const signal = this._cleanupAbort?.signal;
        if (signal === undefined) return;

        const handler = (): void => {
            this._moveTitlesToDataset(document.querySelectorAll('[title]'));
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', handler, { signal });
        } else {
            handler();
        }

        document.addEventListener(
            'mouseover',
            (e: Event) => {
                let target = e.target as HTMLElement | null;
                while (target && target !== document.body) {
                    this._moveTitleToDataset(target);
                    target = target.parentElement;
                }
            },
            { passive: true, signal },
        );
    }

    /**
     * Detects and applies adjustments for small screens (zoom, maximization).
     */
    private async _applySmallScreenProtection(): Promise<void> {
        await this._viewportController.applyInitialProtection(this._viewportState);
    }

    /**
     * Handles unmaximizing on small screens by resizing to a safe area.
     * @sideeffect Changes window size
     */
    private async _handleSmallScreenUnmaximize(isMaximized: boolean): Promise<void> {
        await this._viewportController.handleSmallScreenUnmaximize(
            this._viewportState,
            isMaximized,
        );
    }

    /**
     * Updates the maximize/restore icon in the title bar.
     * @sideeffect Modifies the DOM safely
     */
    public updateMaximizeIcon(isMaximized: boolean): void {
        this._viewportController.updateMaximizeIcon(this._maximizeIcon, isMaximized);
    }

    /**
     * Toggles the global sound state and updates the UI.
     * @sideeffect Modifies SoundService and DOM
     */
    public toggleSound(): void {
        const newState = !this._sound.isEnabled();
        this._sound.setEnabled(newState);
        this._state.setSoundEnabled(newState);
        this.updateSoundUI(newState);
    }

    /**
     * Initializes the sound state from persistence.
     */
    private _initSoundState(): void {
        const isEnabled = this._state.getSoundEnabled();
        this._sound.setEnabled(isEnabled);
        this.updateSoundUI(isEnabled);
    }

    /**
     * Updates the sound toggle button icon and style.
     */
    public updateSoundUI(enabled: boolean): void {
        if (!this._soundToggle) return;

        const use = this._soundToggle.querySelector('use');
        if (use !== null) {
            use.setAttribute('href', enabled ? '#icon-volume' : '#icon-volume-x');
        }

        this._soundToggle.classList.toggle('muted', !enabled);
    }

    /**
     * Checks current window width and displays warnings if too small.
     * @sideeffect Shows/hides warning overlays in the DOM
     */
    private _checkWidth(): void {
        const computedStyle = getComputedStyle(document.documentElement) as CSSStyleDeclaration & {
            zoom?: string;
        };
        const zoom = Number.parseFloat(computedStyle.zoom || '1') || 1;

        const win = getGlobalWin();
        const width = win.innerWidth / zoom;
        const height = win.innerHeight / zoom;

        const config = this._service.getConfig();
        const minWidth = config?.thresholds.warningWidth ?? 0;
        const minHeight = config?.thresholds.warningHeight ?? 0;

        const showWarning = width < minWidth || height < minHeight;
        const isDuringSplash = this._splash !== null && !this._splash.classList.contains('hidden');

        if (this._globalWarning === null) {
            return;
        }

        if (showWarning && !isDuringSplash) {
            this._showGlobalWarning();
        } else {
            this._hideGlobalWarning();
        }
    }

    /**
     * Hides the splash screen and reveals the main UI.
     * @sideeffect Modifies body overflow and visibility of major layout blocks
     */
    public hideSplashScreen(): void {
        if (this._splash !== null) {
            this._splash.classList.add('fade-out');
            this._clearTimeoutField('_splashTimeout');

            this._splashTimeout = setTimeout(() => {
                if (this._splash !== null) {
                    this._splash.classList.remove('fade-out');
                    this._splash.classList.add('hidden');
                }
                document.body.classList.remove('no-overflow');
                this._splashTimeout = null;
                this._checkWidth();
            }, 400);
        }

        this._showLayoutSections(['sidebar', 'app-header', 'main-area']);
    }

    private _moveTitlesToDataset(elements: NodeListOf<Element>): void {
        elements.forEach((element) => {
            this._moveTitleToDataset(element);
        });
    }

    private _moveTitleToDataset(element: Element): void {
        if (!(element instanceof HTMLElement)) {
            return;
        }

        const title = element.title;
        if (title === '') {
            return;
        }

        element.dataset['title'] = title;
        element.removeAttribute('title');
    }

    private _showGlobalWarning(): void {
        if (this._globalWarning === null || this._globalWarning.open) {
            return;
        }

        this._globalWarning.showModal();
        document.body.classList.add('ui-hidden');
    }

    private _hideGlobalWarning(): void {
        if (this._globalWarning?.open !== true) {
            return;
        }

        this._globalWarning.close();
        document.body.classList.remove('ui-hidden');
    }

    private _showLayoutSections(ids: string[]): void {
        ids.forEach((id) => {
            const element = document.getElementById(id);
            if (element instanceof HTMLElement) {
                element.classList.add('visible');
            }
        });
    }

    private _createViewportState(): IWindowViewportState {
        const self = this;
        return {
            get isSmallScreen() {
                return self._isSmallScreen;
            },
            set isSmallScreen(value: boolean) {
                self._isSmallScreen = value;
            },
            get wasMaximizedOnSmallScreen() {
                return self._wasMaximizedOnSmallScreen;
            },
            set wasMaximizedOnSmallScreen(value: boolean) {
                self._wasMaximizedOnSmallScreen = value;
            },
            get maximizeIcon() {
                return self._maximizeIcon;
            },
            set maximizeIcon(value: HTMLElement | null) {
                self._maximizeIcon = value;
            },
        };
    }

    private _clearTimeoutField(field: TimeoutField): void {
        const timeout = this[field];
        if (timeout !== null) {
            clearTimeout(timeout);
            this[field] = null;
        }
    }
}
