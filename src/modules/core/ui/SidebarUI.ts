import { type StateService } from '../services/StateService';
import { type SoundService } from '../services/SoundService';
import { mountLogos } from '@/assets/logos';

export class SidebarUI {
    private _initialized = false;
    private _sidebar: HTMLElement | null = null;
    private readonly _cleanupAbort: AbortController = new AbortController();
    private _isCollapsed = false;
    private _snappingTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly _state: StateService,
        private readonly _soundService?: SoundService,
    ) {}

    /**
     * Initializes the sidebar element, restores its last state, and sets up toggle logic.
     * @sideeffect Accesses DOM and adds listeners
     */
    public async init(): Promise<void> {
        if (this._initialized) return;
        this._initialized = true;

        // Ensure sidebar element is present (might be injected late)
        let attempts = 0;
        while (!this._sidebar && attempts < 10) {
            this._sidebar = document.getElementById('sidebar');
            if (!this._sidebar || this._sidebar.children.length === 0) {
                this._sidebar = null; // Reset if empty container
                await new Promise((r) => setTimeout(r, 100));
                attempts++;
            } else {
                break;
            }
        }

        if (!this._sidebar) {
            console.error('[SidebarUI] Sidebar element not found or empty after 1s');
            return;
        }

        this._restoreState();
        this._initToggle();
        this._initAdaptiveMonitoring();

        // Ensure logos are mounted after template injection
        mountLogos();
    }

    /**
     * Cleans up event listeners.
     */
    public destroy(): void {
        this._cleanupAbort.abort();
        if (this._snappingTimeout) {
            clearTimeout(this._snappingTimeout);
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    /**
     * Restores the sidebar collapsed state from UI state.
     */
    private _restoreState(): void {
        this._isCollapsed = this._state.getSidebarCollapsed?.() ?? false;
        this._setSidebarWidth(this._isCollapsed ? 80 : 280);
    }

    /**
     * Initializes the toggle logic for expanding/collapsing the sidebar.
     * @sideeffect Adds event listener to logo area
     */
    private _initToggle(): void {
        if (!this._sidebar) return;

        const logoArea = this._sidebar.querySelector('.logo-area');
        if (logoArea instanceof HTMLElement) {
            // Section 23.2: Accessibility
            logoArea.style.cursor = 'pointer';
            logoArea.setAttribute('role', 'button');
            logoArea.setAttribute('tabindex', '0');
            logoArea.setAttribute('aria-label', 'Toggle Sidebar');
            logoArea.setAttribute('aria-expanded', (!this._isCollapsed).toString());

            const logoIcon = logoArea.querySelector('.sidebar-logo-icon');
            if (logoIcon instanceof HTMLElement) {
                logoIcon.classList.remove('hidden');
            }

            const toggle = (): void => {
                if (!this._sidebar) return;

                const targetWidth = this._isCollapsed ? 280 : 80;
                this._isCollapsed = !this._isCollapsed;

                document.body.classList.add('snapping');
                this._setSidebarWidth(targetWidth);

                // Update state
                this._state.setSidebarWidth?.(targetWidth);
                this._state.setSidebarCollapsed?.(this._isCollapsed);

                logoArea.setAttribute('aria-expanded', (!this._isCollapsed).toString());

                // Play sound effect
                if (this._soundService) {
                    this._soundService.playExpand(!this._isCollapsed);
                }

                if (this._snappingTimeout) clearTimeout(this._snappingTimeout);
                this._snappingTimeout = setTimeout(() => {
                    document.body.classList.remove('snapping');
                    this._snappingTimeout = null;
                }, 300);
            };

            logoArea.addEventListener('click', toggle, { signal: this._cleanupAbort.signal });
            logoArea.addEventListener(
                'keydown',
                (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle();
                    }
                },
                { signal: this._cleanupAbort.signal },
            );
        }
    }

    /**
     * Sets the actual width of the sidebar and updates CSS variables.
     * @sideeffect Modifies CSS custom properties and styles
     */
    private _setSidebarWidth(width: number): void {
        if (!this._sidebar) return;

        if (width < 100) {
            this._sidebar.classList.add('collapsed');
        } else {
            this._sidebar.classList.remove('collapsed');
        }

        document.documentElement.style.setProperty('--sidebar-width', `${String(width)}px`);
        this._sidebar.style.width = `${String(width)}px`;
    }

    private _resizeObserver: ResizeObserver | null = null;
    private _minMonitorHeight = 0;

    /**
     * Initializes adaptive monitoring visibility.
     * Hides system monitor if there isn't enough vertical space.
     */
    private _initAdaptiveMonitoring(): void {
        if (!this._sidebar) return;

        const monitor = this._sidebar.querySelector('#system-monitor');
        const logo = this._sidebar.querySelector('.logo-area');
        const menu = this._sidebar.querySelector('.main-menu');
        const bottom = this._sidebar.querySelector('.bottom-menu');

        if (
            !(monitor instanceof HTMLElement) ||
            !(logo instanceof HTMLElement) ||
            !(menu instanceof HTMLElement) ||
            !(bottom instanceof HTMLElement)
        )
            return;

        // Capture initial height of monitor to know when to bring it back
        this._minMonitorHeight = monitor.offsetHeight || 300; // Fallback to approx pixels

        this._resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target === this._sidebar) {
                    this._checkMonitorVisibility();
                }
            }
        });

        this._resizeObserver.observe(this._sidebar);
    }

    private _checkMonitorVisibility(): void {
        if (!this._sidebar) return;

        const monitor = this._sidebar.querySelector('#system-monitor');
        const logo = this._sidebar.querySelector('.logo-area');
        const menu = this._sidebar.querySelector('.main-menu');
        const bottom = this._sidebar.querySelector('.bottom-menu');

        if (
            !(monitor instanceof HTMLElement) ||
            !(logo instanceof HTMLElement) ||
            !(menu instanceof HTMLElement) ||
            !(bottom instanceof HTMLElement)
        )
            return;

        const sidebarHeight = this._sidebar.clientHeight;

        // Calculate used space by other static elements
        const logoH = logo.offsetHeight;
        const menuH = menu.offsetHeight;
        const bottomH = bottom.offsetHeight;

        // Add some breathing room (margins/padding)
        const buffer = 40;

        const requiredSpace = logoH + menuH + bottomH + this._minMonitorHeight + buffer;

        if (sidebarHeight < requiredSpace) {
            monitor.classList.add('adaptive-hidden');
            // Remove inline display if it exists from previous logic
            monitor.style.display = '';
        } else {
            monitor.classList.remove('adaptive-hidden');
            monitor.style.display = '';
        }
    }
}
