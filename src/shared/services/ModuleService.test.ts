/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleService } from '@/shared/services/ModuleService';

// TYPES
type ProgressHandler = ((_: Record<string, unknown>) => void) | undefined;

// HOISTED MOCKS
const mocks = vi.hoisted(() => {
    return {
        invokeSafe: vi.fn(),
        commands: {
            checkModuleInstalled: vi.fn(),
            downloadModule: vi.fn(),
            deleteModule: vi.fn(),
        },
        tauriProvider: {
            isTauri: vi.fn().mockReturnValue(true),
            invoke: vi.fn(),
            listen: vi.fn().mockResolvedValue(() => {
                /* no-op */
            }),
        },
    };
});

// MOCK MODULES
vi.mock('@/shared/api/invoke', () => ({
    invokeSafe: (...args: any[]) => mocks.invokeSafe(...args),
}));

vi.mock('@/shared/types/bindings', () => ({
    commands: mocks.commands,
}));

// Helper to create listen implementation that captures handler
function createListenCapture(handlerRef: { current: ProgressHandler }) {
    return (_: unknown, handler: ProgressHandler) => {
        handlerRef.current = handler;
        return Promise.resolve(() => {
            /* no-op */
        });
    };
}

describe('ModuleService', () => {
    let moduleService: ModuleService;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset default behaviors
        mocks.tauriProvider.isTauri.mockReturnValue(true);
        mocks.commands.checkModuleInstalled.mockResolvedValue({ status: 'ok', data: true });
        mocks.commands.downloadModule.mockResolvedValue({ status: 'ok', data: null });
        mocks.commands.deleteModule.mockResolvedValue({ status: 'ok', data: null });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        moduleService = new ModuleService(mocks.tauriProvider as any);
    });

    describe('init', () => {
        it('should set up download progress listener', async () => {
            await moduleService.init();

            expect(mocks.tauriProvider.listen).toHaveBeenCalledWith(
                'download_progress',
                expect.any(Function),
            );
        });

        it('should skip initialization when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            await moduleService.init();

            expect(mocks.tauriProvider.listen).not.toHaveBeenCalled();
        });
    });

    describe('checkInstalled', () => {
        it('should return true when module is installed', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: true });

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(true);
            expect(mocks.commands.checkModuleInstalled).toHaveBeenCalledWith('test-module');
            expect(mocks.invokeSafe).toHaveBeenCalled();
        });

        it('should return false when module is not installed', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: false });

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(false);
            expect(mocks.commands.checkModuleInstalled).toHaveBeenCalledWith('test-module');
        });

        it('should return false when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(false);
            expect(mocks.commands.checkModuleInstalled).not.toHaveBeenCalled();
        });

        it('should return false on error', async () => {
            mocks.invokeSafe.mockRejectedValueOnce(new Error('Check failed'));

            const result = await moduleService.checkInstalled('test-module');

            expect(result).toBe(false);
        });
    });

    describe('downloadModule', () => {
        it('should invoke download_module command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });

            await moduleService.downloadModule('test-module', 'https://repo.com/module');

            expect(mocks.commands.downloadModule).toHaveBeenCalledWith(
                'test-module',
                'https://repo.com/module',
                null,
            );
            expect(mocks.invokeSafe).toHaveBeenCalled();
        });

        it('should throw when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            await expect(
                moduleService.downloadModule('test-module', 'https://repo.com'),
            ).rejects.toThrow('Download available only in desktop app');
        });

        it('should update state on error', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'Download failed' },
            });

            await expect(moduleService.downloadModule('test-module', 'url')).rejects.toThrow();

            const state = moduleService.getDownloadState('test-module');
            expect(state?.status).toBe('error');
        });
    });

    describe('deleteModule', () => {
        it('should invoke delete_module command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });

            const result = await moduleService.deleteModule('test-module');

            expect(result).toBe(true);
            expect(mocks.commands.deleteModule).toHaveBeenCalledWith('test-module');
            expect(mocks.invokeSafe).toHaveBeenCalled();
        });

        it('should throw when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            await expect(moduleService.deleteModule('test-module')).rejects.toThrow(
                'Delete available only in desktop app',
            );
        });

        it('should return false on error', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'Delete failed' },
            });

            const result = await moduleService.deleteModule('test-module');

            expect(result).toBe(false);
        });
    });

    describe('control', () => {
        it('should invoke control_module command', async () => {
            mocks.tauriProvider.invoke.mockResolvedValueOnce(undefined);

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(true);
            expect(mocks.tauriProvider.invoke).toHaveBeenCalledWith('control_module', {
                request: {
                    module_id: 'test-service',
                    action: 'start',
                },
            });
        });

        it('should return false when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            mocks.tauriProvider.invoke.mockRejectedValueOnce(new Error('Control failed'));

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

            expect(mocks.tauriProvider.listen).toHaveBeenCalledTimes(1);
            const firstCall = mocks.tauriProvider.listen.mock.calls[0];
            if (!firstCall) throw new Error('Listen not called');
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const [eventName, handler] = firstCall;
            expect(eventName).toBe('download_progress');
            expect(typeof handler).toBe('function');
        });

        it('should process progress payload correctly', async () => {
            // Use ref pattern with module-level helper
            const handlerRef: { current: ProgressHandler } = { current: undefined };
            mocks.tauriProvider.listen.mockImplementation(createListenCapture(handlerRef));

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
            mocks.tauriProvider.listen.mockImplementation(createListenCapture(handlerRef));

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
