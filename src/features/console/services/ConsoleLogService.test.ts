import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLogService, type ILogEntry } from './ConsoleLogService';
import type { IBridge } from '@/shared/types/IBridge';
import { createMockBridge } from '@/test/mocks/mockBridge';
import * as invokeModule from '@/shared/api/invoke';

function setupTauri(bridge: IBridge, isTauri = true): void {
    vi.mocked(bridge.isTauri).mockReturnValue(isTauri);
}

describe('ConsoleLogService', () => {
    let bridge: IBridge;
    let service: ConsoleLogService;

    beforeEach(() => {
        vi.restoreAllMocks();
        bridge = createMockBridge();
        service = new ConsoleLogService(bridge, {
            warn: vi.fn(),
            error: vi.fn(),
        });
    });

    it('fetches only the requested console view in Tauri mode', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockResolvedValue([
            {
                timestamp: 100,
                source: 'module:axelate-telegram-parser',
                level: 'INFO',
                message: '2026-04-29 14:33:32 [INFO] telegram_parser: started',
                module_id: 'axelate-telegram-parser',
            },
        ] satisfies ILogEntry[]);

        const logs = await service.fetchLogs('module:axelate-telegram-parser');

        expect(bridge.invoke).toHaveBeenCalledWith('get_console_logs', {
            viewId: 'module:axelate-telegram-parser',
            since: 0,
        });
        expect(logs).toEqual([
            expect.objectContaining({
                module_id: 'axelate-telegram-parser',
                message: 'started',
                scope: 'telegram_parser',
            }),
        ]);
        expect(service.getLogsForView('module:axelate-telegram-parser')).toHaveLength(1);
        expect(service.getLogsForView('general')).toEqual([]);
    });

    it('normalizes plain backend timestamp level lines', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockResolvedValue([
            {
                timestamp: 100,
                source: 'backend',
                level: 'INFO',
                message: '2026-05-05 19:21:40 ERROR [ModuleService] Control failed',
            },
            {
                timestamp: 101,
                source: 'backend',
                level: 'INFO',
                message: '2026-05-05 19:21:40 WARN [GlobalBridge] Failed to start local module',
            },
        ] satisfies ILogEntry[]);

        const logs = await service.fetchLogs('general');

        expect(logs).toEqual([
            expect.objectContaining({
                display_time: '19:21:40',
                normalized_level: 'ERROR',
                scope: 'ModuleService',
                message: 'Control failed',
            }),
            expect.objectContaining({
                display_time: '19:21:40',
                normalized_level: 'WARN',
                scope: 'GlobalBridge',
                message: 'Failed to start local module',
            }),
        ]);
    });

    it('tracks timestamps per view without cross-view filtering', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke)
            .mockResolvedValueOnce([
                { timestamp: 10, source: 'frontend', level: 'INFO', message: 'platform' },
            ] satisfies ILogEntry[])
            .mockResolvedValueOnce([
                { timestamp: 20, source: 'sdcpp', level: 'INFO', message: 'engine' },
            ] satisfies ILogEntry[])
            .mockResolvedValueOnce([
                { timestamp: 12, source: 'frontend', level: 'INFO', message: 'platform later' },
            ] satisfies ILogEntry[]);

        await service.fetchLogs('general');
        await service.fetchLogs('engine:sdcpp');
        await service.fetchLogs('general');

        expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'get_console_logs', {
            viewId: 'general',
            since: 0,
        });
        expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'get_console_logs', {
            viewId: 'engine:sdcpp',
            since: 0,
        });
        expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'get_console_logs', {
            viewId: 'general',
            since: 10,
        });
    });

    it('uses backend-computed views without hiding custom providers', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'Platform' },
                    { id: 'module:custom-text', label: 'Custom' },
                    { id: 'module:axelate-telegram-parser', label: 'Parser' },
                ],
                status_items: [],
            },
        });

        await expect(service.getAvailableViews()).resolves.toEqual([
            { id: 'general', label: 'Platform' },
            { id: 'agent', label: 'Agent' },
            { id: 'module:custom-text', label: 'Custom' },
            { id: 'module:axelate-telegram-parser', label: 'Parser' },
        ]);
    });

    it('maps Agent Control audit entries into the agent console view', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                enabled: true,
                apiBaseUrl: 'http://127.0.0.1:3000',
                profiles: [],
                approvals: [],
                audit: [
                    {
                        id: 'audit-2',
                        actorId: 'agent-1',
                        actorName: 'Trusted Local',
                        action: 'module.stop',
                        target: 'llamacpp',
                        result: 'denied',
                        createdAt: '2026-05-22T12:00:02Z',
                    },
                    {
                        id: 'audit-1',
                        actorId: 'agent-1',
                        actorName: 'Trusted Local',
                        action: 'launcher.open-page',
                        target: 'settings',
                        result: 'success',
                        createdAt: '2026-05-22T12:00:01Z',
                    },
                ],
            },
        });

        const logs = await service.fetchLogs('agent');

        expect(logs).toEqual([
            expect.objectContaining({
                source: 'agent-control',
                source_label: 'Trusted Local',
                normalized_level: 'INFO',
                scope: 'launcher.open-page',
                summary_message: 'settings -> success',
            }),
            expect.objectContaining({
                source_label: 'Trusted Local',
                normalized_level: 'WARN',
                scope: 'module.stop',
                summary_message: 'llamacpp -> denied',
            }),
        ]);
        expect(service.getLogsForView('agent').map((entry) => entry.summary_message)).toEqual([
            'settings -> success',
            'llamacpp -> denied',
        ]);
    });

    it('clears the agent console view locally without calling log file commands', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                enabled: true,
                apiBaseUrl: 'http://127.0.0.1:3000',
                profiles: [],
                approvals: [],
                audit: [
                    {
                        id: 'audit-1',
                        actorId: 'agent-1',
                        actorName: 'Trusted Local',
                        action: 'launcher.open-page',
                        target: 'console',
                        result: 'success',
                        createdAt: '2026-05-22T12:00:01Z',
                    },
                ],
            },
        });

        await service.fetchLogs('agent');
        const cleared = await service.clearLogs('agent');

        expect(cleared).toBe(true);
        expect(bridge.invoke).not.toHaveBeenCalledWith('clear_console_logs', expect.anything());
        expect(service.getLogsForView('agent')).toEqual([]);
    });

    it('keeps known runtime logs out of the general view after overview sync', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'Platform' },
                    { id: 'engine:llamacpp', label: 'LLaMA.cpp' },
                    { id: 'module:axelate-telegram-parser', label: 'Parser' },
                ],
                status_items: [],
            },
        });
        vi.mocked(bridge.invoke).mockResolvedValue([
            { timestamp: 10, source: 'frontend', level: 'INFO', message: 'platform' },
            { timestamp: 11, source: 'llamacpp', level: 'DEBUG', message: 'engine debug' },
            {
                timestamp: 12,
                source: 'module:axelate-telegram-parser',
                level: 'INFO',
                message: 'module info',
                module_id: 'axelate-telegram-parser',
            },
        ] satisfies ILogEntry[]);

        await service.getAvailableViews();
        const logs = await service.fetchLogs('general');

        expect(logs).toEqual([
            expect.objectContaining({
                source: 'frontend',
                message: 'platform',
            }),
        ]);
        expect(service.getLogsForView('general').map((entry) => entry.message)).toEqual([
            'platform',
        ]);
    });

    it('clears only the requested view', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke)
            .mockResolvedValueOnce([
                { timestamp: 1, source: 'frontend', level: 'INFO', message: 'platform' },
            ] satisfies ILogEntry[])
            .mockResolvedValueOnce(undefined);

        await service.fetchLogs('general');
        const cleared = await service.clearLogs('general');

        expect(cleared).toBe(true);
        expect(bridge.invoke).toHaveBeenLastCalledWith('clear_console_logs', {
            viewId: 'general',
        });
        expect(service.getLogsForView('general')).toEqual([]);
    });

    it('opens engine log folders', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockResolvedValue(undefined);

        await expect(service.openLogsFolder('engine:sdcpp')).resolves.toBe(true);

        expect(bridge.invoke).toHaveBeenCalledWith('open_console_log_target', {
            viewId: 'engine:sdcpp',
        });
    });

    it('opens module folders through the backend command', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockResolvedValue(undefined);

        await expect(service.openModuleFolder('axelate-telegram-parser')).resolves.toBe(true);

        expect(bridge.invoke).toHaveBeenCalledWith('open_module_folder', {
            moduleId: 'axelate-telegram-parser',
        });
        expect(bridge.invoke).not.toHaveBeenCalledWith('plugin:shell|open', expect.anything());
    });
});
