import { BaseComponent } from '../ui/BaseComponent';
import { type UISettingsService } from '../services/ui/UISettingsService';
import { type SoundService } from '../services/SoundService';
import { type WindowService } from '../services/WindowService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { mountLogos } from '@/assets/logos';
import { SidebarAutoCompactPolicy } from './SidebarAutoCompactPolicy';
import { SidebarMonitorVisibilityController } from './SidebarMonitorVisibilityController';
import { SidebarNavigationRenderer } from './SidebarNavigationRenderer';

interface IMonitoringElements {
    sidebar: HTMLElement;
    monitor: HTMLElement;
    logo: HTMLElement;
    menu: HTMLElement;
    bottom: HTMLElement;
}

export class SidebarUI extends BaseComponent {
    private static readonly _COLLAPSED_WIDTH = 80;
    private static readonly _EXPANDED_WIDTH = 280;
    private static readonly _AUTO_COMPACT_ZOOM_THRESHOLD = 1.6;
    private static readonly _AUTO_COMPACT_MAX_ZOOM_EPSILON = 0.01;

    private _sidebar: HTMLElement | null = null;
    private _isCollapsed = false;
    private _isAutoCompact = false;
    private _hasManualSidebarOverride = false;
    private _snappingTimeout: ReturnType<typeof setTimeout> | null = null;
    private _resizeObserver: ResizeObserver | null = null;
    private _monitorCheckFrame: number | null = null;
    private _layoutUpdateFrame: number | null = null;
    private _monitoringElements: IMonitoringElements | null = null;
    private _lastAppliedWidth: number | null = null;
    private readonly _autoCompactPolicy = new SidebarAutoCompactPolicy({
        collapsedWidth: SidebarUI._COLLAPSED_WIDTH,
        expandedWidth: SidebarUI._EXPANDED_WIDTH,
        autoCompactZoomThreshold: SidebarUI._AUTO_COMPACT_ZOOM_THRESHOLD,
        autoCompactMaxZoomEpsilon: SidebarUI._AUTO_COMPACT_MAX_ZOOM_EPSILON,
    });
    private readonly _monitorVisibilityController: SidebarMonitorVisibilityController;
    private readonly _navigationRenderer: SidebarNavigationRenderer;

    constructor(
        private readonly _state: UISettingsService,
        private readonly _tracer: LoggerService,
        private readonly _soundService?: SoundService,
        private readonly _windowService?: WindowService,
    ) {
        super(_tracer);
        this._monitorVisibilityController = new SidebarMonitorVisibilityController(this._tracer);
        this._navigationRenderer = new SidebarNavigationRenderer({
            getHiddenNavItems: () => this._state.getHiddenNavItems(),
        });
    }

    /**
     * Initializes the sidebar element, restores its last state, and sets up toggle logic.
     */
    protected async onInit(): Promise<void> {
        this._sidebar = await this._findSidebar();
        if (this._sidebar === null) {
            this._tracer.error('[SidebarUI] Sidebar element not found or empty after 1s');
            return;
        }

        this._restoreState();
        this._renderNavigation();
        this._initToggle();
        this._initAdaptiveMonitoring();
        mountLogos();

        const signal = this._abortController?.signal;
        if (signal !== undefined) {
            globalThis.addEventListener(
                'resize',
                () => {
                    this._scheduleLayoutUpdate();
                },
                { signal },
            );
            globalThis.addEventListener(
                'axelate:zoom-changed',
                () => {
                    this._scheduleLayoutUpdate(true);
                },
                { signal },
            );
            globalThis.addEventListener(
                'axelate:zoom-context-changed',
                () => {
                    this._scheduleLayoutUpdate(true);
                },
                { signal },
            );
        }
    }

    /**
     * Cleans up event listeners.
     */
    protected onDestroy(): void {
        if (this._snappingTimeout !== null) {
            clearTimeout(this._snappingTimeout);
            this._snappingTimeout = null;
        }
        if (this._resizeObserver !== null) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._monitorCheckFrame !== null) {
            globalThis.cancelAnimationFrame(this._monitorCheckFrame);
            this._monitorCheckFrame = null;
        }
        if (this._layoutUpdateFrame !== null) {
            globalThis.cancelAnimationFrame(this._layoutUpdateFrame);
            this._layoutUpdateFrame = null;
        }
        this._monitoringElements = null;
    }

    /**
     * Dynamically renders navigation buttons from APP_PAGES.
     */
    private _renderNavigation(): void {
        if (this._sidebar === null) {
            return;
        }
        this._navigationRenderer.render(this._sidebar);
    }

    /**
     * Restores the sidebar collapsed state from UI state.
     */
    private _restoreState(): void {
        const persistedWidth = this._state.getSidebarWidth();
        const hasPersistedWidth = Number.isFinite(persistedWidth) && persistedWidth > 0;

        this._isCollapsed = hasPersistedWidth
            ? persistedWidth < 100
            : this._state.getSidebarCollapsed();
        this._updateAutoCompactState();
        this._hasManualSidebarOverride =
            this._isAutoCompact && this._state.getSidebarManualOverride();
        this._applySidebarWidth();
    }

    /**
     * Initializes the toggle logic for expanding/collapsing the sidebar.
     * @sideeffect Adds event listener to logo area
     */
    private _initToggle(): void {
        if (this._sidebar === null) return;

        const logoArea = this._sidebar.querySelector('.logo-area');
        if (!(logoArea instanceof HTMLElement)) {
            return;
        }

        logoArea.style.cursor = 'pointer';
        logoArea.setAttribute('aria-label', 'Toggle Sidebar');
        logoArea.setAttribute('aria-expanded', (!this._isCollapsed).toString());

        const toggle = (): void => {
            if (this._sidebar === null) return;

            const isEffectiveAutoCompact = this._isAutoCompact && !this._hasManualSidebarOverride;
            if (isEffectiveAutoCompact) {
                this._isCollapsed = false;
                this._hasManualSidebarOverride = true;
            } else if (this._isAutoCompact && this._hasManualSidebarOverride) {
                this._isCollapsed = true;
                this._hasManualSidebarOverride = false;
            } else {
                this._isCollapsed = !this._isCollapsed;
                this._hasManualSidebarOverride = false;
            }
            this._startSnappingAnimation();
            this._updateAutoCompactState();
            this._applySidebarWidth();
            this._persistSidebarPreferenceState();
            this._soundService?.playExpand(!this._isCollapsed);
        };

        const signal = this._abortController?.signal;
        if (signal === undefined) return;

        logoArea.addEventListener('click', toggle, { signal });
        logoArea.addEventListener(
            'keydown',
            ((event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                }
            }) as EventListener,
            { signal },
        );
    }

    /**
     * Sets the actual width of the sidebar and updates CSS variables.
     * @sideeffect Modifies CSS custom properties and styles
     */
    private _applySidebarWidth(): void {
        if (this._sidebar === null) return;

        const isEffectiveAutoCompact = this._isAutoCompact && !this._hasManualSidebarOverride;
        const width = this._autoCompactPolicy.getSidebarWidth(
            this._isCollapsed,
            isEffectiveAutoCompact,
        );
        const isEffectivelyCollapsed = width < 100;
        const shouldAnimateWidth =
            this._lastAppliedWidth !== null && this._lastAppliedWidth !== width;

        if (shouldAnimateWidth) {
            this._startSnappingAnimation();
        }
        this._sidebar.classList.toggle('collapsed', isEffectivelyCollapsed);
        this._sidebar.classList.toggle('auto-compact', isEffectiveAutoCompact);
        document.documentElement.style.setProperty('--sidebar-width', `${String(width)}px`);
        this._sidebar.style.width = `${String(width)}px`;
        this._lastAppliedWidth = width;
        this._syncAccessibilityState(isEffectivelyCollapsed);
        if (!isEffectiveAutoCompact) {
            this._persistEffectiveSidebarState(
                width,
                isEffectivelyCollapsed,
                this._isAutoCompact && this._hasManualSidebarOverride,
            );
        }
    }

    private _updateAutoCompactState(): void {
        const stateZoom = this._state.getZoomLevel();
        const serviceZoom = this._windowService?.getZoom();
        const effectiveZoom = serviceZoom ?? stateZoom;
        const normalizedZoom =
            Number.isFinite(effectiveZoom) && effectiveZoom > 0 ? effectiveZoom : 1;
        const wasAutoCompact = this._isAutoCompact;

        this._isAutoCompact = this._autoCompactPolicy.isAutoCompact(
            normalizedZoom,
            this._windowService?.getConfig(),
            this._windowService?.getMaxSafeZoom(),
        );

        if (wasAutoCompact && !this._isAutoCompact) {
            this._hasManualSidebarOverride = false;
        }
    }

    /**
     * Initializes adaptive monitoring visibility.
     * Hides system monitor if there isn't enough vertical space.
     */
    private _initAdaptiveMonitoring(): void {
        if (this._sidebar === null) return;

        const elements = this._getMonitoringElements();
        if (elements === null) {
            return;
        }

        this._monitorVisibilityController.prime(elements);

        this._resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target === this._sidebar) {
                    this._scheduleMonitorVisibilityCheck();
                }
            }
        });

        this._resizeObserver.observe(this._sidebar);
        this._updateAutoCompactState();
        this._applySidebarWidth();
        this._checkMonitorVisibility();
    }

    private _scheduleLayoutUpdate(checkMonitorVisibility = false): void {
        if (this._layoutUpdateFrame !== null) {
            globalThis.cancelAnimationFrame(this._layoutUpdateFrame);
        }

        this._layoutUpdateFrame = globalThis.requestAnimationFrame(() => {
            this._layoutUpdateFrame = null;
            this._updateAutoCompactState();
            this._applySidebarWidth();
            if (checkMonitorVisibility) {
                this._checkMonitorVisibility();
            }
        });
    }

    private _scheduleMonitorVisibilityCheck(): void {
        if (this._monitorCheckFrame !== null) {
            globalThis.cancelAnimationFrame(this._monitorCheckFrame);
        }

        this._monitorCheckFrame = globalThis.requestAnimationFrame(() => {
            this._monitorCheckFrame = null;
            this._checkMonitorVisibility();
        });
    }

    private _checkMonitorVisibility(): void {
        const elements = this._getMonitoringElements();
        if (elements === null) {
            return;
        }
        const isMonitorVisible = this._monitorVisibilityController.update(elements);
        void this._windowService?.setMonitoringPaused(!isMonitorVisible);
    }

    private async _findSidebar(): Promise<HTMLElement | null> {
        const existingSidebar = this.getElement<HTMLElement>('sidebar');
        if (existingSidebar !== null && existingSidebar.children.length > 0) {
            return existingSidebar;
        }

        return await new Promise<HTMLElement | null>((resolve) => {
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            let observer: MutationObserver | null = null;

            const cleanup = () => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                observer?.disconnect();
                observer = null;
            };

            const finish = (sidebar: HTMLElement | null) => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                resolve(sidebar);
            };

            const resolveSidebar = () => {
                const sidebar = this.getElement<HTMLElement>('sidebar');
                if (sidebar !== null && sidebar.children.length > 0) {
                    finish(sidebar);
                }
            };

            timeoutId = setTimeout(() => {
                finish(null);
            }, 1000);

            observer = new MutationObserver(resolveSidebar);
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });

            resolveSidebar();
        });
    }

    private _startSnappingAnimation(): void {
        document.body.classList.add('snapping');
        if (this._snappingTimeout !== null) {
            clearTimeout(this._snappingTimeout);
        }

        this._snappingTimeout = setTimeout(() => {
            document.body.classList.remove('snapping');
            this._snappingTimeout = null;
        }, 300);
    }

    private _persistEffectiveSidebarState(
        width: number,
        collapsed: boolean,
        manualOverride = false,
    ): void {
        if (
            this._state.getSidebarWidth() === width &&
            this._state.getSidebarCollapsed() === collapsed &&
            this._state.getSidebarManualOverride() === manualOverride
        ) {
            return;
        }

        this._state.setSidebarState(collapsed, width, manualOverride);
    }

    private _persistSidebarPreferenceState(): void {
        const width = this._autoCompactPolicy.getPersistedWidth(this._isCollapsed);
        const manualOverride = this._isAutoCompact && this._hasManualSidebarOverride;

        if (
            this._state.getSidebarWidth() === width &&
            this._state.getSidebarCollapsed() === this._isCollapsed &&
            this._state.getSidebarManualOverride() === manualOverride
        ) {
            return;
        }

        this._state.setSidebarState(this._isCollapsed, width, manualOverride);
    }

    private _syncAccessibilityState(collapsed: boolean): void {
        if (this._sidebar === null) {
            return;
        }

        const logoArea = this._sidebar.querySelector('.logo-area');
        if (!(logoArea instanceof HTMLElement)) {
            return;
        }

        logoArea.setAttribute('aria-expanded', (!collapsed).toString());
    }

    private _getMonitoringElements(): IMonitoringElements | null {
        if (this._monitoringElements !== null) {
            return this._monitoringElements;
        }

        if (this._sidebar === null) {
            return null;
        }

        const monitor = this._sidebar.querySelector('#system-monitor');
        const logo = this._sidebar.querySelector('.logo-area');
        const menu = this._sidebar.querySelector('.main-menu');
        const bottom = this._sidebar.querySelector('.bottom-menu');

        if (
            !(monitor instanceof HTMLElement) ||
            !(logo instanceof HTMLElement) ||
            !(menu instanceof HTMLElement) ||
            !(bottom instanceof HTMLElement)
        ) {
            return null;
        }

        this._monitoringElements = { sidebar: this._sidebar, monitor, logo, menu, bottom };
        return this._monitoringElements;
    }
}
