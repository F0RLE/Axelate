/**
 * @module settings/ui/GeneralSettingsRenderer
 * @description Specialized renderer for general application settings (taskbar, monitor, etc.)
 */

import { StateService } from '../../core/services/StateService';
import type { TGlobalWin } from '../../core/types/global_bridge_types';

export class GeneralSettingsRenderer {
    constructor(private readonly _state: StateService) {}

    /**
     * Initializes the general settings renderer.
     */
    public init(): void {
        this._initTaskbarToggles();
        this._initMonitorToggles();
    }

    /**
     * Initializes taskbar visibility toggles.
     */
    private _initTaskbarToggles() {
        const container = document.getElementById('taskbar-toggles');
        if (!container || container.dataset['initialized'] === 'true') return;
        container.dataset['initialized'] = 'true';

        const win = globalThis as TGlobalWin;
        const t = typeof win['t'] === 'function' ? win['t'] : (_k: string, d: string) => d;

        const navItems = [
            { id: 'home', label: 'Home', icon: '#icon-home' },
            { id: 'chat', label: 'Chat', icon: '#icon-chat' },
            { id: 'modules', label: 'Modules', icon: '#icon-folder' },
            { id: 'downloads', label: 'Downloads', icon: '#icon-download' },
            { id: 'debug', label: 'Console', icon: '#icon-console' },
        ];

        const hiddenItems = this._state.getHiddenNavItems();

        const html = navItems
            .map((item) => {
                const labelKey = `ui.launcher.settings.toggle_${item.id}`;
                return `
                <div class="taskbar-toggle-item ${hiddenItems.includes(item.id) ? '' : 'active'}"
                     data-page-id="${item.id}"
                     >
                    <svg class="toggle-icon">
                        <use href="${item.icon}"></use>
                    </svg>
                    <span class="toggle-label" data-i18n="${labelKey}">${t(labelKey, item.label)}</span>
                </div>
            `;
            })
            .join('');

        container.innerHTML = html;

        container.addEventListener('click', (e) => {
            const item = (e.target as Element).closest('.taskbar-toggle-item') as HTMLElement;
            if (item) {
                const pageId = item.dataset['pageId'];
                if (pageId) {
                    item.classList.toggle('active');
                    this.toggleNavItem(pageId, item.classList.contains('active'));
                }
            }
        });

        this._applyHiddenState(hiddenItems);
        this._observeToggleGrid('taskbar-toggles');
    }

    /**
     * Toggles a sidebar navigation item visibility.
     */
    public toggleNavItem(pageId: string, enabled: boolean) {
        const hiddenItems = this._state.getHiddenNavItems();
        const navBtn = document.querySelector(
            `#sidebar .nav-btn[data-page="${pageId}"]`,
        ) as HTMLElement;

        if (enabled) {
            const idx = hiddenItems.indexOf(pageId);
            if (idx > -1) hiddenItems.splice(idx, 1);
            if (navBtn) {
                // Animate in: prepare hidden state first
                navBtn.classList.add('nav-item-hiding');
                navBtn.classList.remove('hidden');
                // Force reflow
                const _reflow = navBtn.offsetHeight;
                if (_reflow) {
                    /* ensure it's "used" if needed, though _ prefix usually suffices */
                }
                // Animate in
                navBtn.classList.remove('nav-item-hiding');
            }
        } else {
            if (!hiddenItems.includes(pageId)) hiddenItems.push(pageId);
            if (navBtn) {
                // Animate out
                navBtn.classList.add('nav-item-hiding');
                setTimeout(() => {
                    if (navBtn.classList.contains('nav-item-hiding')) {
                        navBtn.classList.add('hidden');
                        navBtn.classList.remove('nav-item-hiding');
                    }
                }, 500);
            }
        }
        this._state.setHiddenNavItems(hiddenItems);
    }

    /**
     * Applies hidden state to navigation items on startup.
     */
    private _applyHiddenState(hidden: string[]) {
        hidden.forEach((id) => {
            const btn = document.querySelector(`#sidebar .nav-btn[data-page="${id}"]`);
            if (btn) btn.classList.add('hidden');
        });
    }

    /**
     * Initializes system monitor toggles.
     */
    private _initMonitorToggles() {
        const container = document.getElementById('monitor-toggles');
        if (!container || container.dataset['initialized'] === 'true') return;
        container.dataset['initialized'] = 'true';

        const win = globalThis as TGlobalWin;
        const t = typeof win['t'] === 'function' ? win['t'] : (_k: string, d: string) => d;

        const monitorItems = [
            { id: 'cpu', label: 'CPU', icon: '#icon-cpu' },
            { id: 'gpu', label: 'GPU', icon: '#icon-gpu' },
            { id: 'ram', label: 'RAM', icon: '#icon-ram' },
            { id: 'vram', label: 'VRAM', icon: '#icon-vram' },
            { id: 'disk', label: 'Disk', icon: '#icon-disk' },
            { id: 'network', label: 'Network', icon: '#icon-network' },
        ];

        const hiddenMonitors = this._state.getHiddenMonitors();

        const html = monitorItems
            .map((item) => {
                const labelKey = `ui.launcher.settings.monitor_${item.id}`;
                return `
                <button class="monitor-toggle-btn ${hiddenMonitors.includes(item.id) ? '' : 'active'}"
                        data-monitor-id="${item.id}"
                        >
                    <svg class="toggle-icon">
                        <use href="${item.icon}"></use>
                    </svg>
                    <span class="toggle-label" data-i18n="${labelKey}">${t(labelKey, item.label)}</span>
                </button>
            `;
            })
            .join('');

        container.innerHTML = html;

        container.addEventListener('click', (e) => {
            const btn = (e.target as Element).closest('.monitor-toggle-btn') as HTMLElement;
            if (btn) {
                const mid = btn.dataset['monitorId'];
                if (mid) {
                    btn.classList.toggle('active');
                    this.toggleMonitorItem(mid, btn.classList.contains('active'));
                }
            }
        });

        hiddenMonitors.forEach((id) => {
            const el = document.querySelector(
                `#system-monitor .sysmon-stat[data-monitor-id="${id}"]`,
            );
            if (el) el.classList.add('hidden');
        });

        this._observeToggleGrid('monitor-toggles');
    }

    /**
     * Toggles a system monitor visibility.
     */
    public toggleMonitorItem(id: string, enabled: boolean) {
        const hidden = this._state.getHiddenMonitors();
        const el = document.querySelector(
            `#system-monitor .sysmon-stat[data-monitor-id="${id}"]`,
        ) as HTMLElement;

        if (enabled) {
            const idx = hidden.indexOf(id);
            if (idx > -1) hidden.splice(idx, 1);
            if (el) {
                // Animate in: set hiding class first (starts invisible)
                el.classList.add('hiding');
                el.classList.remove('hidden');
                // Force reflow
                const _reflow = el.offsetHeight;
                if (_reflow) {
                    /* no-op */
                }
                // Remove hiding to trigger fade-in
                el.classList.remove('hiding');
            }
        } else {
            if (!hidden.includes(id)) hidden.push(id);
            if (el) {
                // Animate out
                el.classList.add('hiding');
                setTimeout(() => {
                    el.classList.add('hidden');
                    this._updateMonitorPanelVisibility();
                }, 250);
            }
        }
        this._state.setHiddenMonitors(hidden);
        this._updateMonitorDivider();
        if (enabled) {
            this._updateMonitorPanelVisibility();
        }
    }

    /**
     * Updates the main monitor panel visibility (hides if all items are hidden).
     */
    private _updateMonitorPanelVisibility() {
        const monitorPanel = document.getElementById('system-monitor');
        if (!monitorPanel) return;

        const hiddenMonitors = this._state.getHiddenMonitors();
        const totalMonitors = ['cpu', 'gpu', 'ram', 'vram', 'disk', 'network'];
        const allHidden = totalMonitors.every((id) => hiddenMonitors.includes(id));

        if (allHidden) {
            monitorPanel.style.opacity = '0';
            monitorPanel.style.maxHeight = '0';
            monitorPanel.style.overflow = 'hidden';
            monitorPanel.style.pointerEvents = 'none';
            monitorPanel.style.padding = '0';
            monitorPanel.style.margin = '0';
            monitorPanel.style.border = 'none';
        } else {
            monitorPanel.style.opacity = '';
            monitorPanel.style.maxHeight = '';
            monitorPanel.style.overflow = '';
            monitorPanel.style.pointerEvents = '';
            monitorPanel.style.padding = '';
            monitorPanel.style.margin = '';
            monitorPanel.style.border = '';
        }
    }

    /**
     * Updates the divider visibility in the monitor panel.
     */
    private _updateMonitorDivider() {
        const divider = document.querySelector('.sysmon-divider') as HTMLElement;
        if (!divider) return;

        const hiddenMonitors = this._state.getHiddenMonitors();
        const aboveItems = ['cpu', 'gpu', 'ram', 'vram'];
        const belowItems = ['disk', 'network'];

        const allAboveHidden = aboveItems.every((id) => hiddenMonitors.includes(id));
        const allBelowHidden = belowItems.every((id) => hiddenMonitors.includes(id));

        // Hide divider if either all above OR all below are hidden
        if (allAboveHidden || allBelowHidden) {
            divider.style.display = 'none';
        } else {
            divider.style.display = '';
        }
    }

    /**
     * Observes a container with a ResizeObserver to apply compact classes.
     */
    private _observeToggleGrid(id: string) {
        const el = document.getElementById(id);
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                if (w < 450) el.classList.add('compact');
                else el.classList.remove('compact');
                if (w < 300) el.classList.add('super-compact');
                else el.classList.remove('super-compact');
            }
        });
        ro.observe(el);
    }
}
