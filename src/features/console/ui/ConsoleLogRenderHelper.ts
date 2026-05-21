import type { ConsoleDisplayLog } from './ConsoleLogPresentationHelper';

type ConsoleLogRenderHelperDeps = {
    emptyStateId: string;
    getEmptyStateText: () => string;
    getNormalizedLevel: (log: ConsoleDisplayLog) => string;
    matchesNormalizedLevel: (level: string) => boolean;
    runtime?: {
        requestAnimationFrame: (callback: FrameRequestCallback) => number;
        setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    };
};

export class ConsoleLogRenderHelper {
    private readonly _runtime: NonNullable<ConsoleLogRenderHelperDeps['runtime']>;

    public constructor(private readonly _deps: ConsoleLogRenderHelperDeps) {
        this._runtime = _deps.runtime ?? {
            requestAnimationFrame: (callback) => globalThis.requestAnimationFrame(callback),
            setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        };
    }

    public createRenderedEntries(logs: ConsoleDisplayLog[]): HTMLElement[] {
        return logs.map((log) => this._createLogEntryElement(log));
    }

    public createEmptyState(): HTMLElement {
        const state = document.createElement('div');
        state.id = this._deps.emptyStateId;
        state.className = 'console-empty-state';
        state.textContent = this._deps.getEmptyStateText();
        return state;
    }

    public applyFiltersToPane(pane: HTMLElement, entries: HTMLElement[]): void {
        const visibleEntries = entries.filter((entry) =>
            this._deps.matchesNormalizedLevel(entry.dataset['level'] ?? 'ALL'),
        );

        if (visibleEntries.length === 0) {
            pane.replaceChildren(this.createEmptyState());
            return;
        }

        pane.replaceChildren(...visibleEntries);
    }

    public scrollLogsToBottom(container: HTMLElement): void {
        const scrollToBottom = () => {
            container.scrollTop = container.scrollHeight;
        };

        scrollToBottom();
        this._runtime.requestAnimationFrame(scrollToBottom);
        this._runtime.setTimeout(scrollToBottom, 80);
    }

    private _createLogEntryElement(log: ConsoleDisplayLog): HTMLDivElement {
        const container = document.createElement('div');
        const summary = document.createElement('div');
        const shouldHideSource = this._shouldHideSourceLabel(log);
        const normalizedLevel = this._deps.getNormalizedLevel(log);

        container.className = 'log-entry-card';
        container.dataset['level'] = normalizedLevel;
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

    private _createSpan(className: string, text: string): HTMLSpanElement {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
    }

    private _formatTimestamp(timestamp: number | undefined): string {
        if (typeof timestamp !== 'number' || Number.isFinite(timestamp) === false) {
            return '--:--:--';
        }

        return new Date(timestamp * 1000).toLocaleTimeString();
    }
}
