/**
 * @module core/ui/WindowUI
 * @description Manages window-related UI events, shortcuts, and screen protection
 */

import { type WindowService } from '../services/WindowService';
import { type UISettingsService } from '../services/ui/UISettingsService';
import { type SoundService } from '../services/SoundService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { WindowViewportController } from './WindowViewportController';
import { type IWindowViewportState } from './WindowViewportController';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import { WindowUiInteractionController } from './WindowUiInteractionController';
import { WindowUiShellController } from './WindowUiShellController';
import { WindowUiTimingController } from './WindowUiTimingController';

type WindowUIRuntime = {
    addWindowListener: typeof globalThis.addEventListener;
    getScreen: () => Screen;
    getInnerSize: () => { width: number; height: number };
    reload: () => void;
};

function createDefaultWindowUIRuntime(): WindowUIRuntime {
    return {
        addWindowListener: globalThis.addEventListener.bind(globalThis),
        getScreen: () => globalThis.screen,
        getInnerSize: () => ({
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
        }),
        reload: () => {
            globalThis.location.reload();
        },
    };
}

export class WindowUI {
    private _initialized = false;
    private _isSmallScreen = false;
    private _wasMaximizedOnSmallScreen = false;
    private _resizeCheckVersion = 0;
    private _cleanupAbort: AbortController | null = null;

    private _splash: HTMLElement | null = null;
    private _globalWarning: HTMLDialogElement | null = null;
    private _maximizeIcon: HTMLElement | null = null;
    private _soundToggle: HTMLElement | null = null;
    private _isInGracePeriod = true;
    private readonly _interactionController: WindowUiInteractionController;
    private readonly _shellController: WindowUiShellController;
    private readonly _timingController = new WindowUiTimingController();
    private readonly _viewportController: WindowViewportController;
    private readonly _viewportState: IWindowViewportState;
    private readonly _boundHandleResize = () => {
        this._handleResize();
    };

    constructor(
        private readonly _service: WindowService,
        private readonly _state: UISettingsService,
        private readonly _sound: SoundService,
        private readonly _tracer: LoggerService,
        i18n: I18nService,
        private readonly _runtime: WindowUIRuntime = createDefaultWindowUIRuntime(),
    ) {
        this._interactionController = new WindowUiInteractionController({
            runtime: _runtime,
            toggleMaximize: async () => {
                await this.toggleMaximize();
            },
            changeZoom: async (delta) => {
                await this._service.changeZoom(delta);
            },
            setMonitoringPaused: async (paused) => {
                await this._service.setMonitoringPaused(paused);
            },
            hasOpenDialog: () => this._hasOpenDialog(),
            isInGracePeriod: () => this._isInGracePeriod,
            onZoomChanged: () => this._scheduleZoomWidthCheck(),
            onResize: () => this._boundHandleResize(),
        });
        this._shellController = new WindowUiShellController({
            getElements: () => ({
                splash: this._splash,
                globalWarning: this._globalWarning,
                soundToggle: this._soundToggle,
            }),
        });
        this._viewportController = new WindowViewportController(_service, i18n.t.bind(i18n), () =>
            this._runtime.getScreen(),
        );
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
            this._tracer.warn('[WindowUI] Failed to apply small screen protection:', err);
        });
        void this._syncMaximizeState();

        this._checkWidth();
        this._initSoundState();
        this._timingController.scheduleGracePeriod(() => {
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
        this._timingController.clearAll();
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

        this._timingController.setMonitoringTimeout(this._interactionController.bind(signal));
    }

    private _scheduleZoomWidthCheck(): void {
        this._timingController.scheduleZoomCheck(() => {
            if (!this._initialized) return;
            this._checkWidth();
        }, 50);
    }

    /**
     * Handles window resize events with debouncing.
     */
    private _handleResize(): void {
        this._service.checkResolutionChange();
        const resizeCheckVersion = ++this._resizeCheckVersion;
        this._timingController.scheduleResize(() => {
            if (!this._initialized) {
                return;
            }
            this._checkWidth();
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
            this._tracer.warn('[WindowUI] Resize check failed:', e);
        }
    }

    private _hasOpenDialog(): boolean {
        return document.querySelector('dialog[open]:not(.hidden)') !== null;
    }

    /**
     * Hides native tooltips and stores them in data attributes.
     */
    private _suppressNativeTooltips(): void {
        const signal = this._cleanupAbort?.signal;
        if (signal === undefined) return;
        this._shellController.suppressNativeTooltips(signal);
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

    public async toggleMaximize(): Promise<void> {
        await this._service.toggleMaximize();
        await this._syncMaximizeState();
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
        this._shellController.updateSoundUi(enabled);
    }

    /**
     * Checks current window width and displays warnings if too small.
     * @sideeffect Shows/hides warning overlays in the DOM
     */
    private _checkWidth(): void {
        const viewport = this._runtime.getInnerSize();
        const config = this._service.getConfig();
        const minWidth = config?.thresholds.warningWidth ?? 0;
        const minHeight = config?.thresholds.warningHeight ?? 0;
        const zoom = this._service.getZoom();
        const effectiveZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

        this._shellController.updateWidthWarning({
            width: viewport.width / effectiveZoom,
            height: viewport.height / effectiveZoom,
            minWidth,
            minHeight,
        });
    }

    /**
     * Hides the splash screen and reveals the main UI.
     * @sideeffect Modifies body overflow and visibility of major layout blocks
     */
    public hideSplashScreen(): void {
        this._timingController.clearSplash();
        this._shellController.hideSplashScreen((callback, delayMs) => {
            this._timingController.scheduleSplash(() => {
                callback();
                this._checkWidth();
            }, delayMs);
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

    private async _syncMaximizeState(): Promise<void> {
        try {
            const isMaximized = await this._service.isMaximized();
            this.updateMaximizeIcon(isMaximized);
        } catch (error) {
            this._tracer.warn('[WindowUI] Failed to sync maximize state:', error);
        }
    }
}
