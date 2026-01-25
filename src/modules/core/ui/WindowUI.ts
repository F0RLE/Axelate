/**
 * @module core/ui/WindowUI
 * @description Manages window-related UI events, shortcuts, and screen protection
 */

import { WindowService } from '../services/WindowService';
import { I18nService } from '../services/I18nService';

interface IWindowUIGlobal {
    location?: Location;
    screen?: Screen;
    innerWidth: number;
}

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
    private _monitoringTimeout: ReturnType<typeof setTimeout> | null = null;
    private _splashTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly _service: WindowService, 
        private readonly _i18n: I18nService
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
            console.warn('[WindowUI] Failed to apply small screen protection:', err);
        });
        
        // Initial check
        this._checkWidth();
    }

    /**
     * Caches frequently accessed DOM elements to prevent thrashing.
     */
    private _cacheElements(): void {
        this._splash = document.getElementById('splash-screen');
        this._modulesWarning = document.getElementById('modules-width-warning');
        this._settingsWarning = document.getElementById('settings-width-warning');
        this._maximizeIcon = document.getElementById('maximize-icon');
    }

    /**
     * Cleans up all event listeners and timeouts.
     */
    public destroy(): void {
        this._cleanupAbort.abort();
        
        if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
        if (this._monitoringTimeout) clearTimeout(this._monitoringTimeout);
        if (this._splashTimeout) clearTimeout(this._splashTimeout);
    }

    /**
     * Binds global window and document events.
     * @sideeffect Pollutes global namespace with listeners
     */
    private _bindGlobalEvents(): void {
        const signal = this._cleanupAbort.signal;

        // 1. Context Menu Block (Section 23.4: Discouraged globally, restricted here for App feel)
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { capture: true, signal });

        // 2. Monitoring Pause on Blur/Hide
        const updateMonitoring = (): void => {
             const shouldPause = document.hidden || !document.hasFocus();
             this._service.setMonitoringPaused(shouldPause);
        };
        document.addEventListener('visibilitychange', updateMonitoring, { signal });
        globalThis.addEventListener('blur', updateMonitoring, { signal });
        globalThis.addEventListener('focus', updateMonitoring, { signal });
        
        this._monitoringTimeout = setTimeout(updateMonitoring, 1000);

        // 3. Keydown Handlers
        document.addEventListener('keydown', (e) => this._handleKeydown(e), { capture: true, signal });

        // 4. Zoom (Ctrl+Wheel)
        document.addEventListener('wheel', (e: Event) => {
            const ev = e as WheelEvent;
            if (ev.ctrlKey) {
                ev.preventDefault();
                const delta = ev.deltaY < 0 ? 0.1 : -0.1;
                this._service.changeZoom(delta).catch(() => { /* ignore */ });
            }
        }, { passive: false, signal });

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
        if (this._resizeTimeout) {
           clearTimeout(this._resizeTimeout);
        }
        this._resizeTimeout = setTimeout(() => {
            this._performResizeCheck();
        }, 200);
    }
    
    /**
     * Performs a check on maximization state after resize.
     */
    private _performResizeCheck(): void {
        this._service.isMaximized().then((isMaximized: boolean) => {
            this.updateMaximizeIcon(isMaximized);
            this._handleSmallScreenUnmaximize(isMaximized).catch(() => { /* ignore */ });
        }).catch(() => { /* ignore */ });
    }

    /**
     * Handles global keydown events (shortcuts, devtools blocking).
     * @sideeffect Intercepts keyboard events and blocks window shortcuts
     */
    private _handleKeydown(e: KeyboardEvent): void {
        const g = globalThis as unknown as IWindowUIGlobal;
        
        // Block DevTools
        if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key.toUpperCase()))) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // F11 Toggle Maximize
        if (e.key === 'F11') {
            e.preventDefault();
            this._service.toggleMaximize().catch(() => { /* ignore */ });
            return;
        }

        // Ctrl+R Refresh
        if ((e.ctrlKey && ['r','R','к','К'].includes(e.key)) || e.key === 'F5') {
            e.preventDefault();
            if (g.location) g.location.reload();
            return;
        }

        // Block browser shortcuts
        if (e.ctrlKey && ['u','p','s','f','g'].includes(e.key.toLowerCase())) {
             e.preventDefault();
             e.stopPropagation();
        }
    }

    /**
     * Prevents text selection in UI elements except where allowed.
     */
    private _bindSelectionPrevention(signal: AbortSignal): void {
        const allowedSelectors = 'input, textarea, .console-logs-area, [contenteditable], .chat-bubble, .selectable';

        document.addEventListener('selectstart', (e: Event) => {
            const target = e.target as HTMLElement;
            if (target?.closest?.(allowedSelectors)) {
                return;
            }
            e.preventDefault();
        }, { signal });

        document.addEventListener('mousedown', (e: Event) => {
             const ev = e as MouseEvent;
             const target = ev.target as HTMLElement;
             if (target?.closest?.(allowedSelectors)) {
                return;
             }
             if (ev.detail > 1) {
                ev.preventDefault(); // Prevent double-click select
             }
        }, { signal });
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
                    element.dataset.title = title;
                    element.removeAttribute('title');
                }
            });
        };
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', handler, { signal });
        } else {
            handler();
        }

        document.addEventListener('mouseover', (e: Event) => {
            let target = e.target as HTMLElement | null;
            while(target && target !== document.body) {
                if (target.title) {
                    const title = target.title;
                    target.dataset.title = title;
                    target.removeAttribute('title');
                }
                target = target.parentElement;
            }
        }, { passive: true, signal });
    }

    /**
     * Detects and applies adjustments for small screens (zoom, maximization).
     * @sideeffect Changes window zoom and maximization
     */
    private async _applySmallScreenProtection(): Promise<void> {
         this._isSmallScreen = this._service.detectSmallScreen();
         if (this._isSmallScreen) {
             this._service.setZoom(0.7);
             this._service.toggleMaximize().catch(() => {});
             this._wasMaximizedOnSmallScreen = true;
         }
    }

    /**
     * Handles unmaximizing on small screens by resizing to a safe area.
     * @sideeffect Changes window size
     */
    private async _handleSmallScreenUnmaximize(isMaximized: boolean): Promise<void> {
        if (!this._isSmallScreen) return;

        if (this._wasMaximizedOnSmallScreen && !isMaximized) {
            const g = globalThis as unknown as IWindowUIGlobal;
            if (g.screen) {
                const width = Math.floor((g.screen.availWidth || g.screen.width) * 0.85);
                const height = Math.floor((g.screen.availHeight || g.screen.height) * 0.85);

                await this._service.setSize(width, height);
                this._wasMaximizedOnSmallScreen = false;
            }
        }
    }

    /**
     * Updates the maximize/restore icon in the title bar.
     * @sideeffect Modifies the DOM safely
     */
    public updateMaximizeIcon(isMaximized: boolean): void {
        if (!this._maximizeIcon) return;

        // Section 4.4 Fix: Use safe structure manipulation
        const use = this._maximizeIcon.querySelector('use');
        if (use) {
            use.setAttribute('href', isMaximized ? '#icon-restore' : '#icon-maximize');
        } else {
            // Re-create safe structure
            this._maximizeIcon.textContent = '';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'icon');
            const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            useEl.setAttribute('href', isMaximized ? '#icon-restore' : '#icon-maximize');
            svg.appendChild(useEl);
            this._maximizeIcon.appendChild(svg);
        }
    }

    /**
     * Checks current window width and displays warnings if too small.
     * @sideeffect Shows/hides warning overlays in the DOM
     */
    private _checkWidth(): void {
        const g = globalThis as unknown as IWindowUIGlobal;
        const width = g.innerWidth;
        const MIN_WIDTH = 950;

        if (width < MIN_WIDTH) {
            if (this._modulesWarning) {
                this._modulesWarning.classList.remove('hidden');
                this._modulesWarning.classList.add('flex-important');
            }
            if (this._settingsWarning && !document.getElementById('page-settings')?.classList.contains('hidden')) {
                this._settingsWarning.classList.remove('hidden');
                this._settingsWarning.classList.add('flex-important');
            }
        } else {
            if (this._modulesWarning) {
                this._modulesWarning.classList.remove('flex-important');
                this._modulesWarning.classList.add('hidden');
            }
            if (this._settingsWarning) {
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
            this._splash.classList.add('fade-out');
            
            if (this._splashTimeout) clearTimeout(this._splashTimeout);
            this._splashTimeout = setTimeout(() => {
                if (this._splash) this._splash.classList.add('hidden');
                document.body.classList.remove('no-overflow');
                this._splashTimeout = null;
            }, 500);
        }

        ['sidebar', 'app-header', 'main-area'].forEach((id) => {
            const el = document.getElementById(id);
            if(el) {
                el.classList.add('visible');
            }
        });
    }

    /**
     * Checks if this is the first launch and initializes language.
     * @sideeffect Modifies localStorage and loads translations
     */
    public async checkFirstLaunch(): Promise<void> {
        const savedLang = localStorage.getItem('web_launcher_language');
        if (savedLang) {
            await this._i18n.loadTranslations(savedLang);
            return;
        }

        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const data = await res.json() as { LANGUAGE?: string };
                if (data.LANGUAGE) {
                    await this._i18n.loadTranslations(data.LANGUAGE);
                    localStorage.setItem('web_launcher_language', data.LANGUAGE);
                    return;
                }
            }
        } catch (e: unknown) {
            console.error('[WindowUI] Failed to load from backend:', e);
        }

        const systemLang = await this._i18n.getSystemLanguage();
        await this._i18n.loadTranslations(systemLang);
        localStorage.setItem('web_launcher_language', systemLang);
    }
}
