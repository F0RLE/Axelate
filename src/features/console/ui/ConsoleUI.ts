import { type ConsoleLogService } from '../services/ConsoleLogService';
import type { EventBus } from '@/shared/services/EventBus';
import { ConsoleClipboardHelper } from './ConsoleClipboardHelper';
import { ConsoleFilterControlHelper } from './ConsoleFilterControlHelper';
import { ConsoleInteractionHelper } from './ConsoleInteractionHelper';
import { ConsoleLogPresentationHelper } from './ConsoleLogPresentationHelper';
import { ConsoleLogRenderHelper } from './ConsoleLogRenderHelper';
import { ConsoleViewHelper } from './ConsoleViewHelper';
import { ConsolePollingController } from './ConsolePollingController';
import { ConsoleRefreshCoordinator } from './ConsoleRefreshCoordinator';
import { ConsoleViewStateController } from './ConsoleViewStateController';

type ConsoleFilterLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
type ConsoleTranslate = (key: string, fallback: string) => string;
type ConsoleShowToast = (
    message: string,
    type?: 'success' | 'error' | 'warning' | 'info',
    duration?: number,
) => void;
type ConsoleUIDeps = {
    eventBus: EventBus;
    translate: ConsoleTranslate;
    showToast: ConsoleShowToast;
    copyText: (text: string) => Promise<void>;
};

export class ConsoleUI {
    private static readonly _FILTER_LEVELS: readonly ConsoleFilterLevel[] = [
        'ERROR',
        'WARN',
        'INFO',
        'DEBUG',
    ];
    private static readonly _FILTER_LEVEL_MAP: Readonly<
        Record<ConsoleFilterLevel, readonly string[]>
    > = {
        ERROR: ['ERROR'],
        WARN: ['WARN', 'WARNING'],
        INFO: ['INFO'],
        DEBUG: ['DEBUG', 'TRACE'],
    };

    private unsubscribers: (() => void)[] = [];
    private _isInitialized = false;
    private _dropzoneResetTimeout: ReturnType<typeof setTimeout> | null = null;
    private _pageChangeUnsub: (() => void) | null = null;
    private readonly _emptyStateId = 'console-filter-empty-state';
    private readonly _viewState = new ConsoleViewStateController();
    private readonly _interactionHelper: ConsoleInteractionHelper;
    private readonly _clipboardHelper: ConsoleClipboardHelper;
    private readonly _filterControlHelper: ConsoleFilterControlHelper<ConsoleFilterLevel>;
    private readonly _viewHelper = new ConsoleViewHelper();
    private readonly _presentationHelper: ConsoleLogPresentationHelper;
    private readonly _pollingController: ConsolePollingController;
    private readonly _refreshCoordinator: ConsoleRefreshCoordinator;
    private readonly _renderHelper: ConsoleLogRenderHelper;
    private readonly _translateFn: ConsoleTranslate;
    private readonly _showToast: ConsoleShowToast;
    private readonly _eventBus: EventBus;
    private _activeTabButton: HTMLElement | null = null;
    private _activePane: HTMLElement | null = null;

    constructor(
        private readonly service: ConsoleLogService,
        deps: ConsoleUIDeps,
    ) {
        this._eventBus = deps.eventBus;
        this._translateFn = deps.translate;
        this._showToast = deps.showToast;
        this._interactionHelper = new ConsoleInteractionHelper({
            translate: (key, fallback) => this._translate(key, fallback),
            registerCleanup: (cleanup) => {
                this.unsubscribers.push(cleanup);
            },
            getDropzoneResetTimeout: () => this._dropzoneResetTimeout,
            setDropzoneResetTimeout: (timeout) => {
                this._dropzoneResetTimeout = timeout;
            },
        });
        this._clipboardHelper = new ConsoleClipboardHelper({
            translate: (key, fallback) => this._translate(key, fallback),
            showToast: (message, type, duration) => {
                this._showToast(message, type, duration);
            },
            copyText: async (text) => {
                await deps.copyText(text);
            },
        });
        this._filterControlHelper = new ConsoleFilterControlHelper({
            activeLevels: this._viewState.activeLevels,
            registerCleanup: (cleanup) => {
                this.unsubscribers.push(cleanup);
            },
            onClearLogs: () => {
                void this.clearLogs();
            },
            onCopyLogs: () => {
                void this.copyLogs();
            },
            onFiltersChanged: () => {
                this._applyFiltersToActivePane();
            },
        });
        this._presentationHelper = new ConsoleLogPresentationHelper({
            getActiveViewId: () => this._viewState.activeViewId,
            matchesNormalizedLevel: (level) => this._matchesNormalizedLevel(level),
        });
        this._renderHelper = new ConsoleLogRenderHelper({
            emptyStateId: this._emptyStateId,
            getEmptyStateText: () =>
                this._viewState.activeLevels.size === ConsoleUI._FILTER_LEVELS.length
                    ? 'No logs yet'
                    : 'No logs match selected levels',
            getNormalizedLevel: (log) => this._presentationHelper.getNormalizedLevel(log),
            matchesNormalizedLevel: (level) => this._matchesNormalizedLevel(level),
        });
        this._refreshCoordinator = new ConsoleRefreshCoordinator({
            service: this.service,
            refreshLogViews: async () => await this.refreshLogViews(),
            renderLogs: (clear) => {
                this.renderLogs(clear);
            },
        });
        this._pollingController = new ConsolePollingController({
            isConsolePageActive: () => this._isConsolePageActive(),
            poll: () => {
                void this._refreshCoordinator.refreshFromPolling();
            },
        });
    }

    public init(): void {
        if (this._isInitialized) return;
        this._isInitialized = true;

        void this.service.init();
        this._interactionHelper.bindSliders();
        this._interactionHelper.bindDraggable();
        this._interactionHelper.bindDropzone();
        this.bindTabs();
        this._filterControlHelper.bindControls();
        this._syncPollingForActivePage();
        void this.refreshLogViews();
        this._pageChangeUnsub = this._eventBus.on('page:change', (data) => {
            if (data.pageId === 'console') {
                this._syncPollingForActivePage();
                void this._refreshLogsOnConsoleOpen();
                return;
            }

            this._syncPollingForActivePage();
        });
    }

    private bindTabs(): void {
        const toolbar = document.querySelector('.console-toolbar-left');
        if (!(toolbar instanceof HTMLElement)) {
            return;
        }

        this._activeTabButton = toolbar.querySelector<HTMLElement>('.console-tab.active');

        const handleClick = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            const button = target.closest('.console-tab');
            if (!(button instanceof HTMLElement)) {
                return;
            }

            const view = button.dataset['view'];
            if (view !== undefined && view !== '') {
                this.setLogView(view, button);
            }
        };

        toolbar.addEventListener('click', handleClick);
        this.unsubscribers.push(() => {
            toolbar.removeEventListener('click', handleClick);
        });
    }

    public setTab(tabId: string, btn?: HTMLElement): void {
        this._activateTab('.debug-tab', '.debug-tab-content', `debug-${tabId}-tab`, btn);
    }

    private setLogView(view: string, btn: HTMLElement): void {
        this._viewState.activeViewId = view;
        this._activateTab('.console-tab', '.logs-pane', `logs-${view}`, btn);
        this.renderLogs(true);
    }

    public async clearLogs(): Promise<void> {
        await this.service.clearLogs();
        this.renderLogs(true);
        this._clipboardHelper.showLogsCleared();
    }

    public async copyLogs(): Promise<void> {
        const logs = this.service.getLogsForView(this._viewState.activeViewId);
        const text = this._presentationHelper.buildClipboardText(logs);
        await this._clipboardHelper.copyLogsText(text);
    }

    public destroy(): void {
        if (!this._isInitialized) return;
        this._isInitialized = false;

        this._pollingController.stop();

        this._pageChangeUnsub?.();
        this._pageChangeUnsub = null;
        this._viewState.reset();
        this.service.destroy();

        if (this._dropzoneResetTimeout !== null) {
            clearTimeout(this._dropzoneResetTimeout);
            this._dropzoneResetTimeout = null;
        }

        this.unsubscribers.forEach((fn) => {
            fn();
        });
        this.unsubscribers = [];
    }

    private startLogPolling(): void {
        this._pollingController.start(2000);
    }

    private _syncPollingForActivePage(): void {
        if (this._isConsolePageActive()) {
            this.startLogPolling();
            return;
        }

        this._pollingController.stop();
    }

    private async _refreshLogsOnConsoleOpen(): Promise<void> {
        await this._refreshCoordinator.refreshOnOpen();
    }

    private async refreshLogViews(): Promise<boolean> {
        const toolbar = document.querySelector('.console-toolbar-left');
        const logsRoot = document.getElementById('logs');
        if (!(toolbar instanceof HTMLElement) || !(logsRoot instanceof HTMLElement)) {
            return false;
        }

        const views = await this.service.getAvailableViews();
        this._viewState.ensureKnownActiveView(new Set(views.map((view) => view.id)));

        if (!this._viewHelper.shouldRebuildViews(toolbar, views)) {
            this._syncActivePane(`logs-${this._viewState.activeViewId}`);
            return false;
        }

        this._viewHelper.replaceChildren(
            toolbar,
            views.map((view) =>
                this._viewHelper.createViewButton(view, this._viewState.activeViewId),
            ),
        );
        this._viewHelper.replaceChildren(
            logsRoot,
            views.map((view) => this._viewHelper.createLogPane(view, this._viewState.activeViewId)),
        );
        this._activeTabButton = toolbar.querySelector<HTMLElement>('.console-tab.active');
        this._activePane = null;
        this._syncActivePane(`logs-${this._viewState.activeViewId}`);
        return true;
    }

    private renderLogs(clear = false): void {
        const scrollContainer = document.getElementById('console-container');
        const pane = document.getElementById(`logs-${this._viewState.activeViewId}`);
        if (!(scrollContainer instanceof HTMLElement) || !(pane instanceof HTMLElement)) return;

        const renderDecision = this._viewState.captureRenderDecision(scrollContainer, clear);

        this._syncActivePane(pane.id);

        if (clear) {
            pane.replaceChildren();
        }

        const rawLogs = this.service.getLogsForView(this._viewState.activeViewId);
        const groupedLogs = this._presentationHelper.buildDisplayLogs(rawLogs);

        if (groupedLogs.length === 0) {
            this._viewState.clearRenderedEntries(this._viewState.activeViewId);
            pane.replaceChildren(this._renderHelper.createEmptyState());
        } else {
            const renderedEntries = this._renderHelper.createRenderedEntries(groupedLogs);
            this._viewState.setRenderedEntries(this._viewState.activeViewId, renderedEntries);
            this._renderHelper.applyFiltersToPane(pane, renderedEntries);
        }

        if (renderDecision.shouldStickToBottom) {
            this._renderHelper.scrollLogsToBottom(scrollContainer);
        } else {
            scrollContainer.scrollTop = Math.max(
                0,
                scrollContainer.scrollHeight - renderDecision.distanceFromBottom,
            );
        }
        this._viewState.finalizeRender();
    }

    private _activateTab(
        _buttonSelector: string,
        _paneSelector: string,
        paneId: string,
        button?: HTMLElement,
    ): void {
        this._activeTabButton?.classList.remove('active');
        button?.classList.add('active');
        this._activeTabButton = button ?? null;
        this._syncActivePane(paneId);
    }

    private _translate(key: string, fallback: string): string {
        return this._translateFn(key, fallback);
    }

    private _applyFiltersToActivePane(): void {
        const pane = document.getElementById(`logs-${this._viewState.activeViewId}`);
        if (!(pane instanceof HTMLElement)) {
            return;
        }

        const entries = this._viewState.getRenderedEntries(this._viewState.activeViewId);
        this._renderHelper.applyFiltersToPane(pane, entries);
    }

    private _matchesNormalizedLevel(level: string): boolean {
        return ConsoleUI._FILTER_LEVELS.some(
            (filterLevel) =>
                this._viewState.activeLevels.has(filterLevel) &&
                ConsoleUI._FILTER_LEVEL_MAP[filterLevel].includes(level),
        );
    }

    private _isConsolePageActive(): boolean {
        return document.getElementById('page-console')?.classList.contains('active') === true;
    }

    private _syncActivePane(paneId: string): void {
        if (this._activePane?.id === paneId) {
            this._activePane.classList.add('active');
            this._activePane.hidden = false;
            return;
        }

        if (this._activePane instanceof HTMLElement) {
            this._activePane.classList.remove('active');
            this._activePane.hidden = true;
        }

        const nextPane = document.getElementById(paneId);
        if (nextPane instanceof HTMLElement) {
            nextPane.classList.add('active');
            nextPane.hidden = false;
            this._activePane = nextPane;
            return;
        }

        this._activePane = null;
    }
}
