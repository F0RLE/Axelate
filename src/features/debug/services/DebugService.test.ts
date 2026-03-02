import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebugService, type ILogEntry } from './DebugService';
import type { IBridge } from '@/shared/types/IBridge';
import { createMockBridge } from '@/test/mocks/mockBridge';
function setupTauri(bridge: IBridge, isTauri = true, invokeReturn?: unknown) {
    vi.mocked(bridge.isTauri).mockReturnValue(isTauri);
    if (invokeReturn !== undefined) {
        vi.mocked(bridge.invoke).mockResolvedValue(invokeReturn);
    }
}

function setupFetch(ok: boolean, textContent: string | null = null) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok,
        text: textContent === null ? undefined : () => Promise.resolve(textContent),
    } as Response);
    globalThis.fetch = fetchMock;
    return fetchMock;
}

describe('DebugService', () => {
    let bridge: IBridge;
    let service: DebugService;

    const mockLogs: ILogEntry[] = [
        { timestamp: 100, source: 'TEST', level: 'INFO', message: 'Test log 1' },
        { timestamp: 200, source: 'TEST', level: 'ERROR', message: 'Test log 2' },
    ];

    beforeEach(() => {
        bridge = createMockBridge();
        service = new DebugService(bridge);
        // Mock global fetch for fallback
        globalThis.fetch = vi.fn();
    });

    it('should fetch logs via generic bridge when isTauri is true', async () => {
        setupTauri(bridge, true, mockLogs);

        const logs = await service.fetchLogs();

        expect(bridge.invoke).toHaveBeenCalledWith('get_logs', { since: 0 });
        expect(logs).toHaveLength(2);
        expect(logs[0]?.message).toBe('Test log 1');
    });

    it('should filter noisy AI logs', async () => {
        const noisyLogs: ILogEntry[] = [
            { timestamp: 100, source: 'CHATSERVICE', level: 'INFO', message: 'Noise' },
            { timestamp: 200, source: 'TEST', level: 'ERROR', message: 'Real Error' },
            { timestamp: 300, source: 'GEMINI', level: 'ERROR', message: 'ERROR 429' },
        ];
        setupTauri(bridge, true, noisyLogs);

        const logs = await service.fetchLogs();

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toBe('Real Error');
    });

    it('should clear logs via bridge', async () => {
        setupTauri(bridge, true);

        await service.clearLogs();

        expect(bridge.invoke).toHaveBeenCalledWith('clear_logs');
        expect(service.getLogs()).toHaveLength(0);
    });

    it('should fallback to fetch when bridge is not Tauri', async () => {
        setupTauri(bridge, false);
        const fetchMock = setupFetch(true, JSON.stringify(mockLogs));

        const logs = await service.fetchLogs();

        expect(fetchMock).toHaveBeenCalledWith('/api/logs?since=0');
        expect(logs).toHaveLength(2);
    });

    it.each([
        [
            'Tauri invoke error',
            true,
            () => vi.mocked(bridge.invoke).mockRejectedValue(new Error('Backend down')),
        ],
        [
            'non-Tauri fetch error',
            false,
            () => vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network')),
        ],
        [
            'non-Tauri fetch non-ok',
            false,
            () => vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false } as Response),
        ],
    ])('should return empty array on fetchLogs %s', async (_, isTauriFlag, setupMock) => {
        setupTauri(bridge, isTauriFlag);
        setupMock();
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should clear logs via fetch when not Tauri', async () => {
        setupTauri(bridge, false);
        setupFetch(true);
        const result = await service.clearLogs();
        expect(result).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/logs/clear', { method: 'POST' });
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

    it('should handle invalid JSON in safeJsonParse', async () => {
        setupTauri(bridge, false);
        setupFetch(true, 'not valid json');
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
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

    it('should return empty when all logs are filtered (L90)', async () => {
        const allNoisy: ILogEntry[] = [
            { timestamp: 100, source: 'CHATSERVICE', level: 'INFO', message: 'filtered' },
            { timestamp: 200, source: 'AIBRIDGE', level: 'INFO', message: 'filtered' },
        ];
        setupTauri(bridge, true, allNoisy);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should handle empty string in safeJsonParse (L104)', async () => {
        setupTauri(bridge, false);
        setupFetch(true, '');
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
});
