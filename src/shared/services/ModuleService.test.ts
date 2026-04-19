/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleService } from '@/shared/services/ModuleService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

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
            cancelDownload: vi.fn().mockResolvedValue(true),
        },
        tauriProvider: {
            isTauri: vi.fn().mockReturnValue(true),
            invoke: vi.fn(),
            listen: vi.fn().mockResolvedValue(() => {
                /* no-op */
            }),
        },
        tracer: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } satisfies Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>,
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
        moduleService = new ModuleService(mocks.tauriProvider as any, mocks.tracer);
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

        it('should be idempotent across repeated init calls', async () => {
            await moduleService.init();
            await moduleService.init();

            expect(mocks.tauriProvider.listen).toHaveBeenCalledTimes(1);
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

    describe('destroy', () => {
        it('should unlisten active download listener and allow re-init', async () => {
            const unlisten = vi.fn();
            mocks.tauriProvider.listen.mockResolvedValueOnce(unlisten);

            await moduleService.init();
            moduleService.destroy();
            await moduleService.init();

            expect(unlisten).toHaveBeenCalledTimes(1);
            expect(mocks.tauriProvider.listen).toHaveBeenCalledTimes(2);
        });

        it('should be safe to destroy before init', () => {
            expect(() => moduleService.destroy()).not.toThrow();
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
                speed: 4096,
            });

            const state = moduleService.getDownloadState('test-module');
            expect(state?.status).toBe('downloading');
            expect(state?.progress).toBe(0.5);
            expect(state?.speed).toBe(4096);
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
                speed: 0,
            });

            const state = moduleService.getDownloadState('test-module');
            expect(state?.progress).toBe(1);
        });
    });

    describe('cancelDownload', () => {
        it('should return false when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);
            const result = await moduleService.cancelDownload('test-module');
            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            // cancelDownload calls commands.cancelDownload directly, so mock it
            mocks.commands.cancelDownload.mockRejectedValue(new Error('Cancel error'));
            const result = await moduleService.cancelDownload('test-module');
            expect(result).toBe(false);
        });
    });

    describe('deleteModule exceptions', () => {
        it('should return false on exception', async () => {
            mocks.invokeSafe.mockRejectedValueOnce(new Error('Delete crash'));
            const result = await moduleService.deleteModule('test-module');
            expect(result).toBe(false);
        });
    });

    describe('downloadModule with hash', () => {
        it('should pass the hash to downloadModule command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });
            await moduleService.downloadModule('mod', 'https://repo.com', 'abc123');
            expect(mocks.commands.downloadModule).toHaveBeenCalledWith(
                'mod',
                'https://repo.com',
                'abc123',
                null,
            );
        });

        it('should pass null for empty hash', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });
            await moduleService.downloadModule('mod', 'https://repo.com', '   ');
            expect(mocks.commands.downloadModule).toHaveBeenCalledWith(
                'mod',
                'https://repo.com',
                null,
                null,
            );
        });
    });

    describe('checkInstalled additional', () => {
        it('should return false on error status from invokeSafe', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'API error' },
            });
            const result = await moduleService.checkInstalled('test-module');
            expect(result).toBe(false);
        });

        it('should return false for deleted module', async () => {
            // First delete the module
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });
            await moduleService.deleteModule('del-mod');
            // checkInstalled should short-circuit
            const result = await moduleService.checkInstalled('del-mod');
            expect(result).toBe(false);
        });
    });

    describe('downloadModule with undefined hash', () => {
        it('should pass null when hash is undefined (L122)', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });
            await moduleService.downloadModule('mod', 'https://repo.com');
            expect(mocks.commands.downloadModule).toHaveBeenCalledWith(
                'mod',
                'https://repo.com',
                null,
                null,
            );
        });

        it('should handle non-Error throw in downloadModule catch (L122)', async () => {
            // Make invokeSafe throw a plain string (non-Error)
            mocks.invokeSafe.mockRejectedValueOnce('string error');
            await expect(moduleService.downloadModule('mod', 'https://repo.com')).rejects.toBe(
                'string error',
            );

            // State should record error with String() conversion
            const state = moduleService.getDownloadState('mod');
            expect(state?.status).toBe('error');
            expect(state?.error).toBe('string error');
        });
    });

    describe('broadcast state for non-existent module (L216)', () => {
        it('should handle getDownloadState for non-existing module gracefully', () => {
            const state = moduleService.getDownloadState('non-existent-module');
            expect(state).toBeUndefined();
        });

        it('should not broadcast when state is undefined (L218)', async () => {
            // deleteModule internally calls _broadcastState after removing from state
            // Pre-condition: module has a state entry
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });

            // Delete a module that has no download state — _broadcastState skip branch
            mocks.tauriProvider.isTauri.mockReturnValue(true);
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok' });
            await moduleService.deleteModule('no-state-module');

            // Should not have thrown — the undefined state guard was hit silently
            const state = moduleService.getDownloadState('no-state-module');
            expect(state).toBeUndefined();
        });
    });
});
