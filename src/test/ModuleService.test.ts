import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock before import
const mockTauriProvider = {
    isTauri: vi.fn().mockReturnValue(true),
    invoke: vi.fn(),
    listen: vi.fn().mockResolvedValue(() => {}),
};

// Helper type for progress handler
type ProgressHandler = ((_: Record<string, unknown>) => void) | undefined;

// Helper to create listen implementation that captures handler
function createListenCapture(handlerRef: { current: ProgressHandler }) {
    return (_: unknown, handler: ProgressHandler) => {
        handlerRef.current = handler;
        return Promise.resolve(() => {});
    };
}

import { ModuleService } from '../modules/core/services/ModuleService';

describe('ModuleService', () => {
    let moduleService: ModuleService;

    beforeEach(() => {
        vi.clearAllMocks();
        moduleService = new ModuleService(mockTauriProvider as never);
    });

    describe('init', () => {
        it('should set up download progress listener', async () => {
            await moduleService.init();

            expect(mockTauriProvider.listen).toHaveBeenCalledWith(
                'download_progress',
                expect.any(Function),
            );
        });

        it('should skip initialization when not in Tauri', async () => {
            mockTauriProvider.isTauri.mockReturnValueOnce(false);

            await moduleService.init();

            expect(mockTauriProvider.listen).not.toHaveBeenCalled();
        });
    });

    describe('checkInstalled', () => {
        it('should return true when module is installed', async () => {
            mockTauriProvider.invoke.mockResolvedValueOnce(true);

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(true);
            expect(mockTauriProvider.invoke).toHaveBeenCalledWith('check_module_installed', {
                moduleId: 'test-module',
            });
        });

        it('should return false when module is not installed', async () => {
            mockTauriProvider.invoke.mockResolvedValueOnce(false);

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(false);
        });

        it('should return false when not in Tauri', async () => {
            mockTauriProvider.isTauri.mockReturnValueOnce(false);

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(false);
            expect(mockTauriProvider.invoke).not.toHaveBeenCalled();
        });

        it('should return false on error', async () => {
            mockTauriProvider.invoke.mockRejectedValueOnce(new Error('Check failed'));

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(false);
        });
    });

    describe('downloadModule', () => {
        it('should invoke download_module command', async () => {
            mockTauriProvider.invoke.mockResolvedValueOnce(undefined);

            await moduleService.downloadModule('test-module', 'https://repo.com/module');

            expect(mockTauriProvider.invoke).toHaveBeenCalledWith('download_module', {
                moduleId: 'test-module',
                repo_url: 'https://repo.com/module',
            });
        });

        it('should throw when not in Tauri', async () => {
            mockTauriProvider.isTauri.mockReturnValueOnce(false);

            await expect(
                moduleService.downloadModule('test-module', 'https://repo.com'),
            ).rejects.toThrow('Download available only in desktop app');
        });

        it('should update state on error', async () => {
            mockTauriProvider.invoke.mockRejectedValueOnce(new Error('Download failed'));

            await expect(moduleService.downloadModule('test-module', 'url')).rejects.toThrow();

            const state = moduleService.getDownloadState('test-module');
            expect(state?.status).toBe('error');
        });
    });

    describe('deleteModule', () => {
        it('should invoke delete_module command', async () => {
            mockTauriProvider.invoke.mockResolvedValueOnce(undefined);

            const result = await moduleService.deleteModule('test-module');

            expect(result).toBe(true);
            expect(mockTauriProvider.invoke).toHaveBeenCalledWith('delete_module', {
                moduleId: 'test-module',
            });
        });

        it('should throw when not in Tauri', async () => {
            mockTauriProvider.isTauri.mockReturnValueOnce(false);

            await expect(moduleService.deleteModule('test-module')).rejects.toThrow(
                'Delete available only in desktop app',
            );
        });

        it('should return false on error', async () => {
            mockTauriProvider.invoke.mockRejectedValueOnce(new Error('Delete failed'));

            const result = await moduleService.deleteModule('test-module');

            expect(result).toBe(false);
        });
    });

    describe('control', () => {
        it('should invoke control_module command', async () => {
            mockTauriProvider.invoke.mockResolvedValueOnce(undefined);

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(true);
            expect(mockTauriProvider.invoke).toHaveBeenCalledWith('control_module', {
                request: {
                    module_id: 'test-service',
                    action: 'start',
                },
            });
        });

        it('should return false when not in Tauri', async () => {
            mockTauriProvider.isTauri.mockReturnValueOnce(false);

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            mockTauriProvider.invoke.mockRejectedValueOnce(new Error('Control failed'));

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(false);
        });
    });

    describe('getDownloadState', () => {
        it('should return undefined for unknown module', () => {
            const state = moduleService.getDownloadState('unknown');
            expect(state).toBeUndefined();
        });
    });

    describe('download progress events', () => {
        it('should register listener on init', async () => {
            await moduleService.init();

            expect(mockTauriProvider.listen).toHaveBeenCalledTimes(1);
            const [eventName, handler] = mockTauriProvider.listen.mock.calls[0];
            expect(eventName).toBe('download_progress');
            expect(typeof handler).toBe('function');
        });

        it('should process progress payload correctly', async () => {
            // Use ref pattern with module-level helper
            const handlerRef: { current: ProgressHandler } = { current: undefined };
            mockTauriProvider.listen.mockImplementation(createListenCapture(handlerRef));

            await moduleService.init();

            // Call handler with test data
            handlerRef.current?.({
                module_id: 'test-module',
                status: 'downloading',
                progress: 0.5,
                message: 'Downloading...',
                downloaded: 50,
                total: 100,
            });

            const state = moduleService.getDownloadState('test-module');
            expect(state?.status).toBe('downloading');
            expect(state?.progress).toBe(0.5);
        });

        it('should set progress to 1 on complete', async () => {
            const handlerRef: { current: ProgressHandler } = { current: undefined };
            mockTauriProvider.listen.mockImplementation(createListenCapture(handlerRef));

            await moduleService.init();

            handlerRef.current?.({
                module_id: 'test-module',
                status: 'complete',
                progress: 0.95,
                message: 'Done',
                downloaded: 100,
                total: 100,
            });

            const state = moduleService.getDownloadState('test-module');
            expect(state?.progress).toBe(1);
        });
    });
});
