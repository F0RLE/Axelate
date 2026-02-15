import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebugService, type ILogEntry } from './DebugService';
import type { IBridge } from '@/shared/types/IBridge';

describe('DebugService', () => {
    let bridge: IBridge;
    let service: DebugService;

    const mockLogs: ILogEntry[] = [
        { timestamp: 100, source: 'TEST', level: 'INFO', message: 'Test log 1' },
        { timestamp: 200, source: 'TEST', level: 'ERROR', message: 'Test log 2' },
    ];

    beforeEach(() => {
        bridge = {
            invoke: vi.fn(),
            listen: vi.fn(),
            isTauri: vi.fn(),
        };
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
});
