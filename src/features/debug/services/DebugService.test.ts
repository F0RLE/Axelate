
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebugService, type ILogEntry } from './DebugService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';

describe('DebugService', () => {
    let debugService: DebugService;
    let mockTauriProvider: TauriProvider;

    beforeEach(() => {
        mockTauriProvider = {
            isTauri: vi.fn(),
            invoke: vi.fn(),
        } as unknown as TauriProvider;

        debugService = new DebugService(mockTauriProvider);
        
        // Mock global fetch for fallback tests
        globalThis.fetch = vi.fn();
    });

    it('should fetch logs via Tauri invoke when in Tauri', async () => {
        vi.mocked(mockTauriProvider.isTauri).mockReturnValue(true);
        const mockLogs: ILogEntry[] = [
            { timestamp: 123, source: 'TEST', level: 'INFO', message: 'Test log' }
        ];
        vi.mocked(mockTauriProvider.invoke).mockResolvedValue(mockLogs);

        const logs = await debugService.fetchLogs();
        
        expect(mockTauriProvider.invoke).toHaveBeenCalledWith('get_logs', { since: 0 });
        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toBe('Test log');
    });

    it('should fetch logs via fetch when NOT in Tauri', async () => {
        vi.mocked(mockTauriProvider.isTauri).mockReturnValue(false);
        const mockLogs: ILogEntry[] = [
            { timestamp: 123, source: 'TEST', level: 'INFO', message: 'Browser log' }
        ];
        
        vi.mocked(globalThis.fetch).mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(JSON.stringify(mockLogs))
        } as Response);

        const logs = await debugService.fetchLogs();
        
        expect(globalThis.fetch).toHaveBeenCalled();
        expect(mockTauriProvider.invoke).not.toHaveBeenCalled();
        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toBe('Browser log');
    });

    it('should clear logs via Tauri invoke when in Tauri', async () => {
        vi.mocked(mockTauriProvider.isTauri).mockReturnValue(true);
        vi.mocked(mockTauriProvider.invoke).mockResolvedValue(undefined);

        await debugService.clearLogs();
        
        expect(mockTauriProvider.invoke).toHaveBeenCalledWith('clear_logs');
        expect(debugService.getLogs()).toHaveLength(0);
    });

    it('should clear logs via fetch when NOT in Tauri', async () => {
        vi.mocked(mockTauriProvider.isTauri).mockReturnValue(false);
        vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true } as Response);

        await debugService.clearLogs();
        
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/logs/clear', { method: 'POST' });
        expect(mockTauriProvider.invoke).not.toHaveBeenCalled();
        expect(debugService.getLogs()).toHaveLength(0);
    });
});
