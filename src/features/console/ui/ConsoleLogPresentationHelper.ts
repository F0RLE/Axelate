import type { ILogEntry } from '../services/ConsoleLogService';

export type ParsedLogMessage = {
    time: string | null;
    level: string | null;
    scope: string | null;
    message: string;
};

export type ConsoleContextItem = {
    label: string;
    value: string;
};

export type ConsoleDisplayLog = {
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

type ConsoleLogPresentationHelperDeps = {
    getActiveViewId: () => string;
    matchesNormalizedLevel: (level: string) => boolean;
};

export class ConsoleLogPresentationHelper {
    public constructor(private readonly _deps: ConsoleLogPresentationHelperDeps) {}

    public buildClipboardText(logs: ILogEntry[]): string {
        return this._filterDisplayLogs(this.buildDisplayLogs(logs))
            .map((log) => this._formatClipboardLine(log))
            .filter(Boolean)
            .join('\n');
    }

    public buildDisplayLogs(logs: ILogEntry[]): ConsoleDisplayLog[] {
        const grouped: Array<{
            key: string;
            parsed: ParsedLogMessage;
            logs: ILogEntry[];
            startIndex: number;
        }> = [];

        logs.forEach((log, index) => {
            const parsed = this._parseLogMessage(log);
            const dedupeKey = [
                this._shouldDedupeAcrossSources(log) ? 'semantic' : log.source,
                log.normalized_level ?? '',
                parsed.scope ?? '',
                log.summary_message ?? '',
            ].join('::');
            const previous = grouped.at(-1);
            const previousLogs = previous?.logs;
            if (previous?.key === dedupeKey && previousLogs !== undefined) {
                previousLogs.push(log);
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

    public getNormalizedLevel(log: ConsoleDisplayLog): string {
        return log.parsed.level ?? log.rawLogs[0]?.normalized_level ?? 'ALL';
    }

    private _filterDisplayLogs(logs: ConsoleDisplayLog[]): ConsoleDisplayLog[] {
        return logs.filter((log) =>
            this._deps.matchesNormalizedLevel(this.getNormalizedLevel(log)),
        );
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

    private _finalizeDisplayLog(
        key: string,
        parsed: ParsedLogMessage,
        groupedLogs: ILogEntry[],
        startIndex: number,
        allLogs: ILogEntry[],
        order: number,
    ): ConsoleDisplayLog {
        const firstLog = groupedLogs[0];
        const moduleId = this._inferModuleId(groupedLogs, allLogs, startIndex);
        const contextItems = this._buildContextItems(groupedLogs, parsed, moduleId);
        const fixHints = this._buildFixHints(parsed, contextItems);
        const summaryMessage = firstLog?.summary_message ?? parsed.message;

        const searchParts = [
            firstLog?.source ?? '',
            parsed.scope ?? '',
            summaryMessage,
            ...contextItems.map((item) => `${item.label} ${item.value}`),
            ...fixHints,
        ];

        return {
            key: `${key}:${order.toString()}`,
            sourceLabel: firstLog?.source_label ?? '',
            sourceClass:
                firstLog?.source_class ??
                ((firstLog?.source ?? '').startsWith('module:') === true ? 'src-MODULE' : ''),
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

    private _parseLogMessage(log: ILogEntry): ParsedLogMessage {
        return {
            time: log.display_time ?? null,
            level: log.normalized_level ?? null,
            scope: log.scope ?? null,
            message: String(log.message).trim(),
        };
    }

    private _shouldDedupeAcrossSources(log: ILogEntry): boolean {
        const message = log.message.trim();
        return [
            /Navigating to:/i,
            /Navigating back to:/i,
            /Navigating forward to:/i,
            /Restored last page:/i,
            /^nav\s*->/i,
        ].some((pattern) => pattern.test(message));
    }

    private _inferModuleId(
        groupedLogs: readonly ILogEntry[],
        allLogs: readonly ILogEntry[],
        startIndex: number,
    ): string | null {
        const activeViewId = this._deps.getActiveViewId();
        const fromView = activeViewId.startsWith('module:')
            ? activeViewId.slice('module:'.length)
            : activeViewId !== 'general'
              ? activeViewId
              : null;
        if (fromView !== null) {
            return fromView;
        }

        for (const log of groupedLogs) {
            if (log.module_id !== undefined && log.module_id !== null && log.module_id !== '') {
                return log.module_id;
            }
        }

        for (let cursor = startIndex - 1; cursor >= Math.max(0, startIndex - 6); cursor -= 1) {
            const candidate = allLogs[cursor];
            if (candidate === undefined) {
                continue;
            }

            if (
                candidate.module_id !== undefined &&
                candidate.module_id !== null &&
                candidate.module_id !== ''
            ) {
                return candidate.module_id;
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
        const firstLog = groupedLogs[0];

        if (moduleId !== null) {
            items.push({ label: 'Module', value: moduleId });
        }

        if (firstLog?.page !== undefined && firstLog.page !== null && firstLog.page !== '') {
            items.push({ label: 'Page', value: firstLog.page });
        }

        if (firstLog?.action !== undefined && firstLog.action !== null && firstLog.action !== '') {
            items.push({ label: 'Action', value: firstLog.action });
        }

        if (
            firstLog?.expected !== undefined &&
            firstLog.expected !== null &&
            firstLog.expected !== ''
        ) {
            items.push({ label: 'Expected', value: firstLog.expected });
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
            contextItems.find((item) => item.label === 'Expected')?.value ?? 'axelate-module.toml';

        return [
            `Check that the module folder contains ${expected}.`,
            'Verify the module path and module id match the launcher entry.',
            'Reinstall the module if the manifest file was removed or renamed.',
        ];
    }
}
