import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebugService, type ILogEntry } from './DebugService';
import type { IBridge } from '@/shared/types/IBridge';
import { createMockBridge } from '@/test/mocks/mockBridge';

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
        vi.mocked(bridge.isTauri).mockReturnValue(true);
        vi.mocked(bridge.invoke).mockResolvedValue(mockLogs);

        const logs = await service.fetchLogs();

        expect(bridge.invoke).toHaveBeenCalledWith('get_logs', { since: 0 });
        expect(logs).toHaveLength(2);
        expect(logs[0]?.message).toBe('Test log 1');
    });

    it('should filter noisy AI logs', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
        const noisyLogs: ILogEntry[] = [
            { timestamp: 100, source: 'CHATSERVICE', level: 'INFO', message: 'Noise' },
            { timestamp: 200, source: 'TEST', level: 'ERROR', message: 'Real Error' },
            { timestamp: 300, source: 'GEMINI', level: 'ERROR', message: 'ERROR 429' },
        ];
        vi.mocked(bridge.invoke).mockResolvedValue(noisyLogs);

        const logs = await service.fetchLogs();

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toBe('Real Error');
    });

    it('should clear logs via bridge', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);

        await service.clearLogs();

        expect(bridge.invoke).toHaveBeenCalledWith('clear_logs');
        expect(service.getLogs()).toHaveLength(0);
    });

    it('should fallback to fetch when bridge is not Tauri', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(false);
        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockResolvedValue({
            ok: true,
            text: async () => {
                return await Promise.resolve(JSON.stringify(mockLogs));
            },
        } as Response);

        const logs = await service.fetchLogs();

        expect(fetchMock).toHaveBeenCalledWith('/api/logs?since=0');
        expect(logs).toHaveLength(2);
    });

    it('should return empty array on fetchLogs error in Tauri', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
        vi.mocked(bridge.invoke).mockRejectedValue(new Error('Backend down'));
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should return empty array on fetch error in non-Tauri', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(false);
        vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network'));
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should return empty array on non-ok fetch response', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(false);
        vi.mocked(globalThis.fetch).mockResolvedValue({
            ok: false,
        } as Response);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should clear logs via fetch when not Tauri', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(false);
        vi.mocked(globalThis.fetch).mockResolvedValue({} as Response);
        const result = await service.clearLogs();
        expect(result).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/logs/clear', { method: 'POST' });
    });

    it('should return false on clearLogs error', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
        vi.mocked(bridge.invoke).mockRejectedValue(new Error('Clear fail'));
        const result = await service.clearLogs();
        expect(result).toBe(false);
    });

    it('should handle empty or non-array processLogs', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
        vi.mocked(bridge.invoke).mockResolvedValue([]);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should truncate logs beyond 2000', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
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
        vi.mocked(bridge.isTauri).mockReturnValue(false);
        vi.mocked(globalThis.fetch).mockResolvedValue({
            ok: true,
            text: (): Promise<string> => Promise.resolve('not valid json'),
        } as Response);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should handle logs with null/undefined message and source (L63-64)', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
        const logsWithNulls: ILogEntry[] = [
            {
                timestamp: 100,
                source: undefined as unknown as string,
                level: 'INFO',
                message: undefined as unknown as string,
            },
        ];
        vi.mocked(bridge.invoke).mockResolvedValue(logsWithNulls);
        const logs = await service.fetchLogs();
        // Should not crash — null/undefined safely coerced to ''
        expect(logs).toHaveLength(1);
    });

    it('should return empty when all logs are filtered (L90)', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
        const allNoisy: ILogEntry[] = [
            { timestamp: 100, source: 'CHATSERVICE', level: 'INFO', message: 'filtered' },
            { timestamp: 200, source: 'AIBRIDGE', level: 'INFO', message: 'filtered' },
        ];
        vi.mocked(bridge.invoke).mockResolvedValue(allNoisy);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should handle empty string in safeJsonParse (L104)', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(false);
        vi.mocked(globalThis.fetch).mockResolvedValue({
            ok: true,
            text: (): Promise<string> => Promise.resolve(''),
        } as Response);
        const logs = await service.fetchLogs();
        expect(logs).toHaveLength(0);
    });

    it('should use previous lastTimestamp when last log has no timestamp (L93)', async () => {
        vi.mocked(bridge.isTauri).mockReturnValue(true);
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
