import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogService, type ILogEntry } from './ConsoleLogService';
import type { IBridge } from '@/shared/types/IBridge';
import { createMockBridge } from '@/test/mocks/mockBridge';
import * as invokeModule from '@/shared/api/invoke';
function setupTauri(bridge: IBridge, isTauri = true, invokeReturn?: unknown) {
    vi.mocked(bridge.isTauri).mockReturnValue(isTauri);
    if (invokeReturn !== undefined) {
        vi.mocked(bridge.invoke).mockResolvedValue(invokeReturn);
    }
}

describe('ConsoleLogService', () => {
    let bridge: IBridge;
    let service: ConsoleLogService;

    const mockLogs: ILogEntry[] = [
        { timestamp: 100, source: 'TEST', level: 'INFO', message: 'Test log 1' },
        { timestamp: 200, source: 'TEST', level: 'ERROR', message: 'Test log 2' },
    ];

    beforeEach(() => {
        vi.restoreAllMocks();
        bridge = createMockBridge();
        service = new ConsoleLogService(bridge, {
            warn: vi.fn(),
            error: vi.fn(),
        });
    });

    it('should fetch logs via generic bridge when isTauri is true', async () => {
        setupTauri(bridge, true, mockLogs);

        const logs = await service.fetchLogs();

        expect(bridge.invoke).toHaveBeenCalledWith('get_logs', { since: 0 });
        expect(logs).toHaveLength(2);
        expect(logs[0]?.message).toBe('Test log 1');
    });

    it('should trust backend-filtered log payloads without extra frontend filtering', async () => {
        const filteredLogs: ILogEntry[] = [
            { timestamp: 200, source: 'TEST', level: 'ERROR', message: 'Real Error' },
        ];
        setupTauri(bridge, true, filteredLogs);

        const logs = await service.fetchLogs();

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toBe('Real Error');
    });

    it('should clear logs via bridge', async () => {
        setupTauri(bridge, true);

        await service.clearLogs();

        expect(bridge.invoke).toHaveBeenCalledWith('clear_console_logs', { viewId: 'general' });
        expect(service.getLogs()).toHaveLength(0);
    });

    it('should fetch logs via bridge mock when bridge is not Tauri', async () => {
        setupTauri(bridge, false);
        vi.mocked(bridge.invoke).mockResolvedValue(mockLogs);

        const logs = await service.fetchLogs();

        expect(bridge.invoke).toHaveBeenCalledWith('get_logs', { since: 0 });
        expect(logs).toHaveLength(2);
    });

    it.each([
        [
            'Tauri invoke error',
            true,
            () => vi.mocked(bridge.invoke).mockRejectedValue(new Error('Backend down')),
        ],
        [
            'non-Tauri bridge error',
            false,
            () => vi.mocked(bridge.invoke).mockRejectedValue(new Error('Network')),
        ],
    ])('should return empty array on fetchLogs %s', async (_, isTauriFlag, setupMock) => {
        setupTauri(bridge, isTauriFlag);
        setupMock();
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should clear logs via bridge when not Tauri', async () => {
        setupTauri(bridge, false);
        vi.mocked(bridge.invoke).mockResolvedValue(null);
        const result = await service.clearLogs();
        expect(result).toBe(true);
        expect(bridge.invoke).toHaveBeenCalledWith('clear_console_logs', { viewId: 'general' });
    });

    it('should clear only the selected engine view', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'engine:sdcpp', label: 'Stable Diffusion.cpp' },
                ],
                status_items: [],
            },
        });
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'get_logs') {
                return Promise.resolve([
                    { timestamp: 1, source: 'frontend', level: 'ERROR', message: 'launcher' },
                    { timestamp: 2, source: 'sdcpp', level: 'INFO', message: 'engine' },
                ]);
            }
            return Promise.resolve(undefined);
        });

        await service.fetchLogs();
        await service.getAvailableViews();
        await service.clearLogs('engine:stable-diffusion');

        expect(bridge.invoke).toHaveBeenCalledWith('clear_console_logs', {
            viewId: 'engine:sdcpp',
        });
        expect(service.getLogsForView('general')).toEqual([
            expect.objectContaining({ message: 'launcher' }),
        ]);
        expect(service.getLogsForView('engine:sdcpp')).toEqual([]);
    });

    it('should return false on clearLogs error', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockRejectedValue(new Error('Clear fail'));
        const result = await service.clearLogs();
        expect(result).toBe(false);
    });

    it('should handle empty or non-array processLogs', async () => {
        setupTauri(bridge, true, []);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should truncate logs beyond 2000', async () => {
        setupTauri(bridge, true);
        // Fill logs with 2001 entries across multiple fetches
        const batch = Array.from({ length: 1500 }, (_, i) => ({
            timestamp: i,
            source: 'TEST',
            level: 'INFO',
            message: `Log ${i}`,
        }));
        vi.mocked(bridge.invoke).mockResolvedValue(batch);
        await service.fetchLogs();
        // Add another batch to exceed 2000
        const batch2 = Array.from({ length: 600 }, (_, i) => ({
            timestamp: 1500 + i,
            source: 'TEST',
            level: 'INFO',
            message: `Log ${1500 + i}`,
        }));
        vi.mocked(bridge.invoke).mockResolvedValue(batch2);
        await service.fetchLogs();
        expect(service.getLogs().length).toBeLessThanOrEqual(1000);
    });

    it('should handle logs with null/undefined message and source (L63-64)', async () => {
        const logsWithNulls: ILogEntry[] = [
            {
                timestamp: 100,
                source: undefined as unknown as string,
                level: 'INFO',
                message: undefined as unknown as string,
            },
        ];
        setupTauri(bridge, true, logsWithNulls);
        const logs = await service.fetchLogs();
        // Should not crash — null/undefined safely coerced to ''
        expect(logs).toHaveLength(1);
    });

    it('should return empty when backend returns no new logs', async () => {
        setupTauri(bridge, true, []);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should handle non-array bridge payloads as empty logs', async () => {
        setupTauri(bridge, false, '' as unknown as ILogEntry[]);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should use previous lastTimestamp when last log has no timestamp (L93)', async () => {
        setupTauri(bridge, true);
        // First call sets lastTimestamp
        const firstBatch: ILogEntry[] = [
            { timestamp: 500, source: 'APP', level: 'INFO', message: 'ok' },
        ];
        vi.mocked(bridge.invoke).mockResolvedValueOnce(firstBatch);
        await service.fetchLogs();

        // Second call has a log without a timestamp at the end
        const secondBatch: ILogEntry[] = [
            {
                timestamp: undefined as unknown as number,
                source: 'SYS',
                level: 'WARN',
                message: 'no ts',
            },
        ];
        vi.mocked(bridge.invoke).mockResolvedValueOnce(secondBatch);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(1);
    });

    it('should subscribe to engine events and append engine logs in Tauri mode', async () => {
        const unlisten = vi.fn();
        const listeners = new Map<string, (payload: unknown) => void>();

        setupTauri(bridge, true);
        vi.mocked(bridge.listen).mockImplementation(
            <T>(event: string, callback: (payload: T) => void) => {
                listeners.set(event, callback as (payload: unknown) => void);
                return Promise.resolve(unlisten);
            },
        );

        await service.init();

        listeners.get('ai:engine:starting')?.({ engine_id: 'llamacpp' });
        listeners.get('ai:engine:log')?.({
            engine_id: 'llamacpp',
            line: 'ready line',
        });
        listeners.get('ai:engine:error')?.({
            engine_id: 'llamacpp',
            message: 'boom',
        });

        expect(service.getLogsForView('engine:llamacpp')).toEqual([
            expect.objectContaining({
                source: 'llamacpp',
                level: 'info',
                message: 'Engine is starting...',
            }),
            expect.objectContaining({
                source: 'llamacpp',
                level: 'info',
                message: 'ready line',
            }),
            expect.objectContaining({
                source: 'llamacpp',
                level: 'error',
                message: 'boom',
            }),
        ]);

        service.destroy();
        expect(unlisten).toHaveBeenCalledTimes(4);
    });

    it('should ignore noisy engine events', async () => {
        const listeners = new Map<string, (payload: unknown) => void>();

        setupTauri(bridge, true);
        vi.mocked(bridge.listen).mockImplementation(
            <T>(event: string, callback: (payload: T) => void) => {
                listeners.set(event, callback as (payload: unknown) => void);
                return Promise.resolve(vi.fn());
            },
        );

        await service.init();
        listeners.get('ai:engine:log')?.({
            engine_id: 'llamacpp',
            line: '[AIBridge] Stream chunk received',
        });

        expect(service.getLogsForView('engine:llamacpp')).toEqual([]);
    });

    it('should expose General plus ready engine tabs', async () => {
        setupTauri(bridge, true);
        const invokeSafeSpy = vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'engine:llamacpp', label: 'LLaMA.cpp' },
                ],
                status_items: [],
            },
        });

        const views = await service.getAvailableViews();

        expect(invokeSafeSpy).toHaveBeenCalledWith('get_console_overview');
        expect(views).toEqual([
            { id: 'general', label: 'General' },
            { id: 'engine:llamacpp', label: 'LLaMA.cpp' },
        ]);
    });

    it('should trust backend-computed views when running in tauri', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'module:sample-integration', label: 'Sample Integration' },
                ],
                status_items: [],
            },
        });
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'get_logs') {
                return Promise.resolve([
                    {
                        timestamp: 1,
                        source: 'module:sample-integration',
                        level: 'INFO',
                        message: 'Started',
                        module_id: 'sample-integration',
                    },
                ]);
            }
            return Promise.resolve(undefined);
        });

        await service.fetchLogs();
        const views = await service.getAvailableViews();

        expect(views).toEqual([
            { id: 'general', label: 'General' },
            { id: 'module:sample-integration', label: 'Sample Integration' },
        ]);
    });

    it('should keep General limited to useful launcher logs and route module logs to module tabs', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'engine:llamacpp', label: 'LLaMA.cpp' },
                    { id: 'module:llamacpp', label: 'Llamacpp' },
                ],
                status_items: [],
            },
        });
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'get_logs') {
                return Promise.resolve([
                    {
                        timestamp: 1,
                        source: 'frontend',
                        level: 'INFO',
                        message: '[NavigationService] Navigating to: console',
                    },
                    {
                        timestamp: 2,
                        source: 'frontend',
                        level: 'INFO',
                        message: '[AIBridge] Starting provider: llamacpp',
                        module_id: 'llamacpp',
                    },
                    {
                        timestamp: 3,
                        source: 'llamacpp',
                        level: 'INFO',
                        message: 'ready line',
                    },
                    {
                        timestamp: 4,
                        source: 'frontend',
                        level: 'WARN',
                        message: '[WindowService] setSize failed',
                    },
                ]);
            }
            return Promise.resolve(undefined);
        });

        await service.fetchLogs();
        await service.getAvailableViews();

        expect(service.getLogsForView('general')).toEqual([
            expect.objectContaining({
                source: 'frontend',
                message: 'setSize failed',
            }),
        ]);
        expect(service.getLogsForView('module:llamacpp')).toEqual([
            expect.objectContaining({
                source: 'frontend',
                message: 'Starting provider: llamacpp',
            }),
        ]);
        expect(service.getLogsForView('engine:llamacpp')).toEqual([
            expect.objectContaining({
                source: 'llamacpp',
                message: 'ready line',
            }),
        ]);
    });

    it('should filter noisy startup and progress logs before rendering', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'get_logs') {
                return Promise.resolve([
                    {
                        timestamp: 1,
                        source: 'frontend',
                        level: 'INFO',
                        message: '[CoreRuntimeSupport] Critical services hydrated.',
                    },
                    {
                        timestamp: 2,
                        source: 'frontend',
                        level: 'INFO',
                        message: '[CatalogService] Catalog initialized. AI: 10, Services: 1',
                    },
                    {
                        timestamp: 3,
                        source: 'sdcpp',
                        level: 'INFO',
                        message: '2026-04-24 07:00:00 [INFO] |====> | 8/28 - 1.03it/s',
                    },
                    {
                        timestamp: 4,
                        source: 'frontend',
                        level: 'ERROR',
                        message: '[CatalogService] Failed to load catalog: boom',
                    },
                ]);
            }
            return Promise.resolve(undefined);
        });

        await service.fetchLogs();

        expect(service.getLogsForView('general')).toEqual([
            expect.objectContaining({
                level: 'ERROR',
                message: 'Failed to load catalog: boom',
            }),
        ]);
        expect(service.getLogsForView('engine:sdcpp')).toEqual([]);
    });

    it('should route stable-diffusion alias logs into the sdcpp engine tab', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'engine:sdcpp', label: 'Stable Diffusion.cpp' },
                ],
                status_items: [],
            },
        });
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'get_logs') {
                return Promise.resolve([
                    {
                        timestamp: 1,
                        source: 'stable-diffusion',
                        level: 'INFO',
                        message: '2026-04-24 07:00:00 [INFO] loaded model',
                    },
                ]);
            }
            return Promise.resolve(undefined);
        });

        await service.fetchLogs();
        await service.getAvailableViews();

        expect(service.getLogsForView('engine:sdcpp')).toEqual([
            expect.objectContaining({
                source: 'sdcpp',
                message: 'loaded model',
            }),
        ]);
        expect(service.getLogsForView('general')).toEqual([]);
    });

    it('should collapse duplicate engine views by label', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'engine:first-backend', label: 'Shared Engine' },
                    { id: 'engine:second-backend', label: 'Shared   Engine' },
                    { id: 'engine:other-backend', label: 'Other Engine' },
                ],
                status_items: [],
            },
        });

        const views = await service.getAvailableViews();

        expect(views).toEqual([
            { id: 'general', label: 'General' },
            { id: 'engine:first-backend', label: 'Shared Engine' },
            { id: 'engine:other-backend', label: 'Other Engine' },
        ]);
    });

    it('should dedupe engine logs received from live events and runtime files', async () => {
        const listeners = new Map<string, (payload: unknown) => void>();

        setupTauri(bridge, true);
        vi.mocked(bridge.listen).mockImplementation(
            <T>(event: string, callback: (payload: T) => void) => {
                listeners.set(event, callback as (payload: unknown) => void);
                return Promise.resolve(vi.fn());
            },
        );
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'engine:sdcpp', label: 'Stable Diffusion.cpp' },
                ],
                status_items: [],
            },
        });
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'get_logs') {
                return Promise.resolve([
                    {
                        timestamp: 2,
                        source: 'sdcpp',
                        level: 'INFO',
                        message: '2026-04-24 07:00:00 [INFO] 8/28 - 1.03it/s',
                    },
                ]);
            }
            return Promise.resolve(undefined);
        });

        await service.init();
        listeners.get('ai:engine:log')?.({
            engine_id: 'stable-diffusion',
            line: '8/28 - 1.03it/s',
        });
        await service.fetchLogs();
        await service.getAvailableViews();

        expect(service.getLogsForView('engine:sdcpp')).toEqual([
            expect.objectContaining({
                source: 'sdcpp',
                message: '8/28 - 1.03it/s',
            }),
        ]);
    });

    it('should build runtime status items for engines and modules', async () => {
        setupTauri(bridge, true);
        vi.spyOn(invokeModule, 'invokeSafe').mockResolvedValue({
            status: 'ok',
            data: {
                views: [
                    { id: 'general', label: 'General' },
                    { id: 'engine:llamacpp', label: 'LLaMA.cpp' },
                    { id: 'module:llamacpp', label: 'Llamacpp' },
                ],
                status_items: [
                    {
                        id: 'engine:llamacpp',
                        label: 'LLaMA.cpp',
                        kind: 'engine',
                        status: 'running',
                        detail: 'text',
                    },
                    {
                        id: 'module:llamacpp',
                        label: 'Llamacpp',
                        kind: 'module',
                        status: 'running',
                        detail: 'Running',
                    },
                ],
            },
        });
        const items = await service.getStatusItems();

        expect(items).toEqual([
            {
                id: 'engine:llamacpp',
                label: 'LLaMA.cpp',
                kind: 'engine',
                status: 'running',
                detail: 'text',
            },
            {
                id: 'module:llamacpp',
                label: 'Llamacpp',
                kind: 'module',
                status: 'running',
                detail: 'Running',
            },
        ]);
    });

    it('should cache module paths and open module folder', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'get_module_path') {
                return Promise.resolve('C:/modules/llamacpp');
            }
            if (command === 'plugin:shell|open') {
                return Promise.resolve(undefined);
            }
            return Promise.resolve(undefined);
        });

        const firstPath = await service.getModulePath('llamacpp');
        const secondPath = await service.getModulePath('llamacpp');
        const opened = await service.openModuleFolder('llamacpp');

        expect(firstPath).toBe('C:/modules/llamacpp');
        expect(secondPath).toBe('C:/modules/llamacpp');
        expect(opened).toBe(true);
        expect(bridge.invoke).toHaveBeenCalledWith('plugin:shell|open', {
            path: 'C:/modules/llamacpp',
        });
        expect(
            vi
                .mocked(bridge.invoke)
                .mock.calls.filter(([command]) => command === 'get_module_path'),
        ).toHaveLength(1);
    });

    it('should open the selected logs folder', async () => {
        setupTauri(bridge, true);
        vi.mocked(bridge.invoke).mockImplementation((command) => {
            if (command === 'open_console_log_target') {
                return Promise.resolve(undefined);
            }
            return Promise.resolve(undefined);
        });

        const opened = await service.openLogsFolder('engine:stable-diffusion');

        expect(opened).toBe(true);
        expect(bridge.invoke).toHaveBeenCalledWith('open_console_log_target', {
            viewId: 'engine:sdcpp',
        });
    });
});
