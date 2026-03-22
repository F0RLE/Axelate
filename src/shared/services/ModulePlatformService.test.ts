import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModulePlatformService } from './ModulePlatformService';
import type { ModuleService } from './ModuleService';
import type { IApp } from '../types/coreTypes';

// Mock the aiBridge import
vi.mock('@/features/ai/services/AIBridge', () => ({
    aiBridge: {
        stopProvider: vi.fn(),
        getState: vi.fn(() => ({ activeProviderId: 'test-module' })),
    },
}));

function createMockModuleService(): ModuleService {
    return {
        downloadModule: vi.fn().mockResolvedValue(undefined),
        deleteModule: vi.fn().mockResolvedValue(true),
        control: vi.fn().mockResolvedValue(true),
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

    beforeEach(() => {
        moduleService = createMockModuleService();
        service = new ModulePlatformService(() => moduleService);
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
    });

    describe('stop', () => {
        it('should stop API provider for API modules', async () => {
            const { aiBridge } = await import('@/features/ai/services/AIBridge');
            const app = createApp({ type: 'api' });
            const result = await service.stop(app);
            expect(result).toBe(true);
            expect(aiBridge.stopProvider).toHaveBeenCalled();
        });

        it('should stop API provider when provider metadata is present', async () => {
            const { aiBridge } = await import('@/features/ai/services/AIBridge');
            const app = createApp({
                id: 'custom-provider',
                type: 'local',
                apiProviderData: { id: 'custom-provider' },
            });
            (aiBridge.getState as ReturnType<typeof vi.fn>).mockReturnValue({
                activeProviderId: 'custom-provider',
            });
            const result = await service.stop(app);
            expect(result).toBe(true);
            expect(aiBridge.stopProvider).toHaveBeenCalled();
        });

        it('should not stop an inactive API provider', async () => {
            const { aiBridge } = await import('@/features/ai/services/AIBridge');
            const app = createApp({ id: 'gemini', type: 'api' });
            (aiBridge.getState as ReturnType<typeof vi.fn>).mockReturnValue({
                activeProviderId: 'gpt',
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
    });

    describe('cancelDownload', () => {
        it('should cancel a download', async () => {
            const result = await service.cancelDownload('test-module');
            expect(result).toBe(true);
            expect(moduleService.cancelDownload).toHaveBeenCalledWith('test-module');
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
