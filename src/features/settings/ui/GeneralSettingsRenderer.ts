/**
 * @module settings/ui/GeneralSettingsRenderer
 * @description Specialized renderer for general application settings (taskbar, monitor, etc.)
 */

import { type UISettingsService } from '@/shared/services/ui/UISettingsService';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IAppSettingsUIContext } from './SettingsContext';
import { APP_PAGES } from '@/shared/config/AppPages';

interface IToggleItem {
    id: string;
    label: string;
    icon: string;
}

interface IToggleGroupConfig {
    containerId: string;
    templateId: string;
    dataKey: 'pageId' | 'monitorId';
    hiddenItems: string[];
    items: IToggleItem[];
    getLabelKey: (item: IToggleItem) => string;
    onToggle: (id: string, enabled: boolean) => void;
}

export class GeneralSettingsRenderer {
    private readonly _cleanupFns: Array<() => void> = [];
    private readonly _observers: ResizeObserver[] = [];
    private readonly _resizeFrames = new Map<string, number>();

    private static readonly _monitorItems: IToggleItem[] = [
        { id: 'cpu', label: 'CPU', icon: '#icon-cpu' },
        { id: 'gpu', label: 'GPU', icon: '#icon-gpu' },
        { id: 'ram', label: 'RAM', icon: '#icon-ram' },
        { id: 'vram', label: 'VRAM', icon: '#icon-vram' },
        { id: 'disk', label: 'Disk', icon: '#icon-disk' },
        { id: 'network', label: 'Network', icon: '#icon-network' },
    ];

    private static readonly _monitorGroups = {
        upper: ['cpu', 'gpu', 'ram', 'vram'],
        lower: ['disk', 'network'],
    };

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
        this._resizeFrames.forEach((frameId) => {
            globalThis.cancelAnimationFrame(frameId);
        });
        this._resizeFrames.clear();

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
    private _initTaskbarToggles(context: IAppSettingsUIContext): void {
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

        const hiddenItems = this._uiSettings.getHiddenNavItems();
        const navItems = APP_PAGES.filter((page) => page.inSettings === true).map((page) => ({
            id: page.id,
            label: page.defaultLabel,
            icon: page.icon,
        }));

        this._initToggleGroup(
            {
                containerId: 'taskbar-toggles',
                templateId: 'tpl-taskbar-toggle',
                dataKey: 'pageId',
                hiddenItems,
                items: navItems,
                getLabelKey: (item) => `ui.launcher.settings.toggle_${item.id}`,
                onToggle: (pageId, enabled) => {
                    this.toggleNavItem(pageId, enabled);
                },
            },
            context.t,
        );

        this._applyHiddenState(hiddenItems);
        this._observeToggleGrid('taskbar-toggles');
    }

    /**
     * Applies hidden state to navigation items on startup.
     */
    private _applyHiddenState(hidden: string[]): void {
        hidden.forEach((id) => {
            const button = document.querySelector(`#sidebar .nav-btn[data-page="${id}"]`);
            if (button instanceof HTMLElement) {
                button.classList.add('hidden');
                this._syncHiddenAccessibility(button, false);
            }
        });
    }

    /**
     * Toggles a sidebar navigation item visibility.
     */
    public toggleNavItem(pageId: string, enabled: boolean): void {
        const hiddenItems = this._toggleHiddenItem(
            this._uiSettings.getHiddenNavItems(),
            pageId,
            enabled,
        );
        const navButton = document.querySelector(`#sidebar .nav-btn[data-page="${pageId}"]`);

        if (enabled) {
            if (navButton instanceof HTMLElement) {
                this._showElement(navButton, 'nav-item-hiding');
            }
        } else if (navButton instanceof HTMLElement) {
            this._hideElement(navButton, 'nav-item-hiding');
        }

        this._uiSettings.setHiddenNavItems(hiddenItems);
    }

    /**
     * Initializes system monitor toggles.
     */
    private _initMonitorToggles(context: IAppSettingsUIContext): void {
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

        const hiddenMonitors = this._uiSettings.getHiddenMonitors();

        this._initToggleGroup(
            {
                containerId: 'monitor-toggles',
                templateId: 'tpl-monitor-toggle',
                dataKey: 'monitorId',
                hiddenItems: hiddenMonitors,
                items: GeneralSettingsRenderer._monitorItems,
                getLabelKey: (item) => `ui.launcher.settings.monitor_${item.id}`,
                onToggle: (monitorId, enabled) => {
                    this.toggleMonitorItem(monitorId, enabled);
                },
            },
            context.t,
        );

        hiddenMonitors.forEach((id) => {
            const element = document.querySelector(
                `#system-monitor .sysmon-stat[data-monitor-id="${id}"]`,
            );
            if (element instanceof HTMLElement) {
                element.classList.add('hidden');
            }
        });

        this._updateMonitorPanelVisibility(false);
        this._updateMonitorDivider(false);
        this._observeToggleGrid('monitor-toggles');
    }

    /**
     * Toggles a system monitor visibility.
     */
    public toggleMonitorItem(id: string, enabled: boolean): void {
        const hidden = this._toggleHiddenItem(this._uiSettings.getHiddenMonitors(), id, enabled);
        const element = document.querySelector(`#system-monitor .sysmon-stat[data-monitor-id="${id}"]`);

        if (enabled) {
            this._updateMonitorPanelVisibility(true);
            this._updateMonitorDivider(true);
            if (element instanceof HTMLElement) {
                this._showElement(element, 'hiding');
            }
        } else if (element instanceof HTMLElement) {
            this._hideElement(element, 'hiding', () => {
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

        this._uiSettings.setHiddenMonitors(hidden);
    }

    /**
     * Updates the main monitor panel visibility (hides if all items are hidden).
     */
    private _updateMonitorPanelVisibility(_animate: boolean = true): void {
        const monitorPanel = document.getElementById('system-monitor');
        if (!monitorPanel) return;

        const hiddenMonitors = this._uiSettings.getHiddenMonitors();
        const allHidden = hiddenMonitors.length === GeneralSettingsRenderer._monitorItems.length;

        if (allHidden) {
            monitorPanel.classList.add('adaptive-hidden');
        } else {
            monitorPanel.classList.remove('adaptive-hidden');
        }
    }

    /**
     * Updates the divider visibility in the monitor panel.
     */
    private _updateMonitorDivider(animate: boolean = true): void {
        const divider = document.querySelector('.sysmon-divider');
        if (!(divider instanceof HTMLElement)) return;

        const hiddenMonitors = this._uiSettings.getHiddenMonitors();
        const allAboveHidden = GeneralSettingsRenderer._monitorGroups.upper.every((id) =>
            hiddenMonitors.includes(id),
        );
        const allBelowHidden = GeneralSettingsRenderer._monitorGroups.lower.every((id) =>
            hiddenMonitors.includes(id),
        );
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
        this._syncHiddenAccessibility(element, true);

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
            this._syncHiddenAccessibility(element, false);
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

    private _syncHiddenAccessibility(element: HTMLElement, visible: boolean): void {
        if (!element.classList.contains('nav-btn')) {
            return;
        }

        if (visible) {
            element.removeAttribute('aria-hidden');
            element.removeAttribute('tabindex');
            return;
        }

        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('tabindex', '-1');
    }

    /**
     * Observes a container with a ResizeObserver to apply compact classes.
     */
    private _observeToggleGrid(id: string): void {
        const element = document.getElementById(id);
        if (!element) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                const pendingFrame = this._resizeFrames.get(id);
                if (pendingFrame !== undefined) {
                    globalThis.cancelAnimationFrame(pendingFrame);
                }

                const nextCompact = width < 450;
                const nextSuperCompact = width < 300;
                const frameId = globalThis.requestAnimationFrame(() => {
                    this._resizeFrames.delete(id);
                    element.classList.toggle('compact', nextCompact);
                    element.classList.toggle('super-compact', nextSuperCompact);
                });
                this._resizeFrames.set(id, frameId);
            }
        });

        observer.observe(element);
        this._observers.push(observer);
    }

    private _initToggleGroup(
        config: IToggleGroupConfig,
        translate: IAppSettingsUIContext['t'],
    ): void {
        const container = document.getElementById(config.containerId);
        if (!(container instanceof HTMLElement)) {
            return;
        }

        const template = document.getElementById(config.templateId) as HTMLTemplateElement | null;
        if (template === null) {
            tracer.error(`[GeneralSettingsRenderer] template #${config.templateId} not found`);
            return;
        }

        const fragment = document.createDocumentFragment();
        config.items.forEach((item) => {
            fragment.appendChild(
                this._createToggleItem(
                    template,
                    item,
                    config.hiddenItems,
                    config.dataKey,
                    translate,
                    config.getLabelKey,
                ),
            );
        });

        container.innerHTML = '';
        container.appendChild(fragment);

        const handleClick = (event: Event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const button = target.closest('.monitor-toggle-btn');
            if (!(button instanceof HTMLElement)) return;

            const itemId = button.dataset[config.dataKey];
            if (itemId === undefined || itemId === '') return;

            button.classList.toggle('active');
            config.onToggle(itemId, button.classList.contains('active'));
        };

        container.addEventListener('click', handleClick);
        this._cleanupFns.push(() => {
            container.removeEventListener('click', handleClick);
        });
    }

    private _createToggleItem(
        template: HTMLTemplateElement,
        item: IToggleItem,
        hiddenItems: string[],
        dataKey: IToggleGroupConfig['dataKey'],
        translate: IAppSettingsUIContext['t'],
        getLabelKey: IToggleGroupConfig['getLabelKey'],
    ): DocumentFragment {
        const labelKey = getLabelKey(item);
        const clone = template.content.cloneNode(true) as DocumentFragment;

        const button = clone.querySelector('.monitor-toggle-btn');
        if (button instanceof HTMLElement) {
            if (hiddenItems.includes(item.id)) {
                button.classList.remove('active');
            }
            button.dataset[dataKey] = item.id;
        }

        const useElement = clone.querySelector('use');
        if (useElement !== null) {
            useElement.setAttribute('href', item.icon);
        }

        const labelElement = clone.querySelector('.toggle-label');
        if (labelElement instanceof HTMLElement) {
            labelElement.dataset['i18n'] = labelKey;
            labelElement.textContent = translate(labelKey, item.label);
        }

        return clone;
    }

    private _toggleHiddenItem(items: string[], id: string, enabled: boolean): string[] {
        if (enabled) {
            return items.filter((item) => item !== id);
        }

        if (items.includes(id)) {
            return [...items];
        }

        return [...items, id];
    }
}
