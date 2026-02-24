/**
 * @module settings/ui/GeneralSettingsRenderer
 * @description Specialized renderer for general application settings (taskbar, monitor, etc.)
 */

import { type UISettingsService } from '@/shared/services/ui/UISettingsService';
import { logger } from '@/infrastructure/logging/LoggerService';
import DOMPurify from 'dompurify';
import type { ISettingsUIContext } from './SettingsContext';

export class GeneralSettingsRenderer {
    constructor(private readonly _uiSettings: UISettingsService) {}

    /**
     * Initializes the general settings renderer.
     */
    public init(context: ISettingsUIContext): void {
        logger.info('[GeneralSettingsRenderer] Initializing...');
        this._initTaskbarToggles(context);
        this._initMonitorToggles(context);
    }

    /**
     * Initializes taskbar visibility toggles.
     */
    private _initTaskbarToggles(context: ISettingsUIContext) {
        const container = document.getElementById('taskbar-toggles');
        if (!container) {
            logger.warn('[GeneralSettingsRenderer] #taskbar-toggles not found');
            return;
        }
        if (container.dataset['initialized'] === 'true') {
            logger.info('[GeneralSettingsRenderer] #taskbar-toggles already initialized');
            return;
        }
        container.dataset['initialized'] = 'true';
        logger.info('[GeneralSettingsRenderer] Initializing taskbar toggles');

        const { t } = context;

        const navItems = [
            { id: 'home', label: 'Home', icon: '#icon-home' },
            { id: 'chat', label: 'Chat', icon: '#icon-chat' },
            { id: 'modules', label: 'Modules', icon: '#icon-folder' },
            // Settings omitted to prevent lockout
            { id: 'debug', label: 'Console', icon: '#icon-console' },
            { id: 'downloads', label: 'Downloads', icon: '#icon-download' },
        ];

        const hiddenItems = this._uiSettings.getHiddenNavItems();

        const html = navItems
            .map((item) => {
                const labelKey = `ui.launcher.settings.toggle_${item.id}`;
                return `
                <button class="monitor-toggle-btn ${hiddenItems.includes(item.id) ? '' : 'active'}"
                     data-page-id="${item.id}"
                     >
                    <svg class="toggle-icon">
                        <use href="${item.icon}"></use>
                    </svg>
                    <span class="toggle-label" data-i18n="${labelKey}">${t(labelKey, item.label)}</span>
                </button>
            `;
            })
            .join('');

        container.innerHTML = DOMPurify.sanitize(html);

        container.addEventListener('click', (e) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            const item = target.closest('.monitor-toggle-btn');
            if (item instanceof HTMLElement) {
                const pageId = item.dataset['pageId'];
                if (pageId !== undefined && pageId !== '') {
                    item.classList.toggle('active');
                    this.toggleNavItem(pageId, item.classList.contains('active'));
                }
            }
        });

        this._applyHiddenState(hiddenItems);
        this._observeToggleGrid('taskbar-toggles');
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
     * Toggles a sidebar navigation item visibility.
     */
    public toggleNavItem(pageId: string, enabled: boolean) {
        const hiddenItems = this._uiSettings.getHiddenNavItems();
        const navBtn = document.querySelector(`#sidebar .nav-btn[data-page="${pageId}"]`);

        if (enabled) {
            const idx = hiddenItems.indexOf(pageId);
            if (idx > -1) hiddenItems.splice(idx, 1);
            if (navBtn instanceof HTMLElement) {
                // Animate in: prepare hidden state first
                navBtn.classList.add('nav-item-hiding');
                navBtn.classList.remove('hidden');
                // Force reflow
                const _reflow = navBtn.offsetHeight;
                if (_reflow) {
                    /* no-op */
                }

                // Animate in using double rAF to guarantee transition start
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        navBtn.classList.remove('nav-item-hiding');
                    });
                });
            }
        } else {
            if (!hiddenItems.includes(pageId)) hiddenItems.push(pageId);
            if (navBtn instanceof HTMLElement) {
                // Animate out
                navBtn.classList.add('nav-item-hiding');
                setTimeout(() => {
                    if (navBtn.classList.contains('nav-item-hiding')) {
                        navBtn.classList.add('hidden');
                        navBtn.classList.remove('nav-item-hiding');
                    }
                }, 350); // Match CSS transition (300ms) + buffer
            }
        }
        this._uiSettings.setHiddenNavItems(hiddenItems);
    }

    /**
     * Initializes system monitor toggles.
     */
    /**
     * Initializes system monitor toggles.
     */
    private _initMonitorToggles(context: ISettingsUIContext) {
        const container = document.getElementById('monitor-toggles');
        if (!container) {
            logger.warn('[GeneralSettingsRenderer] #monitor-toggles not found');
            return;
        }
        if (container.dataset['initialized'] === 'true') {
            logger.info('[GeneralSettingsRenderer] #monitor-toggles already initialized');
            return;
        }
        container.dataset['initialized'] = 'true';
        logger.info('[GeneralSettingsRenderer] Initializing monitor toggles');
        const monitorItems = [
            { id: 'cpu', label: 'CPU', icon: '#icon-cpu' },
            { id: 'gpu', label: 'GPU', icon: '#icon-gpu' },
            { id: 'ram', label: 'RAM', icon: '#icon-ram' },
            { id: 'vram', label: 'VRAM', icon: '#icon-vram' },
            { id: 'disk', label: 'Disk', icon: '#icon-disk' },
            { id: 'network', label: 'Network', icon: '#icon-network' },
        ];

        const hiddenMonitors = this._uiSettings.getHiddenMonitors();

        const { t } = context;

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

        container.innerHTML = DOMPurify.sanitize(html);

        container.addEventListener('click', (e) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            const btn = target.closest('.monitor-toggle-btn');
            if (btn instanceof HTMLElement) {
                const mid = btn.dataset['monitorId'];
                if (mid !== undefined && mid !== '') {
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

        this._updateMonitorPanelVisibility(false);
        this._updateMonitorDivider(false);

        this._observeToggleGrid('monitor-toggles');
    }

    /**
     * Toggles a system monitor visibility.
     */
    public toggleMonitorItem(id: string, enabled: boolean) {
        const hidden = this._uiSettings.getHiddenMonitors();
        const el = document.querySelector(`#system-monitor .sysmon-stat[data-monitor-id="${id}"]`);

        if (enabled) {
            const idx = hidden.indexOf(id);
            if (idx > -1) hidden.splice(idx, 1);
            if (el instanceof HTMLElement) {
                // Animate in: set hiding class first (starts invisible)
                el.classList.add('hiding');
                el.classList.remove('hidden');
                // Force reflow
                const _reflow = el.offsetHeight;
                if (_reflow) {
                    /* no-op */
                }

                // Animate in
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        el.classList.remove('hiding');
                    });
                });
            }
        } else {
            if (!hidden.includes(id)) hidden.push(id);
            if (el instanceof HTMLElement) {
                // Animate out
                el.classList.add('hiding');
                setTimeout(() => {
                    el.classList.add('hidden');
                    el.classList.remove('hiding');
                }, 350);
            }
        }
        this._uiSettings.setHiddenMonitors(hidden);

        // Parallel update: Panel and Divider start animating immediately along with the item
        this._updateMonitorPanelVisibility(true);
        this._updateMonitorDivider(true);
    }

    /**
     * Updates the main monitor panel visibility (hides if all items are hidden).
     */
    private _updateMonitorPanelVisibility(_animate: boolean = true) {
        const monitorPanel = document.getElementById('system-monitor');
        if (!monitorPanel) return;

        const hiddenMonitors = this._uiSettings.getHiddenMonitors();
        const allHidden = hiddenMonitors.length === 6; // cpu, gpu, ram, vram, disk, network

        if (allHidden) {
            monitorPanel.classList.add('adaptive-hidden');
        } else {
            monitorPanel.classList.remove('adaptive-hidden');
        }
    }

    /**
     * Updates the divider visibility in the monitor panel.
     */
    private _updateMonitorDivider(animate: boolean = true) {
        const divider = document.querySelector('.sysmon-divider');
        if (!(divider instanceof HTMLElement)) return;

        const hiddenMonitors = this._uiSettings.getHiddenMonitors();
        const aboveItems = ['cpu', 'gpu', 'ram', 'vram'];
        const belowItems = ['disk', 'network'];

        const allAboveHidden = aboveItems.every((id) => hiddenMonitors.includes(id));
        const allBelowHidden = belowItems.every((id) => hiddenMonitors.includes(id));
        const shouldHide = allAboveHidden || allBelowHidden;

        if (shouldHide) {
            if (animate) {
                divider.classList.add('hiding');
                setTimeout(() => {
                    divider.classList.add('hidden');
                    divider.classList.remove('hiding');
                }, 350);
            } else {
                divider.classList.add('hidden');
            }
        } else if (animate) {
            divider.classList.add('hiding');
            divider.classList.remove('hidden');
            const _reflow = divider.offsetHeight;
            if (_reflow) {
                /* no-op */
            }

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    divider.classList.remove('hiding');
                });
            });
        } else {
            divider.classList.remove('hidden');
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
