/**
 * @module core/ui/WindowUI
 * @description Manages window-related UI events, shortcuts, and screen protection
 */

import { type WindowService } from '../services/WindowService';
import type { TGlobalWin } from '../types/global_bridge_types';
import { type StateService } from '../services/StateService';
import { type SoundService } from '../services/SoundService';
import { logger } from '@/infrastructure/logging/LoggerService';

// IWindowUIGlobal removed

export class WindowUI {
    private _initialized = false;
    private _isSmallScreen = false;
    private _wasMaximizedOnSmallScreen = false;
    private _resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    private readonly _cleanupAbort: AbortController = new AbortController();

    private _splash: HTMLElement | null = null;
    private _modulesWarning: HTMLElement | null = null;
    private _settingsWarning: HTMLElement | null = null;
    private _maximizeIcon: HTMLElement | null = null;
    private _soundToggle: HTMLElement | null = null;
    private _monitoringTimeout: ReturnType<typeof setTimeout> | null = null;
    private _splashTimeout: ReturnType<typeof setTimeout> | null = null;
    private _gracePeriodTimeout: ReturnType<typeof setTimeout> | null = null;
    private _isInGracePeriod = true;

    constructor(
        private readonly _service: WindowService,
        private readonly _state: StateService,
        private readonly _sound: SoundService,
    ) {}

    /**
     * Initializes window event listeners and screen protection.
     * @sideeffect Adds listeners to window and document
     */
    public init(): void {
        if (this._initialized) return;
        this._initialized = true;
        this._cacheElements();
        this._bindGlobalEvents();
        this._suppressNativeTooltips();

        // Fire and forget
        this._applySmallScreenProtection().catch((err: unknown) => {
            logger.warn('[WindowUI] Failed to apply small screen protection:', err);
        });

        // Initial check
        this._checkWidth();
        this._initSoundState();

        // End grace period after 2 seconds
        this._gracePeriodTimeout = setTimeout(() => {
            this._isInGracePeriod = false;
        }, 2000);
    }

    /**
     * Caches frequently accessed DOM elements to prevent thrashing.
     */
    private _cacheElements(): void {
        this._splash = document.getElementById('splash-screen');
        this._modulesWarning = document.getElementById('modules-width-warning');
        this._settingsWarning = document.getElementById('settings-width-warning');
        this._maximizeIcon = document.getElementById('maximize-icon');
        this._soundToggle = document.getElementById('sound-toggle-btn');
    }

    /**
     * Cleans up all event listeners and timeouts.
     */
    public destroy(): void {
        this._cleanupAbort.abort();

        if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
        if (this._monitoringTimeout) clearTimeout(this._monitoringTimeout);
        if (this._splashTimeout) clearTimeout(this._splashTimeout);
        if (this._gracePeriodTimeout) clearTimeout(this._gracePeriodTimeout);
    }

    /**
     * Binds global window and document events.
     * @sideeffect Pollutes global namespace with listeners
     */
    private _bindGlobalEvents(): void {
        const signal = this._cleanupAbort.signal;

        // 1. Context Menu Block (Section 23.4: Discouraged globally, restricted here for App feel)
        document.addEventListener(
            'contextmenu',
            (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.allow-context-menu')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
            },
            { capture: true, signal },
        );

        // 2. Monitoring Pause on Blur/Hide
        const updateMonitoring = (): void => {
            const shouldPause = !this._isInGracePeriod && (document.hidden || !document.hasFocus());
            void this._service.setMonitoringPaused(shouldPause);
        };
        document.addEventListener('visibilitychange', updateMonitoring, { signal });
        globalThis.addEventListener('blur', updateMonitoring, { signal });
        globalThis.addEventListener('focus', updateMonitoring, { signal });

        this._monitoringTimeout = setTimeout(updateMonitoring, 1000);

        // 3. Keydown Handlers
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

        // 4. Zoom (Ctrl+Wheel)
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
                            // Ensure style recalculation happens before checking
                            setTimeout(() => {
                                this._checkWidth();
                            }, 50);
                        })
                        .catch(() => {
                            /* ignore */
                        });
                }
            },
            { passive: false, signal },
        );

        // 5. Selection Prevention
        this._bindSelectionPrevention(signal);

        // 6. Resize Handler
        globalThis.addEventListener('resize', this._handleResize.bind(this), { signal });
    }

    /**
     * Handles window resize events with debouncing.
     */
    private _handleResize(): void {
        this._checkWidth(); // Immediate check
        this._service.checkResolutionChange(); // Detect resolution/monitor changes

        if (this._resizeTimeout) {
            clearTimeout(this._resizeTimeout);
        }
        this._resizeTimeout = setTimeout(() => {
            void this._performResizeCheck();
        }, 200);
    }

    /**
     * Performs a check on maximization state and window policy after resize.
     */
    private async _performResizeCheck(): Promise<void> {
        try {
            const [isMaximized, policy] = await Promise.all([
                this._service.isMaximized(),
                this._service.checkPolicy(),
            ]);

            this.updateMaximizeIcon(isMaximized);
            this._handlePolicyAdjustments(policy, isMaximized);
        } catch (e) {
            logger.warn('[WindowUI] Resize check failed:', e);
        }
    }

    /**
     * Handles global keydown events (shortcuts, devtools blocking).
     * @sideeffect Intercepts keyboard events and blocks window shortcuts
     */
    private _handleKeydown(e: KeyboardEvent): void {
        // Block DevTools
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase()))
        ) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // F11 Toggle Maximize
        if (e.key === 'F11') {
            e.preventDefault();
            this._service.toggleMaximize().catch(() => {
                /* ignore */
            });
            return;
        }

        // Ctrl+R Refresh
        if ((e.ctrlKey && ['r', 'R', 'к', 'К'].includes(e.key)) || e.key === 'F5') {
            e.preventDefault();
            globalThis.location.reload();
            return;
        }

        // Block browser shortcuts
        if (e.ctrlKey && ['u', 'p', 's', 'f', 'g'].includes(e.key.toLowerCase())) {
            e.preventDefault();
            e.stopPropagation();
        }
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
                if (target.closest(allowedSelectors)) {
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
                if (target.closest(allowedSelectors)) {
                    return;
                }
                if (ev.detail > 1) {
                    ev.preventDefault(); // Prevent double-click select
                }
            },
            { signal },
        );
    }

    /**
     * Hides native tooltips and stores them in data attributes.
     */
    private _suppressNativeTooltips(): void {
        const signal = this._cleanupAbort.signal;

        const handler = (): void => {
            document.querySelectorAll('[title]').forEach((el) => {
                const element = el as HTMLElement;
                const title = element.title;
                if (title) {
                    element.dataset['title'] = title;
                    element.removeAttribute('title');
                }
            });
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
                    if (target.title) {
                        const title = target.title;
                        target.dataset['title'] = title;
                        target.removeAttribute('title');
                    }
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
        const policy = await this._service.checkPolicy();
        this._isSmallScreen = policy.isSmallScreen;

        if (this._isSmallScreen) {
            this._service.toggleMaximize().catch(() => {
                /* ignore */
            });
            this._wasMaximizedOnSmallScreen = true;
        }
    }

    /**
     * Applies policies from the backend (warnings, auto-maximize).
     */
    private _handlePolicyAdjustments(
        policy: { isSmallScreen: boolean },
        isMaximized: boolean,
    ): void {
        this._isSmallScreen = policy.isSmallScreen;
        void this._handleSmallScreenUnmaximize(isMaximized);
    }

    /**
     * Handles unmaximizing on small screens by resizing to a safe area.
     * @sideeffect Changes window size
     */
    private async _handleSmallScreenUnmaximize(isMaximized: boolean): Promise<void> {
        if (!this._isSmallScreen) return;

        if (this._wasMaximizedOnSmallScreen && !isMaximized) {
            const win = globalThis as TGlobalWin;
            const width = Math.floor((win.screen.availWidth || win.screen.width) * 0.85);
            const height = Math.floor((win.screen.availHeight || win.screen.height) * 0.85);

            await this._service.setSize(width, height);
            this._wasMaximizedOnSmallScreen = false;
        }
    }

    /**
     * Updates the maximize/restore icon in the title bar.
     * @sideeffect Modifies the DOM safely
     */
    public updateMaximizeIcon(isMaximized: boolean): void {
        this._updateMaximizeButtonLabels(isMaximized);
        this._updateMaximizeButtonIcon(isMaximized);

        // Toggle body class for styling adjustments (e.g. squaring off corners)
        if (isMaximized) {
            document.body.classList.add('maximized');
        } else {
            document.body.classList.remove('maximized');
        }
    }

    private _updateMaximizeButtonLabels(isMaximized: boolean): void {
        const btn = document.getElementById('maximize-btn');
        if (!btn) return;

        const g = globalThis as TGlobalWin;
        const labelKey = isMaximized ? 'ui.launcher.button.restore' : 'ui.launcher.button.maximize';
        const fallback = isMaximized ? 'Restore' : 'Maximize';
        const label = typeof g.t === 'function' ? g.t(labelKey, fallback) : fallback;

        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        btn.dataset['i18nAriaLabel'] = labelKey;
        btn.dataset['i18nTitle'] = labelKey;
    }

    private _updateMaximizeButtonIcon(isMaximized: boolean): void {
        if (!this._maximizeIcon) return;

        const use = this._maximizeIcon.querySelector('use');
        if (use) {
            use.setAttribute('href', isMaximized ? '#icon-restore' : '#icon-maximize');
            return;
        }

        // Re-create safe structure if 'use' is missing
        this._maximizeIcon.textContent = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon');
        const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        useEl.setAttribute('href', isMaximized ? '#icon-restore' : '#icon-maximize');
        svg.appendChild(useEl);
        this._maximizeIcon.appendChild(svg);
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
        if (use) {
            use.setAttribute('href', enabled ? '#icon-volume' : '#icon-volume-x');
        }

        if (enabled) {
            this._soundToggle.classList.remove('muted');
        } else {
            this._soundToggle.classList.add('muted');
        }
    }

    /**
     * Checks current window width and displays warnings if too small.
     * @sideeffect Shows/hides warning overlays in the DOM
     */
    private _checkWidth(): void {
        // Get current zoom factor (default 1)
        const computedStyle = getComputedStyle(document.documentElement) as CSSStyleDeclaration & {
            zoom?: string;
        };
        const zoom = Number.parseFloat(computedStyle.zoom || '1') || 1;

        // Calculate effective space available to the layout
        const win = globalThis as TGlobalWin;
        const width = win.innerWidth / zoom;
        const height = win.innerHeight / zoom;

        // Use backend thresholds if available, otherwise safe defaults (0 to disable)
        const config = this._service.getConfig();
        const minWidth = config?.thresholds.warningWidth ?? 0;
        const minHeight = config?.thresholds.warningHeight ?? 0;

        const showWarning = width < minWidth || height < minHeight;

        const modulesPage = document.getElementById('page-modules');
        const settingsPage = document.getElementById('page-settings');

        const isModulesActive = modulesPage?.classList.contains('active') === true;
        const isSettingsActive = settingsPage?.classList.contains('active') === true;

        if (this._modulesWarning) {
            if (showWarning && isModulesActive) {
                this._modulesWarning.classList.remove('hidden');
                this._modulesWarning.classList.add('flex-important');
            } else {
                this._modulesWarning.classList.remove('flex-important');
                this._modulesWarning.classList.add('hidden');
            }
        }

        if (this._settingsWarning) {
            if (showWarning && isSettingsActive) {
                this._settingsWarning.classList.remove('hidden');
                this._settingsWarning.classList.add('flex-important');
            } else {
                this._settingsWarning.classList.remove('flex-important');
                this._settingsWarning.classList.add('hidden');
            }
        }
    }

    /**
     * Hides the splash screen and reveals the main UI.
     * @sideeffect Modifies body overflow and visibility of major layout blocks
     */
    public hideSplashScreen(): void {
        if (this._splash) {
            // Trigger CSS Transition
            this._splash.classList.add('fade-out');

            if (this._splashTimeout) clearTimeout(this._splashTimeout);

            // Wait for CSS transition (600ms) + buffer
            this._splashTimeout = setTimeout(() => {
                if (this._splash) {
                    this._splash.classList.remove('fade-out'); // Clean up class
                    this._splash.classList.add('hidden'); // display: none
                }
                document.body.classList.remove('no-overflow');
                this._splashTimeout = null;
            }, 650);
        }

        ['sidebar', 'app-header', 'main-area'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('visible');
            }
        });
    }
}
