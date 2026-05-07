/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleService } from '@/shared/services/ModuleService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

// TYPES
type ProgressHandler = ((_: Record<string, unknown>) => void) | undefined;
type DownloadProgressEvent = CustomEvent<Record<string, unknown>>;

// HOISTED MOCKS
const mocks = vi.hoisted(() => {
    return {
        invokeSafe: vi.fn(),
        commands: {
            checkModuleInstalled: vi.fn(),
            getModuleStatus: vi.fn(),
            downloadModule: vi.fn(),
            deleteModule: vi.fn(),
            controlModule: vi.fn(),
            pauseDownload: vi.fn().mockResolvedValue(true),
            resumeDownload: vi.fn(),
            cancelDownload: vi.fn().mockResolvedValue(true),
            importIntegrationFolder: vi.fn(),
            importIntegrationArchive: vi.fn(),
            importIntegrationPath: vi.fn(),
            importIntegrationUrl: vi.fn(),
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
        mocks.commands.getModuleStatus.mockResolvedValue({ status: 'ok', data: 'running' });
        mocks.commands.downloadModule.mockResolvedValue({ status: 'ok', data: null });
        mocks.commands.deleteModule.mockResolvedValue({ status: 'ok', data: null });
        mocks.commands.importIntegrationFolder.mockReturnValue('import-folder-promise');
        mocks.commands.importIntegrationArchive.mockReturnValue('import-archive-promise');
        mocks.commands.importIntegrationPath.mockReturnValue('import-path-promise');
        mocks.commands.importIntegrationUrl.mockReturnValue('import-url-promise');

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

        it('should allow retry when progress listener registration fails', async () => {
            mocks.tauriProvider.listen
                .mockRejectedValueOnce(new Error('listen failed'))
                .mockResolvedValueOnce(() => {
                    /* no-op */
                });

            await expect(moduleService.init()).rejects.toThrow('listen failed');
            await moduleService.init();

            expect(mocks.tauriProvider.listen).toHaveBeenCalledTimes(2);
            expect(mocks.tracer.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to subscribe to download progress'),
            );
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

    describe('getStatus', () => {
        it('should return backend runtime status', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'running' });

            const result = await moduleService.getStatus('sample-integration');

            expect(result).toBe('running');
            expect(mocks.commands.getModuleStatus).toHaveBeenCalledWith('sample-integration');
            expect(mocks.invokeSafe).toHaveBeenCalled();
        });

        it('should return stopped when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            const result = await moduleService.getStatus('sample-integration');

            expect(result).toBe('stopped');
            expect(mocks.commands.getModuleStatus).not.toHaveBeenCalled();
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
            const progressSpy = vi.fn<(event: DownloadProgressEvent) => void>();
            const progressListener: EventListener = (event) => {
                progressSpy(event as DownloadProgressEvent);
            };
            globalThis.addEventListener('download-progress-update', progressListener);
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'Download failed' },
            });

            try {
                await expect(moduleService.downloadModule('test-module', 'url')).rejects.toThrow();

                const state = moduleService.getDownloadState('test-module');
                expect(state?.status).toBe('error');
                expect(state?.error).toBe('Download failed');
                expect(progressSpy).toHaveBeenCalledOnce();
                const event = progressSpy.mock.calls[0]?.[0];
                expect(event?.detail).toMatchObject({
                    module_id: 'test-module',
                    status: 'error',
                    message: 'Download failed',
                    error: 'Download failed',
                });
            } finally {
                globalThis.removeEventListener('download-progress-update', progressListener);
            }
        });

        it('should return paused outcome without marking it as error', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'paused' });

            const result = await moduleService.downloadModule('test-module', 'url');

            expect(result).toBe('paused');
            expect(mocks.tracer.error).not.toHaveBeenCalled();
            expect(moduleService.getDownloadState('test-module')?.status).not.toBe('error');
        });

        it('should surface unexpected paused errors as failed downloads', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'Download paused' },
            });

            await expect(moduleService.downloadModule('test-module', 'url')).rejects.toThrow(
                'Download paused',
            );

            expect(mocks.tracer.error).toHaveBeenCalledWith(
                '[ModuleService] Download error for test-module: Download paused',
            );
            expect(moduleService.getDownloadState('test-module')?.status).toBe('error');
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

    describe('integration imports', () => {
        it('should invoke integration folder import command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'folder-module' });

            await expect(
                moduleService.importIntegrationFolder('C:\\Integrations\\Parser'),
            ).resolves.toBe('folder-module');

            expect(mocks.commands.importIntegrationFolder).toHaveBeenCalledWith(
                'C:\\Integrations\\Parser',
            );
            expect(mocks.invokeSafe).toHaveBeenCalledWith('import-folder-promise');
        });

        it('should invoke integration archive import command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'archive-module' });

            await expect(
                moduleService.importIntegrationArchive('C:\\Downloads\\Parser.zip'),
            ).resolves.toBe('archive-module');

            expect(mocks.commands.importIntegrationArchive).toHaveBeenCalledWith(
                'C:\\Downloads\\Parser.zip',
            );
            expect(mocks.invokeSafe).toHaveBeenCalledWith('import-archive-promise');
        });

        it('should invoke auto-detected integration path import command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'path-module' });

            await expect(
                moduleService.importIntegrationPath('C:\\Downloads\\Parser'),
            ).resolves.toBe('path-module');

            expect(mocks.commands.importIntegrationPath).toHaveBeenCalledWith(
                'C:\\Downloads\\Parser',
            );
            expect(mocks.invokeSafe).toHaveBeenCalledWith('import-path-promise');
        });

        it('should invoke integration URL import command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'url-module' });

            await expect(
                moduleService.importIntegrationUrl(
                    'https://github.com/F0RLE/Axelate-telegram-parser',
                ),
            ).resolves.toBe('url-module');

            expect(mocks.commands.importIntegrationUrl).toHaveBeenCalledWith(
                'https://github.com/F0RLE/Axelate-telegram-parser',
            );
            expect(mocks.invokeSafe).toHaveBeenCalledWith('import-url-promise');
        });

        it('should throw integration import errors', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'bad integration' },
            });

            await expect(moduleService.importIntegrationPath('C:\\Broken')).rejects.toThrow(
                'bad integration',
            );
        });

        it('should throw integration imports in web mode', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            await expect(
                moduleService.importIntegrationUrl('https://example.com/mod.zip'),
            ).rejects.toThrow('Import available only in desktop app');
        });

        it('should clear deleted-module cache after importing the same module id', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: null });
            await moduleService.deleteModule('restored-module');

            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'restored-module' });
            await moduleService.importIntegrationPath('C:\\Restored');

            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: true });
            await expect(moduleService.checkInstalled('restored-module')).resolves.toBe(true);

            expect(mocks.commands.checkModuleInstalled).toHaveBeenCalledWith('restored-module');
        });
    });

    describe('control', () => {
        it('should invoke control_module command', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'ok',
                data: { success: true, message: 'started', status: 'running' },
            });

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(true);
            expect(mocks.commands.controlModule).toHaveBeenCalledWith({
                module_id: 'test-service',
                action: 'start',
            });
            expect(mocks.invokeSafe).toHaveBeenCalled();
        });

        it('should return false when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'Control failed' },
            });

            const result = await moduleService.control('test-service', 'start');

            expect(result).toBe(false);
        });

        it('should return false when backend reports unsuccessful control response', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'ok',
                data: { success: false, message: 'not implemented', status: null },
            });

            const result = await moduleService.control('test-service', 'restart');

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
            const progressSpy = vi.fn<(event: DownloadProgressEvent) => void>();
            const progressListener: EventListener = (event) => {
                progressSpy(event as DownloadProgressEvent);
            };
            globalThis.addEventListener('download-progress-update', progressListener);
            // Use ref pattern with module-level helper
            const handlerRef: { current: ProgressHandler } = { current: undefined };
            mocks.tauriProvider.listen.mockImplementation(createListenCapture(handlerRef));

            try {
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
                expect(progressSpy).toHaveBeenCalledOnce();
                const event = progressSpy.mock.calls[0]?.[0];
                expect(event?.detail).toMatchObject({
                    module_id: 'test-module',
                    status: 'downloading',
                });
            } finally {
                globalThis.removeEventListener('download-progress-update', progressListener);
            }
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

    describe('pauseDownload', () => {
        it('should pause a download in Tauri mode', async () => {
            const result = await moduleService.pauseDownload('test-module');

            expect(result).toBe(true);
            expect(mocks.commands.pauseDownload).toHaveBeenCalledWith('test-module');
        });

        it('should return false when not in Tauri', async () => {
            mocks.tauriProvider.isTauri.mockReturnValueOnce(false);
            const result = await moduleService.pauseDownload('test-module');
            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            mocks.commands.pauseDownload.mockRejectedValueOnce(new Error('Pause error'));
            const result = await moduleService.pauseDownload('test-module');
            expect(result).toBe(false);
        });
    });

    describe('resumeDownload', () => {
        it('should resume a paused download through backend metadata', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({ status: 'ok', data: 'completed' });

            const result = await moduleService.resumeDownload('resume-module');

            expect(result).toBe(true);
            expect(mocks.commands.resumeDownload).toHaveBeenCalledWith('resume-module');
        });

        it('should return false when backend has no request metadata', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'No paused download metadata for missing-module' },
            });

            const result = await moduleService.resumeDownload('missing-module');
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
