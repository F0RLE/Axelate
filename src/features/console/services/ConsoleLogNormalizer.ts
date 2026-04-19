import type { ILogEntry } from './ConsoleLogService';

export class ConsoleLogNormalizer {
    public normalize(log: ILogEntry): ILogEntry {
        const source = String(log.source);
        const parsed = this._parseMessage(log);
        const summaryMessage = this._buildSummaryMessage(parsed.message);
        const normalizedSource = this._normalizeSource(source);

        return {
            ...log,
            message: parsed.message,
            source,
            module_id: log.module_id ?? this._resolveModuleId(source, parsed.message),
            display_time: parsed.time,
            normalized_level: parsed.level,
            scope: parsed.scope,
            summary_message: summaryMessage,
            source_label: this._formatSourceLabel(normalizedSource, source),
            source_class:
                source.startsWith('module:') === true
                    ? 'src-MODULE'
                    : `src-${normalizedSource}`,
            page: this._extractPage(parsed.message),
            action: this._extractAction(parsed.message),
            expected: this._extractExpected(parsed.message),
        };
    }

    private _parseMessage(log: ILogEntry): {
        time: string | null;
        level: string | null;
        scope: string | null;
        message: string;
    } {
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
                level: this._normalizeLevel(rawLevel),
                scope: rawScope.trim(),
                message: rawBody.trim(),
            };
        }

        const scopedMatch = rawMessage.match(/^\[([^\]]+)\]\s+([\s\S]+)$/);
        if (scopedMatch !== null) {
            return {
                time: null,
                level: this._normalizeLevel(log.level),
                scope: scopedMatch[1]?.trim() ?? null,
                message: scopedMatch[2]?.trim() ?? rawMessage,
            };
        }

        return {
            time: null,
            level: this._normalizeLevel(log.level),
            scope: null,
            message: rawMessage,
        };
    }

    private _normalizeLevel(level: string | undefined): string | null {
        const normalized = (level ?? '').trim().toUpperCase();
        if (normalized === '') {
            return null;
        }
        if (normalized === 'WARNING') {
            return 'WARN';
        }
        return normalized;
    }

    private _normalizeSource(source: string): string {
        return source
            .trim()
            .replaceAll(/[^a-z0-9_]/gi, '')
            .toUpperCase();
    }

    private _formatSourceLabel(normalizedSource: string, originalSource: string): string {
        const source = originalSource.trim();
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

    private _buildSummaryMessage(message: string): string {
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

    private _resolveModuleId(source: string, message: string): string | null {
        if (source.startsWith('module:')) {
            return source.slice('module:'.length);
        }

        const patterns = [
            /Control\s+([a-z0-9._-]+)\s+->/i,
            /Launching App:\s+([a-z0-9._-]+)/i,
            /Starting provider:\s+([a-z0-9._-]+)/i,
            /Switching provider to:\s+([a-z0-9._-]+)/i,
            /Requesting stop for local module:\s+([a-z0-9._-]+)/i,
            /Stopping module:\s+([a-z0-9._-]+)/i,
            /Module\s+([a-z0-9._-]+)\s+successfully\s+stopped/i,
        ];

        for (const pattern of patterns) {
            const moduleId = message.match(pattern)?.[1]?.trim();
            if (moduleId !== undefined && moduleId !== '') {
                return moduleId;
            }
        }

        return null;
    }

    private _extractPage(message: string): string | null {
        const match =
            message.match(/Navigating to:\s*([a-z0-9._-]+)/i) ??
            message.match(/Navigating back to:\s*([a-z0-9._-]+)/i) ??
            message.match(/Navigating forward to:\s*([a-z0-9._-]+)/i) ??
            message.match(/Restored last page:\s*([a-z0-9._-]+)/i) ??
            message.match(/^nav\s*->\s*([a-z0-9._-]+)/i);
        return match?.[1] ?? null;
    }

    private _extractAction(message: string): string | null {
        return message.match(/Control\s+([a-z0-9._-]+)\s+->\s+([a-z]+)/i)?.[2] ?? null;
    }

    private _extractExpected(message: string): string | null {
        const expected = message.match(/Expected\s+(.+)$/i)?.[1]?.replace(/\s+or\s+/gi, ' | ');
        return expected === undefined || expected === '' ? null : expected;
    }
}
