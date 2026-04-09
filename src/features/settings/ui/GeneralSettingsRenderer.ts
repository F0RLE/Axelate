/**
 * @module settings/ui/GeneralSettingsRenderer
 * @description Specialized renderer for general application settings (taskbar, monitor, etc.)
 */

import { type UISettingsService } from '@/shared/services/ui/UISettingsService';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IAppSettingsUIContext } from './SettingsContext';
import { APP_PAGES } from '@/shared/config/AppPages';

export class GeneralSettingsRenderer {
    private readonly _cleanupFns: Array<() => void> = [];
    private readonly _observers: ResizeObserver[] = [];

    constructor(private readonly _uiSettings: UISettingsService) {}

    /**
     * Initializes the general settings renderer.
     */
    public init(context: IAppSettingsUIContext): void {
        tracer.info('[GeneralSettingsRenderer] Initializing...');
        this._initTaskbarToggles(context);
        this._initMonitorToggles(context);
    }

    public destroy(): void {
        this._cleanupFns.splice(0).forEach((cleanup) => {
            cleanup();
        });
        this._observers.splice(0).forEach((observer) => {
            observer.disconnect();
        });

        const taskbar = document.getElementById('taskbar-toggles');
        const monitors = document.getElementById('monitor-toggles');
        if (taskbar !== null) {
            delete taskbar.dataset['initialized'];
        }
        if (monitors !== null) {
            delete monitors.dataset['initialized'];
        }
    }

    /**
     * Initializes taskbar visibility toggles.
     */
    private _initTaskbarToggles(context: IAppSettingsUIContext) {
        const container = document.getElementById('taskbar-toggles');
        if (!container) {
            tracer.warn('[GeneralSettingsRenderer] #taskbar-toggles not found');
            return;
        }
        if (container.dataset['initialized'] === 'true') {
            tracer.debug('[GeneralSettingsRenderer] #taskbar-toggles already initialized');
            return;
        }
        container.dataset['initialized'] = 'true';
        tracer.info('[GeneralSettingsRenderer] Initializing taskbar toggles');

        const { t } = context;

        const navItems = APP_PAGES.filter((p) => p.inSettings === true);

        const hiddenItems = this._uiSettings.getHiddenNavItems();

        const template = document.getElementById(
            'tpl-taskbar-toggle',
        ) as HTMLTemplateElement | null;
        if (!template) {
            tracer.error('[GeneralSettingsRenderer] template #tpl-taskbar-toggle not found');
            return;
        }

        const fragment = document.createDocumentFragment();

        navItems.forEach((item) => {
            const labelKey = `ui.launcher.settings.toggle_${item.id}`;
            const clone = template.content.cloneNode(true) as DocumentFragment;

            const btn = clone.querySelector('.monitor-toggle-btn');
            if (btn instanceof HTMLElement) {
                if (hiddenItems.includes(item.id)) {
                    btn.classList.remove('active');
                }
                btn.dataset['pageId'] = item.id;
            }

            const useEl = clone.querySelector('use');
            if (useEl) {
                useEl.setAttribute('href', item.icon);
            }

            const labelEl = clone.querySelector('.toggle-label');
            if (labelEl instanceof HTMLElement) {
                labelEl.dataset['i18n'] = labelKey;
                labelEl.textContent = t(labelKey, item.defaultLabel);
            }

            fragment.appendChild(clone);
        });

        container.innerHTML = '';
        container.appendChild(fragment);

        const handleTaskbarClick = (e: Event) => {
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
        };

        container.addEventListener('click', handleTaskbarClick);
        this._cleanupFns.push(() => {
            container.removeEventListener('click', handleTaskbarClick);
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
                this._showElement(navBtn, 'nav-item-hiding');
            }
        } else {
            if (!hiddenItems.includes(pageId)) hiddenItems.push(pageId);
            if (navBtn instanceof HTMLElement) {
                this._hideElement(navBtn, 'nav-item-hiding');
            }
        }
        this._uiSettings.setHiddenNavItems(hiddenItems);
    }

    /**
     * Initializes system monitor toggles.
     */
    private _initMonitorToggles(context: IAppSettingsUIContext) {
        const container = document.getElementById('monitor-toggles');
        if (!container) {
            tracer.warn('[GeneralSettingsRenderer] #monitor-toggles not found');
            return;
        }
        if (container.dataset['initialized'] === 'true') {
            tracer.debug('[GeneralSettingsRenderer] #monitor-toggles already initialized');
            return;
        }
        container.dataset['initialized'] = 'true';
        tracer.info('[GeneralSettingsRenderer] Initializing monitor toggles');
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

        const template = document.getElementById(
            'tpl-monitor-toggle',
        ) as HTMLTemplateElement | null;
        if (!template) {
            tracer.error('[GeneralSettingsRenderer] template #tpl-monitor-toggle not found');
            return;
        }

        const fragment = document.createDocumentFragment();

        monitorItems.forEach((item) => {
            const labelKey = `ui.launcher.settings.monitor_${item.id}`;
            const clone = template.content.cloneNode(true) as DocumentFragment;

            const btn = clone.querySelector('.monitor-toggle-btn');
            if (btn instanceof HTMLElement) {
                if (hiddenMonitors.includes(item.id)) {
                    btn.classList.remove('active');
                }
                btn.dataset['monitorId'] = item.id;
            }

            const useEl = clone.querySelector('use');
            if (useEl) {
                useEl.setAttribute('href', item.icon);
            }

            const labelEl = clone.querySelector('.toggle-label');
            if (labelEl instanceof HTMLElement) {
                labelEl.dataset['i18n'] = labelKey;
                labelEl.textContent = t(labelKey, item.label);
            }

            fragment.appendChild(clone);
        });

        container.innerHTML = '';
        container.appendChild(fragment);

        const handleMonitorClick = (e: Event) => {
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
        };

        container.addEventListener('click', handleMonitorClick);
        this._cleanupFns.push(() => {
            container.removeEventListener('click', handleMonitorClick);
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
            this._updateMonitorPanelVisibility(true);
            this._updateMonitorDivider(true);
            if (el instanceof HTMLElement) {
                this._showElement(el, 'hiding');
            }
        } else {
            if (!hidden.includes(id)) hidden.push(id);
            if (el instanceof HTMLElement) {
                this._hideElement(el, 'hiding', () => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            this._updateMonitorPanelVisibility(true);
                            this._updateMonitorDivider(true);
                        });
                    });
                });
            } else {
                this._updateMonitorPanelVisibility(true);
                this._updateMonitorDivider(true);
            }
        }
        this._uiSettings.setHiddenMonitors(hidden);
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
                this._hideElement(divider, 'hiding');
            } else {
                divider.classList.add('hidden');
            }
        } else if (animate) {
            this._showElement(divider, 'hiding');
        } else {
            divider.classList.remove('hidden');
        }
    }

    private _showElement(element: HTMLElement, transitionClass: string): void {
        element.classList.add(transitionClass);
        element.classList.remove('hidden');

        // Force style flush so the transition starts from the collapsed state.
        element.getBoundingClientRect();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                element.classList.remove(transitionClass);
            });
        });
    }

    private _hideElement(
        element: HTMLElement,
        transitionClass: string,
        onHidden?: () => void,
    ): void {
        if (element.classList.contains('hidden')) {
            return;
        }

        const finalize = () => {
            element.classList.add('hidden');
            element.classList.remove(transitionClass);
            onHidden?.();
        };

        const handleTransitionEnd = (event: TransitionEvent) => {
            if (event.target !== element) {
                return;
            }
            element.removeEventListener('transitionend', handleTransitionEnd);
            globalThis.clearTimeout(fallbackTimer);
            finalize();
        };

        const fallbackTimer = globalThis.setTimeout(() => {
            element.removeEventListener('transitionend', handleTransitionEnd);
            finalize();
        }, 360);

        element.addEventListener('transitionend', handleTransitionEnd, { once: true });
        this._cleanupFns.push(() => {
            globalThis.clearTimeout(fallbackTimer);
            element.removeEventListener('transitionend', handleTransitionEnd);
        });
        element.classList.add(transitionClass);
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
        this._observers.push(ro);
    }
}
