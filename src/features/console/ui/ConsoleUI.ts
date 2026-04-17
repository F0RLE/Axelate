import { invoke } from '@tauri-apps/api/core';
import {
    type ConsoleLogService,
    type IConsoleLogView,
    type ILogEntry,
} from '../services/ConsoleLogService';
import { eventBus } from '@/shared/services/EventBus';

type ConsoleFilterLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

type ParsedLogMessage = {
    time: string | null;
    level: string | null;
    scope: string | null;
    message: string;
};

type ConsoleContextItem = {
    label: string;
    value: string;
};

type ConsoleDisplayLog = {
    key: string;
    sourceLabel: string;
    sourceClass: string;
    parsed: ParsedLogMessage;
    summaryMessage: string;
    count: number;
    moduleId: string | null;
    contextItems: ConsoleContextItem[];
    fixHints: string[];
    rawLogs: ILogEntry[];
    searchText: string;
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

    private pollInterval: number | null = null;
    private unsubscribers: (() => void)[] = [];
    private _isInitialized = false;
    private _hasRenderedLogs = false;
    private _activeViewId = 'general';
    private _dropzoneResetTimeout: ReturnType<typeof setTimeout> | null = null;
    private _pageChangeUnsub: (() => void) | null = null;
    private readonly _activeLevels = new Set<ConsoleFilterLevel>(ConsoleUI._FILTER_LEVELS);
    private readonly _previousSetDebugTab = globalThis.setDebugTab;
    private readonly _previousSetLogView = globalThis.setLogView;
    private readonly _previousClearLogs = globalThis.clearLogs;
    private readonly _boundSetDebugTab = (tabId: string, btn: HTMLElement) => {
        this.setTab(tabId, btn);
    };
    private readonly _boundSetLogView = (view: string, btn: HTMLElement) => {
        this.setLogView(view, btn);
    };
    private readonly _boundClearLogs = () => this.clearLogs();

    constructor(private readonly service: ConsoleLogService) {}

    public init(): void {
        if (this._isInitialized) return;
        this._isInitialized = true;

        void this.service.init();
        this.bindSliders();
        this.bindDraggable();
        this.bindDropzone();
        this.bindTabs();
        this.bindLogControls();
        this.startLogPolling();
        void this.refreshLogViews();
        this._pageChangeUnsub = eventBus.on('page:change', (data) => {
            if (data.pageId === 'console') {
                void this._refreshLogsOnConsoleOpen();
            }
        });

        globalThis.setDebugTab = this._boundSetDebugTab;
        globalThis.setLogView = this._boundSetLogView;
        globalThis.clearLogs = this._boundClearLogs;
    }

    private bindSliders(): void {
        this._bindSlider('.debug-slider-1', '.debug-slider-1-value');
        this._bindSlider('.debug-slider-animated', '.debug-slider-value');
        this._bindSlider('.debug-slider-3', '.debug-slider-3-value');
    }

    private _bindSlider(sliderSelector: string, valueSelector: string): void {
        const slider = document.querySelector(sliderSelector);
        const valueElement = document.querySelector(valueSelector);
        if (!(slider instanceof HTMLElement) || !(valueElement instanceof HTMLElement)) {
            return;
        }

        const handleInput = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }

            valueElement.textContent = `${target.value}%`;
        };

        slider.addEventListener('input', handleInput);
        this.unsubscribers.push(() => {
            slider.removeEventListener('input', handleInput);
        });
    }

    private bindDraggable(): void {
        const draggable = document.querySelector('.debug-draggable');
        if (!(draggable instanceof HTMLElement)) return;

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialX = 0;
        let initialY = 0;

        const handleMouseDown = (e: MouseEvent) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = draggable.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            draggable.style.position = 'fixed';
            draggable.style.zIndex = '10000';
            draggable.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            e.preventDefault();
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            draggable.style.left = `${String(initialX + dx)}px`;
            draggable.style.top = `${String(initialY + dy)}px`;
        };

        const handleMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            draggable.style.cursor = 'move';
        };

        draggable.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        this.unsubscribers.push(() => {
            draggable.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        });
    }

    private bindDropzone(): void {
        const dropzone = document.querySelector('.debug-dropzone');
        if (!(dropzone instanceof HTMLElement)) return;

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            dropzone.classList.add('drag-over');
        };

        const handleDragLeave = () => {
            dropzone.classList.remove('drag-over');
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            dropzone.textContent = this._translate('ui.debug.drag_drop.dragged', 'Item dragged!');

            if (this._dropzoneResetTimeout !== null) {
                clearTimeout(this._dropzoneResetTimeout);
            }

            this._dropzoneResetTimeout = setTimeout(() => {
                dropzone.textContent = this._translate('ui.debug.drag_drop.drop_here', 'Drop here');
                this._dropzoneResetTimeout = null;
            }, 2000);
        };

        dropzone.addEventListener('dragover', handleDragOver);
        dropzone.addEventListener('dragleave', handleDragLeave);
        dropzone.addEventListener('drop', handleDrop);

        this.unsubscribers.push(() => {
            dropzone.removeEventListener('dragover', handleDragOver);
            dropzone.removeEventListener('dragleave', handleDragLeave);
            dropzone.removeEventListener('drop', handleDrop);
        });
    }

    private bindTabs(): void {
        const toolbar = document.querySelector('.console-toolbar-left');
        if (!(toolbar instanceof HTMLElement)) {
            return;
        }

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

    private bindLogControls(): void {
        const controls = document.querySelector('.console-toolbar-right');
        if (!(controls instanceof HTMLElement)) {
            return;
        }

        const handleFilterToggle = (button: HTMLButtonElement) => {
            const level = button.dataset['level'] as ConsoleFilterLevel | undefined;
            if (level === undefined) {
                return;
            }

            if (this._activeLevels.has(level)) {
                if (this._activeLevels.size === 1) {
                    return;
                }
                this._activeLevels.delete(level);
            } else {
                this._activeLevels.add(level);
            }

            this._syncFilterButtons();
            this.renderLogs(true);
        };

        const handleClick = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            const clearButton = target.closest('#clear-logs-btn');
            if (clearButton instanceof HTMLButtonElement) {
                void this.clearLogs();
                return;
            }

            const copyButton = target.closest('#copy-logs-btn');
            if (copyButton instanceof HTMLButtonElement) {
                void this.copyLogs();
                return;
            }

            const filterButton = target.closest('.console-filter-chip');
            if (filterButton instanceof HTMLButtonElement) {
                handleFilterToggle(filterButton);
            }
        };

        controls.addEventListener('click', handleClick);
        this._syncFilterButtons();

        this.unsubscribers.push(() => {
            controls.removeEventListener('click', handleClick);
        });
    }

    private setLogView(view: string, btn: HTMLElement): void {
        this._activeViewId = view;
        this._activateTab('.console-tab', '.logs-pane', `logs-${view}`, btn);
        this._syncLogPanes();
        this.renderLogs(true);
    }

    public async clearLogs(): Promise<void> {
        await this.service.clearLogs();
        this.renderLogs(true);

        if (typeof globalThis.showToast === 'function') {
            globalThis.showToast(
                this._translate('ui.debug.logs_cleared', 'Logs cleared'),
                'success',
                1500,
            );
        }
    }

    public async copyLogs(): Promise<void> {
        const logs = this.service.getLogsForView(this._activeViewId);
        const text = this._buildClipboardText(logs);

        if (text.length === 0) {
            this._showToast('ui.debug.logs_empty', 'No logs to copy', 'warning', 1500);
            return;
        }

        try {
            await this._writeTextToClipboard(text);
            this._showToast('ui.debug.logs_copied', 'Logs copied', 'success', 1500);
        } catch {
            this._showToast('ui.debug.logs_copy_failed', 'Failed to copy logs', 'error', 1800);
        }
    }

    private async _writeTextToClipboard(text: string): Promise<void> {
        const isTauri = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
        if (isTauri === undefined) {
            await this._copyWithBrowserApi(text);
            return;
        }

        try {
            await invoke('plugin:clipboard-manager|write_text', { text });
        } catch {
            await this._copyWithBrowserApi(text);
        }
    }

    private async _copyWithBrowserApi(text: string): Promise<void> {
        if (typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return;
        }

        throw new Error('Clipboard API is unavailable');
    }

    private _showToast(
        key: string,
        fallback: string,
        type: 'success' | 'error' | 'warning',
        duration: number,
    ): void {
        if (typeof globalThis.showToast !== 'function') {
            return;
        }

        globalThis.showToast(this._translate(key, fallback), type, duration);
    }

    public destroy(): void {
        if (!this._isInitialized) return;
        this._isInitialized = false;

        if (this.pollInterval !== null) {
            globalThis.clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this._pageChangeUnsub?.();
        this._pageChangeUnsub = null;
        this._hasRenderedLogs = false;
        this.service.destroy();

        if (this._dropzoneResetTimeout !== null) {
            clearTimeout(this._dropzoneResetTimeout);
            this._dropzoneResetTimeout = null;
        }

        this.unsubscribers.forEach((fn) => {
            fn();
        });
        this.unsubscribers = [];
        if (globalThis.setDebugTab === this._boundSetDebugTab) {
            globalThis.setDebugTab = this._previousSetDebugTab;
        }
        if (globalThis.setLogView === this._boundSetLogView) {
            globalThis.setLogView = this._previousSetLogView;
        }
        if (globalThis.clearLogs === this._boundClearLogs) {
            globalThis.clearLogs = this._previousClearLogs;
        }
    }

    private startLogPolling(): void {
        if (this.pollInterval !== null) {
            globalThis.clearInterval(this.pollInterval);
        }

        this.pollInterval = globalThis.setInterval(() => {
            const consolePage = document.getElementById('page-console');
            if (consolePage?.classList.contains('active') !== true) return;

            void (async () => {
                const newLogs = await this.service.fetchLogs();
                const viewsChanged = await this.refreshLogViews();
                if (viewsChanged || newLogs.length > 0) {
                    this.renderLogs();
                }
            })();
        }, 2000) as unknown as number;
    }

    private async _refreshLogsOnConsoleOpen(): Promise<void> {
        await this.service.fetchLogs();
        await this.refreshLogViews();
        this.renderLogs(true);
    }

    private async refreshLogViews(): Promise<boolean> {
        const toolbar = document.querySelector('.console-toolbar-left');
        const logsRoot = document.getElementById('logs');
        if (!(toolbar instanceof HTMLElement) || !(logsRoot instanceof HTMLElement)) {
            return false;
        }

        const views = await this.service.getAvailableViews();
        const knownViewIds = new Set(views.map((view) => view.id));
        if (!knownViewIds.has(this._activeViewId)) {
            this._activeViewId = 'general';
        }

        if (!this._shouldRebuildViews(toolbar, views)) {
            this._syncLogPanes();
            return false;
        }

        this._replaceChildren(
            toolbar,
            views.map((view) => this._createViewButton(view)),
        );
        this._replaceChildren(
            logsRoot,
            views.map((view) => this._createLogPane(view)),
        );
        this._syncLogPanes();
        return true;
    }

    private _createViewButton(view: IConsoleLogView): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'console-tab';
        button.dataset['view'] = view.id;
        button.textContent = view.label;
        if (view.id === this._activeViewId) {
            button.classList.add('active');
        }
        return button;
    }

    private _createLogPane(view: IConsoleLogView): HTMLDivElement {
        const pane = document.createElement('div');
        pane.id = `logs-${view.id}`;
        pane.className = 'logs-pane';
        if (view.id === this._activeViewId) {
            pane.classList.add('active');
        }
        return pane;
    }

    private _replaceChildren(container: HTMLElement, children: HTMLElement[]): void {
        container.replaceChildren(...children);
    }

    private _syncLogPanes(): void {
        document.querySelectorAll<HTMLElement>('.logs-pane').forEach((pane) => {
            const isActive = pane.id === `logs-${this._activeViewId}`;
            pane.classList.toggle('active', isActive);
            pane.hidden = !isActive;
        });
    }

    private _shouldRebuildViews(toolbar: HTMLElement, views: IConsoleLogView[]): boolean {
        const currentButtons = Array.from(toolbar.querySelectorAll<HTMLElement>('.console-tab'));
        if (currentButtons.length !== views.length) {
            return true;
        }

        return currentButtons.some((button, index) => {
            const view = views[index];
            return button.dataset['view'] !== view?.id || button.textContent !== view?.label;
        });
    }

    private renderLogs(clear = false): void {
        const scrollContainer = document.getElementById('console-container');
        const pane = document.getElementById(`logs-${this._activeViewId}`);
        if (!(scrollContainer instanceof HTMLElement) || !(pane instanceof HTMLElement)) return;

        const isInitialRender = this._hasRenderedLogs === false;
        const wasNearBottom =
            scrollContainer.scrollHeight -
                scrollContainer.scrollTop -
                scrollContainer.clientHeight <
            40;
        const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop;

        this._syncLogPanes();
        document.querySelectorAll<HTMLElement>('.logs-pane').forEach((logsPane) => {
            if (logsPane !== pane) {
                logsPane.replaceChildren();
            }
        });

        if (clear) {
            pane.replaceChildren();
        }

        const rawLogs = this.service.getLogsForView(this._activeViewId);
        const groupedLogs = this._buildDisplayLogs(rawLogs);
        const filteredLogs = this._filterDisplayLogs(groupedLogs);

        if (filteredLogs.length === 0) {
            pane.replaceChildren(this._createEmptyState());
        } else {
            pane.replaceChildren(...filteredLogs.map((log) => this._createLogEntryElement(log)));
        }

        if (isInitialRender || clear || wasNearBottom) {
            this._scrollLogsToBottom(scrollContainer);
        } else {
            scrollContainer.scrollTop = Math.max(
                0,
                scrollContainer.scrollHeight - distanceFromBottom,
            );
        }
        this._hasRenderedLogs = true;
    }

    private _buildClipboardText(logs: ILogEntry[]): string {
        return this._filterDisplayLogs(this._buildDisplayLogs(logs))
            .map((log) => this._formatClipboardLine(log))
            .filter(Boolean)
            .join('\n');
    }

    private _buildDisplayLogs(logs: ILogEntry[]): ConsoleDisplayLog[] {
        const grouped: Array<{
            key: string;
            parsed: ParsedLogMessage;
            logs: ILogEntry[];
            startIndex: number;
        }> = [];

        logs.forEach((log, index) => {
            const parsed = this._parseLogMessage(log);
            if (this._isDisplayNoise(parsed)) {
                return;
            }
            const dedupeKey = this._getDedupeKey(log, parsed);
            const previous = grouped.at(-1);
            if (previous?.key === dedupeKey) {
                previous.logs.push(log);
                return;
            }

            grouped.push({
                key: dedupeKey,
                parsed,
                logs: [log],
                startIndex: index,
            });
        });

        return grouped.map((group, index) =>
            this._finalizeDisplayLog(
                group.key,
                group.parsed,
                group.logs,
                group.startIndex,
                logs,
                index,
            ),
        );
    }

    private _getDedupeKey(log: ILogEntry, parsed: ParsedLogMessage): string {
        const summary = this._buildSummaryMessage(parsed);
        if (this._shouldDedupeAcrossSources(parsed)) {
            return ['semantic', this._normalizeLogLevel(log.level) ?? '', summary].join('::');
        }

        return [
            log.source,
            this._normalizeLogLevel(log.level) ?? '',
            parsed.scope ?? '',
            summary,
        ].join('::');
    }

    private _finalizeDisplayLog(
        key: string,
        parsed: ParsedLogMessage,
        groupedLogs: ILogEntry[],
        startIndex: number,
        allLogs: ILogEntry[],
        order: number,
    ): ConsoleDisplayLog {
        const firstLog = groupedLogs[0];
        const source = this._normalizeLogSource(firstLog?.source ?? '');
        const moduleId = this._inferModuleId(groupedLogs, allLogs, startIndex);
        const contextItems = this._buildContextItems(groupedLogs, parsed, moduleId);
        const fixHints = this._buildFixHints(parsed, contextItems);
        const summaryMessage = this._buildSummaryMessage(parsed);

        const searchParts = [
            firstLog?.source ?? '',
            parsed.scope ?? '',
            summaryMessage,
            ...contextItems.map((item) => `${item.label} ${item.value}`),
            ...fixHints,
        ];

        return {
            key: `${key}:${order.toString()}`,
            sourceLabel: this._formatLogSource(source, firstLog?.source ?? ''),
            sourceClass:
                (firstLog?.source ?? '').startsWith('module:') === true
                    ? 'src-MODULE'
                    : `src-${source}`,
            parsed,
            summaryMessage,
            count: groupedLogs.length,
            moduleId,
            contextItems,
            fixHints,
            rawLogs: groupedLogs,
            searchText: searchParts.join(' ').toLowerCase(),
        };
    }

    private _formatClipboardLine(log: ConsoleDisplayLog): string {
        const parts = [log.summaryMessage];

        const page = log.contextItems.find((item) => item.label === 'Page')?.value;
        const moduleId = log.contextItems.find((item) => item.label === 'Module')?.value;
        const expected = log.contextItems.find((item) => item.label === 'Expected')?.value;
        const action = log.contextItems.find((item) => item.label === 'Action')?.value;

        if (page !== undefined && page !== '' && log.summaryMessage.includes(page) === false) {
            parts.push(`page=${page}`);
        }
        if (
            moduleId !== undefined &&
            moduleId !== '' &&
            log.summaryMessage.includes(moduleId) === false
        ) {
            parts.push(`module=${moduleId}`);
        }
        if (action !== undefined && action !== '') {
            parts.push(`action=${action}`);
        }
        if (expected !== undefined && expected !== '') {
            parts.push(`expected=${expected}`);
        }
        if (log.count > 1) {
            parts.push(`x${log.count.toString()}`);
        }

        return parts.join(' | ');
    }

    private _createLogEntryElement(log: ConsoleDisplayLog): HTMLDivElement {
        const container = document.createElement('div');
        const summary = document.createElement('div');
        const shouldHideSource = this._shouldHideSourceLabel(log);

        container.className = 'log-entry-card';
        summary.className = `log-entry level-${log.parsed.level ?? 'INFO'}`;
        summary.appendChild(
            this._createSpan(
                'log-time',
                log.parsed.time ?? this._formatTimestamp(log.rawLogs[0]?.timestamp),
            ),
        );
        if (shouldHideSource) {
            summary.classList.add('log-entry-no-source');
        } else {
            summary.appendChild(this._createSpan(`log-src ${log.sourceClass}`, log.sourceLabel));
        }
        if (log.parsed.level !== null) {
            summary.appendChild(
                this._createSpan(`log-level level-${log.parsed.level}`, log.parsed.level),
            );
        } else {
            summary.classList.add('log-entry-no-level');
        }
        if (log.parsed.scope !== null) {
            summary.appendChild(this._createSpan('log-scope', log.parsed.scope));
        } else {
            summary.classList.add('log-entry-no-scope');
        }

        const message = document.createElement('span');
        message.className = 'log-msg';
        message.textContent = log.summaryMessage;
        if (log.count > 1) {
            message.appendChild(this._createCountBadge(log.count));
        }
        summary.appendChild(message);

        container.append(summary);
        return container;
    }

    private _shouldHideSourceLabel(log: ConsoleDisplayLog): boolean {
        const source = (log.rawLogs[0]?.source ?? '').trim().toLowerCase();
        return ['frontend', 'backend', 'system', 'api-gateway'].includes(source);
    }

    private _createCountBadge(count: number): HTMLElement {
        const badge = document.createElement('span');
        badge.className = 'log-count-badge';
        badge.textContent = `x${count.toString()}`;
        return badge;
    }

    private _createEmptyState(): HTMLElement {
        const state = document.createElement('div');
        state.className = 'console-empty-state';
        state.textContent =
            this._activeLevels.size === ConsoleUI._FILTER_LEVELS.length
                ? 'No logs yet'
                : 'No logs match selected levels';
        return state;
    }

    private _filterDisplayLogs(logs: ConsoleDisplayLog[]): ConsoleDisplayLog[] {
        return logs.filter((log) => this._matchesLevelFilter(log));
    }

    private _matchesLevelFilter(log: ConsoleDisplayLog): boolean {
        const level = log.parsed.level ?? this._normalizeLogLevel(log.rawLogs[0]?.level ?? '');
        if (level === null) {
            return true;
        }

        return ConsoleUI._FILTER_LEVELS.some(
            (filterLevel) =>
                this._activeLevels.has(filterLevel) &&
                ConsoleUI._FILTER_LEVEL_MAP[filterLevel].includes(level),
        );
    }

    private _isDisplayNoise(parsed: ParsedLogMessage): boolean {
        const message = parsed.message.trim();
        return [
            /Pushed back action:/i,
            /Removed back action:/i,
            /Executing back action:/i,
            /Executing forward action:/i,
            /Cleared forward actions stack/i,
        ].some((pattern) => pattern.test(message));
    }

    private _shouldDedupeAcrossSources(parsed: ParsedLogMessage): boolean {
        const message = parsed.message.trim();
        return [
            /Navigating to:/i,
            /Navigating back to:/i,
            /Navigating forward to:/i,
            /Restored last page:/i,
            /^nav\s*->/i,
        ].some((pattern) => pattern.test(message));
    }

    private _parseLogMessage(log: ILogEntry): ParsedLogMessage {
        const rawMessage = String(log.message).trim();
        const withLevelMatch = rawMessage.match(
            /^(?:(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+)?\[(TRACE|DEBUG|INFO|WARN|WARNING|ERROR)\]\s+([^:]+):\s+([\s\S]+)$/i,
        );
        if (withLevelMatch !== null) {
            const rawTime = withLevelMatch[1] ?? null;
            const rawLevel = withLevelMatch[2] ?? log.level;
            const rawScope = withLevelMatch[3] ?? '';
            const rawBody = withLevelMatch[4] ?? rawMessage;
            return {
                time: rawTime !== null && rawTime.trim() !== '' ? rawTime.slice(11) : null,
                level: this._normalizeLogLevel(rawLevel),
                scope: rawScope.trim(),
                message: rawBody.trim(),
            };
        }

        const scopedMatch = rawMessage.match(/^\[([^\]]+)\]\s+([\s\S]+)$/);
        if (scopedMatch !== null) {
            return {
                time: null,
                level: this._normalizeLogLevel(log.level),
                scope: scopedMatch[1]?.trim() ?? null,
                message: scopedMatch[2]?.trim() ?? rawMessage,
            };
        }

        return {
            time: null,
            level: this._normalizeLogLevel(log.level),
            scope: null,
            message: rawMessage,
        };
    }

    private _normalizeLogLevel(level: string): string | null {
        const normalized = (level || '').trim().toUpperCase();
        if (normalized === '') {
            return null;
        }
        if (normalized === 'WARNING') {
            return 'WARN';
        }
        return normalized;
    }

    private _normalizeLogSource(source: string): string {
        return (source || '')
            .trim()
            .replaceAll(/[^a-z0-9_]/gi, '')
            .toUpperCase();
    }

    private _formatSourcePart(part: string): string {
        const normalized = part.trim().toLowerCase();
        if (normalized === '') {
            return '';
        }

        const knownLabels: Readonly<Record<string, string>> = {
            ai: 'AI',
            api: 'API',
            bot: 'Bot',
            cpu: 'CPU',
            frontend: 'Frontend',
            gpu: 'GPU',
            llm: 'LLM',
            ram: 'RAM',
            sd: 'SD',
            system: 'System',
            ui: 'UI',
            vram: 'VRAM',
        };

        return (
            knownLabels[normalized] ?? `${normalized[0]?.toUpperCase() ?? ''}${normalized.slice(1)}`
        );
    }

    private _formatLogSource(normalizedSource: string, originalSource: string): string {
        const source = (originalSource || '').trim();
        if (source.startsWith('module:')) {
            return source
                .slice('module:'.length)
                .replace(/^axelate-/, '')
                .split('-')
                .filter(Boolean)
                .map((part) => this._formatSourcePart(part))
                .join(' ');
        }

        const labelSource = source !== '' ? source : normalizedSource.toLowerCase();
        return labelSource
            .replace(/^axelate-/, '')
            .split(/[:._-]+/)
            .filter(Boolean)
            .map((part) => this._formatSourcePart(part))
            .join(' ');
    }

    private _buildSummaryMessage(parsed: ParsedLogMessage): string {
        const message = parsed.message.trim();
        if (/manifest not found/i.test(message)) {
            return 'Manifest not found';
        }

        const pageOpenMatch = message.match(/Navigating to:\s*([a-z0-9._-]+)/i);
        if (pageOpenMatch !== null) {
            return `Page ${pageOpenMatch[1] ?? ''}`.trim();
        }

        const pageBackMatch = message.match(/Navigating back to:\s*([a-z0-9._-]+)/i);
        if (pageBackMatch !== null) {
            return `Back to ${pageBackMatch[1] ?? ''}`.trim();
        }

        const pageForwardMatch = message.match(/Navigating forward to:\s*([a-z0-9._-]+)/i);
        if (pageForwardMatch !== null) {
            return `Forward to ${pageForwardMatch[1] ?? ''}`.trim();
        }

        const pageRestoreMatch = message.match(/Restored last page:\s*([a-z0-9._-]+)/i);
        if (pageRestoreMatch !== null) {
            return `Restore page ${pageRestoreMatch[1] ?? ''}`.trim();
        }

        const navUiMatch = message.match(/^nav\s*->\s*([a-z0-9._-]+)/i);
        if (navUiMatch !== null) {
            return `Page ${navUiMatch[1] ?? ''}`.trim();
        }

        const providerStartMatch = message.match(/Starting provider:\s*([a-z0-9._-]+)/i);
        if (providerStartMatch !== null) {
            return `Start provider ${providerStartMatch[1] ?? ''}`.trim();
        }

        const providerSwitchMatch = message.match(/Switching provider to:\s*([a-z0-9._-]+)/i);
        if (providerSwitchMatch !== null) {
            return `Switch provider ${providerSwitchMatch[1] ?? ''}`.trim();
        }

        const providerStopMatch = message.match(
            /Requesting stop for local module:\s*([a-z0-9._-]+)/i,
        );
        if (providerStopMatch !== null) {
            return `Stop provider ${providerStopMatch[1] ?? ''}`.trim();
        }

        const launchMatch = message.match(/Launching App:\s*([a-z0-9._-]+)/i);
        if (launchMatch !== null) {
            return `Launch app ${launchMatch[1] ?? ''}`.trim();
        }

        const controlMatch = message.match(/Control\s+([a-z0-9._-]+)\s+->\s+([a-z]+)/i);
        if (controlMatch !== null) {
            return `Module ${controlMatch[1] ?? ''}: ${controlMatch[2] ?? ''}`.trim();
        }

        return message.replace(/^Control failed:\s*Error:\s*/i, '').trim();
    }

    private _inferModuleId(
        groupedLogs: readonly ILogEntry[],
        allLogs: readonly ILogEntry[],
        startIndex: number,
    ): string | null {
        const fromView = this._activeViewId.startsWith('module:')
            ? this._activeViewId.slice('module:'.length)
            : this._activeViewId !== 'general'
              ? this._activeViewId
              : null;
        if (fromView !== null) {
            return fromView;
        }

        for (const log of groupedLogs) {
            const fromSource = this._moduleIdFromSource(log.source);
            if (fromSource !== null) {
                return fromSource;
            }

            const fromText = this._resolveModuleIdFromText(log.message);
            if (fromText !== null) {
                return fromText;
            }
        }

        for (let cursor = startIndex - 1; cursor >= Math.max(0, startIndex - 6); cursor -= 1) {
            const candidate = allLogs[cursor];
            if (candidate === undefined) {
                continue;
            }

            const fromSource = this._moduleIdFromSource(candidate.source);
            if (fromSource !== null) {
                return fromSource;
            }

            const fromText = this._resolveModuleIdFromText(candidate.message);
            if (fromText !== null) {
                return fromText;
            }
        }

        return null;
    }

    private _moduleIdFromSource(source: string): string | null {
        return source.startsWith('module:') ? source.slice('module:'.length) : null;
    }

    private _resolveModuleIdFromText(message: string): string | null {
        const patterns = [
            /Control\s+([a-z0-9._-]+)\s+->/i,
            /Launching App:\s+([a-z0-9._-]+)/i,
            /Starting provider:\s+([a-z0-9._-]+)/i,
            /Switching provider to:\s+([a-z0-9._-]+)/i,
            /Requesting stop for local module:\s+([a-z0-9._-]+)/i,
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            const moduleId = match?.[1]?.trim();
            if (moduleId !== undefined && moduleId !== '') {
                return moduleId;
            }
        }

        return null;
    }

    private _buildContextItems(
        groupedLogs: readonly ILogEntry[],
        parsed: ParsedLogMessage,
        moduleId: string | null,
    ): ConsoleContextItem[] {
        const items: ConsoleContextItem[] = [];
        const rawMessage = groupedLogs[0]?.message ?? parsed.message;
        const controlMatch = rawMessage.match(/Control\s+([a-z0-9._-]+)\s+->\s+([a-z]+)/i);
        const expectedMatch = rawMessage.match(/Expected\s+(.+)$/i);
        const pageMatch =
            rawMessage.match(/Navigating to:\s*([a-z0-9._-]+)/i) ??
            rawMessage.match(/Navigating back to:\s*([a-z0-9._-]+)/i) ??
            rawMessage.match(/Navigating forward to:\s*([a-z0-9._-]+)/i) ??
            rawMessage.match(/Restored last page:\s*([a-z0-9._-]+)/i) ??
            rawMessage.match(/^nav\s*->\s*([a-z0-9._-]+)/i);

        if (moduleId !== null) {
            items.push({ label: 'Module', value: moduleId });
        }

        if (pageMatch !== null) {
            items.push({ label: 'Page', value: pageMatch[1] ?? '' });
        }

        if (controlMatch !== null) {
            items.push({ label: 'Action', value: controlMatch[2] ?? '' });
        }

        if (expectedMatch !== null) {
            items.push({
                label: 'Expected',
                value: expectedMatch[1]?.replace(/\s+or\s+/gi, ' | ') ?? '',
            });
        }

        if (parsed.scope !== null) {
            items.push({ label: 'Scope', value: parsed.scope });
        }

        return items;
    }

    private _buildFixHints(
        parsed: ParsedLogMessage,
        contextItems: readonly ConsoleContextItem[],
    ): string[] {
        if (!/manifest not found/i.test(parsed.message)) {
            return [];
        }

        const expected =
            contextItems.find((item) => item.label === 'Expected')?.value ??
            'axelate-module.toml | module.json';

        return [
            `Check that the module folder contains ${expected}.`,
            'Verify the module path and module id match the launcher entry.',
            'Reinstall the module if the manifest file was removed or renamed.',
        ];
    }

    private _createSpan(className: string, text: string): HTMLSpanElement {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
    }

    private _activateTab(
        buttonSelector: string,
        paneSelector: string,
        paneId: string,
        button?: HTMLElement,
    ): void {
        document.querySelectorAll(buttonSelector).forEach((element) => {
            element.classList.remove('active');
        });
        document.querySelectorAll(paneSelector).forEach((element) => {
            element.classList.remove('active');
        });

        button?.classList.add('active');
        document.getElementById(paneId)?.classList.add('active');
    }

    private _translate(key: string, fallback: string): string {
        return typeof globalThis.t === 'function' ? globalThis.t(key, fallback) : fallback;
    }

    private _scrollLogsToBottom(container: HTMLElement): void {
        const scrollToBottom = () => {
            container.scrollTop = container.scrollHeight;
        };

        scrollToBottom();
        globalThis.requestAnimationFrame(scrollToBottom);
        globalThis.setTimeout(scrollToBottom, 80);
    }

    private _formatTimestamp(timestamp: number | undefined): string {
        if (typeof timestamp !== 'number' || Number.isFinite(timestamp) === false) {
            return '--:--:--';
        }

        return new Date(timestamp * 1000).toLocaleTimeString();
    }

    private _syncFilterButtons(): void {
        document.querySelectorAll<HTMLButtonElement>('.console-filter-chip').forEach((button) => {
            const level = button.dataset['level'] as ConsoleFilterLevel | undefined;
            const isActive = level !== undefined && this._activeLevels.has(level);
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }
}
