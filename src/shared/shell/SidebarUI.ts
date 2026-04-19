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
    private static readonly _AUTO_COMPACT_ZOOM_THRESHOLD = 3;
    private static readonly _AUTO_COMPACT_WARNING_LEAD_STEPS = 0;
    private static readonly _AUTO_COMPACT_ZOOM_STEP = 0.1;
    private static readonly _AUTO_COMPACT_THRESHOLD_FACTOR = 0.5;

    private _sidebar: HTMLElement | null = null;
    private _isCollapsed = false;
    private _isAutoCompact = false;
    private _snappingTimeout: ReturnType<typeof setTimeout> | null = null;
    private _resizeObserver: ResizeObserver | null = null;
    private _monitorCheckFrame: number | null = null;
    private readonly _autoCompactPolicy = new SidebarAutoCompactPolicy({
        collapsedWidth: SidebarUI._COLLAPSED_WIDTH,
        expandedWidth: SidebarUI._EXPANDED_WIDTH,
        autoCompactZoomThreshold: SidebarUI._AUTO_COMPACT_ZOOM_THRESHOLD,
        autoCompactWarningLeadSteps: SidebarUI._AUTO_COMPACT_WARNING_LEAD_STEPS,
        autoCompactZoomStep: SidebarUI._AUTO_COMPACT_ZOOM_STEP,
        autoCompactThresholdFactor: SidebarUI._AUTO_COMPACT_THRESHOLD_FACTOR,
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
                    this._updateAutoCompactState();
                    this._applySidebarWidth();
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
        this._isCollapsed = this._state.getSidebarCollapsed();
        this._updateAutoCompactState();
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
        logoArea.setAttribute('role', 'button');
        logoArea.setAttribute('tabindex', '0');
        logoArea.setAttribute('aria-label', 'Toggle Sidebar');
        logoArea.setAttribute('aria-expanded', (!this._isCollapsed).toString());

        const toggle = (): void => {
            if (this._sidebar === null) return;

            this._isCollapsed = !this._isCollapsed;
            this._startSnappingAnimation();
            this._updateAutoCompactState();
            this._applySidebarWidth();
            this._persistSidebarState();
            logoArea.setAttribute('aria-expanded', (!this._isCollapsed).toString());
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

        const width = this._autoCompactPolicy.getSidebarWidth(
            this._isCollapsed,
            this._isAutoCompact,
        );

        this._sidebar.classList.toggle('collapsed', width < 100);
        this._sidebar.classList.toggle('auto-compact', this._isAutoCompact);
        document.documentElement.style.setProperty('--sidebar-width', `${String(width)}px`);
        this._sidebar.style.width = `${String(width)}px`;
    }

    private _updateAutoCompactState(): void {
        const zoom = this._state.getZoomLevel();
        this._isAutoCompact = this._autoCompactPolicy.isAutoCompact(
            zoom,
            this._windowService?.getConfig(),
            {
                width: globalThis.innerWidth,
                height: globalThis.innerHeight,
            },
        );
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
        if (this._sidebar === null) return;

        const elements = this._getMonitoringElements();
        if (elements === null) {
            return;
        }
        this._monitorVisibilityController.update(elements);
    }

    private async _findSidebar(): Promise<HTMLElement | null> {
        let attempts = 0;
        while (attempts < 10) {
            const sidebar = this.getElement<HTMLElement>('sidebar');
            if (sidebar !== null && sidebar.children.length > 0) {
                return sidebar;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
        }

        return null;
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

    private _persistSidebarState(): void {
        const targetWidth = this._isCollapsed
            ? SidebarUI._COLLAPSED_WIDTH
            : SidebarUI._EXPANDED_WIDTH;
        this._state.setSidebarWidth(targetWidth);
        this._state.setSidebarCollapsed(this._isCollapsed);
    }

    private _getMonitoringElements(): IMonitoringElements | null {
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

        return { sidebar: this._sidebar, monitor, logo, menu, bottom };
    }
}
