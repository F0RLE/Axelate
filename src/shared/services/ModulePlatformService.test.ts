import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModulePlatformService } from './ModulePlatformService';
import type { ModuleService } from './ModuleService';
import type { IApp } from '../types/coreTypes';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

const mocks = vi.hoisted(() => ({
    deleteEngine: vi.fn(),
    invokeSafe: vi.fn(),
}));

vi.mock('@/shared/types/bindings', () => ({
    commands: {
        deleteEngine: (...args: unknown[]): unknown => mocks.deleteEngine(...args),
    },
}));

vi.mock('@/shared/api/invoke', () => ({
    invokeSafe: (...args: unknown[]): unknown => mocks.invokeSafe(...args),
}));

function createMockModuleService(): ModuleService {
    return {
        downloadModule: vi.fn().mockResolvedValue(undefined),
        deleteModule: vi.fn().mockResolvedValue(true),
        control: vi.fn().mockResolvedValue(true),
        pauseDownload: vi.fn().mockResolvedValue(true),
        resumeDownload: vi.fn().mockResolvedValue(true),
        cancelDownload: vi.fn().mockResolvedValue(true),
    } as unknown as ModuleService;
}

function createApp(overrides: Partial<IApp> = {}): IApp {
    return {
        id: 'test-module',
        name: 'Test Module',
        type: 'local',
        repoUrl: 'https://repo.com/module.zip',
        ...overrides,
    } as IApp;
}

describe('ModulePlatformService', () => {
    let moduleService: ModuleService;
    let service: ModulePlatformService;
    let aiBridge: Pick<AIBridge, 'stopProvider' | 'stopEngineSlot' | 'getState'>;
    let tracer: Pick<LoggerService, 'info'>;

    beforeEach(() => {
        moduleService = createMockModuleService();
        aiBridge = {
            stopProvider: vi.fn(),
            stopEngineSlot: vi.fn(),
            getState: vi.fn(() => ({ activeProviderId: 'test-module', isRunning: true })),
        } as unknown as Pick<AIBridge, 'stopProvider' | 'stopEngineSlot' | 'getState'>;
        tracer = { info: vi.fn() };
        service = new ModulePlatformService(() => moduleService, aiBridge as AIBridge, tracer);
        vi.clearAllMocks();
    });

    describe('download', () => {
        it('should download a module with valid repoUrl', async () => {
            const app = createApp({ expectedHash: 'abc123' });
            await service.download(app);
            expect(moduleService.downloadModule).toHaveBeenCalledWith(
                'test-module',
                'https://repo.com/module.zip',
                'abc123',
                undefined,
                undefined,
            );
        });

        it('passes release selection to release downloads', async () => {
            const app = createApp({ dlType: 'release' });
            await service.download(app, {
                tag_name: 'v1.2.3',
                compute_target: 'gpu',
            });

            expect(moduleService.downloadModule).toHaveBeenCalledWith(
                'test-module',
                'https://repo.com/module.zip',
                undefined,
                'release',
                {
                    tag_name: 'v1.2.3',
                    compute_target: 'gpu',
                },
            );
        });

        it('should throw if repoUrl is empty', async () => {
            const app = createApp({ repoUrl: '' });
            await expect(service.download(app)).rejects.toThrow(
                'ui.launcher.web.download_url_empty',
            );
        });

        it('should throw if repoUrl is undefined', async () => {
            const app = createApp();
            delete (app as unknown as Record<string, unknown>)['repoUrl'];
            await expect(service.download(app)).rejects.toThrow(
                'ui.launcher.web.download_url_empty',
            );
        });
    });

    describe('delete', () => {
        it('should delete a module successfully', async () => {
            const app = createApp();
            await service.delete(app);
            expect(moduleService.deleteModule).toHaveBeenCalledWith('test-module');
        });

        it('should throw if delete returns false', async () => {
            (moduleService.deleteModule as ReturnType<typeof vi.fn>).mockResolvedValue(false);
            const app = createApp();
            await expect(service.delete(app)).rejects.toThrow('ui.launcher.web.delete_model_error');
        });

        it('should delete AI engines through the engine command', async () => {
            mocks.deleteEngine.mockReturnValue('delete-engine-promise');
            mocks.invokeSafe.mockResolvedValue({ status: 'ok', data: null });
            const app = createApp({ id: 'llamacpp', type: 'local' });

            await service.delete(app, 'ai_text');

            expect(mocks.deleteEngine).toHaveBeenCalledWith('llamacpp');
            expect(mocks.invokeSafe).toHaveBeenCalledWith('delete-engine-promise');
            expect(moduleService.deleteModule).not.toHaveBeenCalled();
        });

        it('should skip deleting externally managed AI engines', async () => {
            const app = createApp({
                id: 'external-engine',
                type: 'local',
                managedExternally: true,
            });

            await service.delete(app, 'ai_text');

            expect(mocks.deleteEngine).not.toHaveBeenCalled();
            expect(moduleService.deleteModule).not.toHaveBeenCalled();
        });
    });

    describe('stop', () => {
        it('should stop API provider for API modules', async () => {
            const app = createApp({ type: 'api' });
            const result = await service.stop(app);
            expect(result).toBe(true);
            expect(aiBridge.stopProvider).toHaveBeenCalled();
        });

        it('should stop API provider when provider metadata is present', async () => {
            const app = createApp({
                id: 'custom-provider',
                type: 'local',
                apiProviderData: { id: 'custom-provider' },
            });
            (aiBridge.getState as ReturnType<typeof vi.fn>).mockReturnValue({
                activeProviderId: 'custom-provider',
                isRunning: true,
            });
            const result = await service.stop(app);
            expect(result).toBe(true);
            expect(aiBridge.stopProvider).toHaveBeenCalled();
        });

        it('should not stop an inactive API provider', async () => {
            const app = createApp({ id: 'gemini', type: 'api' });
            (aiBridge.getState as ReturnType<typeof vi.fn>).mockReturnValue({
                activeProviderId: 'gpt',
                isRunning: true,
            });

            const result = await service.stop(app);

            expect(result).toBe(false);
            expect(aiBridge.stopProvider).not.toHaveBeenCalled();
        });

        it('should call moduleService.control for local modules', async () => {
            const app = createApp({ id: 'ollama', type: 'local' });
            const result = await service.stop(app);
            expect(result).toBe(true);
            expect(moduleService.control).toHaveBeenCalledWith('ollama', 'stop');
        });

        it('should stop active local AI provider through AIBridge', async () => {
            const app = createApp({ id: 'llamacpp', type: 'local', capability: 'text' });
            (aiBridge.getState as ReturnType<typeof vi.fn>).mockReturnValue({
                activeProviderId: 'llamacpp',
                isRunning: true,
            });

            const result = await service.stop(app);

            expect(result).toBe(true);
            expect(aiBridge.stopProvider).toHaveBeenCalled();
            expect(moduleService.control).not.toHaveBeenCalled();
        });
    });

    describe('cancelDownload', () => {
        it('should cancel a download', async () => {
            const result = await service.cancelDownload('test-module');
            expect(result).toBe(true);
            expect(moduleService.cancelDownload).toHaveBeenCalledWith('test-module');
        });
    });

    describe('pauseDownload', () => {
        it('should pause a download', async () => {
            const result = await service.pauseDownload('test-module');
            expect(result).toBe(true);
            expect(moduleService.pauseDownload).toHaveBeenCalledWith('test-module');
        });
    });

    describe('resumeDownload', () => {
        it('should resume a paused download', async () => {
            const result = await service.resumeDownload('test-module');
            expect(result).toBe(true);
            expect(moduleService.resumeDownload).toHaveBeenCalledWith('test-module');
        });
    });

    describe('isApiModule', () => {
        it('should return true for type "api"', () => {
            expect(service.isApiModule(createApp({ type: 'api' }))).toBe(true);
        });

        it('should return true for type "API" (case insensitive)', () => {
            expect(service.isApiModule(createApp({ type: 'api' }))).toBe(true);
        });

        it('should return true when provider metadata is present', () => {
            expect(
                service.isApiModule(
                    createApp({
                        id: 'custom-provider',
                        type: 'local',
                        apiProviderData: { id: 'custom-provider' },
                    }),
                ),
            ).toBe(true);
        });

        it('should return false for regular local modules', () => {
            expect(service.isApiModule(createApp({ id: 'ollama', type: 'local' }))).toBe(false);
        });
    });
});
