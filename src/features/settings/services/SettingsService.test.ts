import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService } from './SettingsService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

function createMockTauri(): TauriProvider {
    return {
        invoke: vi.fn().mockResolvedValue(undefined),
        isTauri: vi.fn(() => true),
        listen: vi.fn().mockResolvedValue(() => {}),
        saveSecureKey: vi.fn().mockResolvedValue(undefined),
        getSecureKey: vi.fn().mockResolvedValue(null),
        hasSecureKey: vi.fn().mockResolvedValue(false),
        getSecureKeyMeta: vi.fn().mockResolvedValue({ exists: false, length: 0 }),
    } as unknown as TauriProvider;
}

describe('SettingsService', () => {
    let tauri: TauriProvider;
    let service: SettingsService;
    let tracer: Pick<LoggerService, 'error'>;

    beforeEach(() => {
        tauri = createMockTauri();
        tracer = { error: vi.fn() };
        service = new SettingsService(tauri, tracer);
    });

    describe('loadSettings', () => {
        it('should load settings from backend', async () => {
            const mockSettings = { language: 'en', theme: 'dark' };
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);

            const result = await service.loadSettings();
            expect(tauri.invoke).toHaveBeenCalledWith('get_settings');
            expect(result).toEqual(expect.objectContaining(mockSettings));
        });

        it('should return current settings on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            const result = await service.loadSettings();
            expect(result).toBeDefined();
        });
    });

    describe('set', () => {
        it('should set value locally and trigger save', () => {
            const saveSpy = vi.spyOn(service, 'saveSetting').mockResolvedValue(undefined);
            service.set('language', 'ru');
            expect(service.getSettings()).toEqual(expect.objectContaining({ language: 'ru' }));
            expect(saveSpy).toHaveBeenCalled();
        });
    });

    describe('saveSetting', () => {
        it('should invoke backend with key and stringified value', async () => {
            await service.saveSetting('theme', 'dark');
            expect(tauri.invoke).toHaveBeenCalledWith('save_setting', {
                key: 'theme',
                value: 'dark',
            });
        });

        it('should preserve numeric values in local cache', async () => {
            await service.saveSetting('download_max_speed', 120);

            expect(service.getSettings()).toEqual(
                expect.objectContaining({ download_max_speed: 120 }),
            );
            expect(tauri.invoke).toHaveBeenCalledWith('save_setting', {
                key: 'download_max_speed',
                value: '120',
            });
        });

        it('should preserve boolean values in local cache', async () => {
            await service.saveSetting('debug_mode', true);

            expect(service.getSettings()).toEqual(expect.objectContaining({ debug_mode: true }));
            expect(tauri.invoke).toHaveBeenCalledWith('save_setting', {
                key: 'debug_mode',
                value: 'true',
            });
        });
    });

    describe('updateSettings', () => {
        it('should save each key individually', async () => {
            const saveSpy = vi.spyOn(service, 'saveSetting').mockResolvedValue(undefined);
            await service.updateSettings({ language: 'en' } as Parameters<
                typeof service.updateSettings
            >[0]);
            expect(saveSpy).toHaveBeenCalledWith('language', 'en');
        });

        it('should iterate and save multiple keys (L54)', async () => {
            const saveSpy = vi.spyOn(service, 'saveSetting').mockResolvedValue(undefined);
            await service.updateSettings({ language: 'ru', theme: 'light' } as Parameters<
                typeof service.updateSettings
            >[0]);
            expect(saveSpy).toHaveBeenCalledWith('language', 'ru');
            expect(saveSpy).toHaveBeenCalledWith('theme', 'light');
            expect(saveSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('controlService', () => {
        it('should return true on success', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
            const result = await service.controlService('start', 'ollama');
            expect(result).toBe(true);
            expect(tauri.invoke).toHaveBeenCalledWith('control_service', {
                action: 'start',
                service: 'ollama',
            });
        });

        it('should return false on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            const result = await service.controlService('stop', 'ollama');
            expect(result).toBe(false);
        });
    });

    describe('loadGpuInfo', () => {
        it('should return GPU info from backend', async () => {
            const gpuInfo = {
                detected: true,
                name: 'NVIDIA RTX 4090',
                cuda: true,
                backend: 'cuda',
                memory: 24576,
            };
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(gpuInfo);
            const result = await service.loadGpuInfo();
            expect(result).toEqual(gpuInfo);
        });

        it('should cache GPU info requests', async () => {
            const gpuInfo = {
                detected: true,
                name: 'NVIDIA RTX 4090',
                cuda: true,
                backend: 'cuda',
                memory: 24576,
            };
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(gpuInfo);

            const [first, second] = await Promise.all([
                service.loadGpuInfo(),
                service.loadGpuInfo(),
            ]);

            expect(first).toEqual(gpuInfo);
            expect(second).toEqual(gpuInfo);
            expect(tauri.invoke).toHaveBeenCalledTimes(1);
            expect(tauri.invoke).toHaveBeenCalledWith('get_gpu_info');
        });

        it('should return default on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            const result = await service.loadGpuInfo();
            expect(result).toEqual({ detected: false });
        });
    });

    describe('getModules', () => {
        it('should return modules from backend', async () => {
            const modules = [{ id: 'mod1', name: 'Module 1' }];
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(modules);
            const result = await service.getModules();
            expect(result).toEqual(modules);
        });

        it('should return empty array on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            const result = await service.getModules();
            expect(result).toEqual([]);
        });
    });

    describe('saveSecureKey', () => {
        it('should invoke save_secure_key with correct args', async () => {
            await service.saveSecureKey('gemini', 'my-api-key');
            expect(tauri.invoke).toHaveBeenCalledWith('save_secure_key', {
                service: 'gemini_api_key',
                key: 'my-api-key',
            });
        });

        it('should handle error gracefully', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            await expect(service.saveSecureKey('x', 'k')).rejects.toThrow('fail');
        });
    });

    describe('validateApiKey', () => {
        it('should return true when valid', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            const result = await service.validateApiKey('gemini', 'key');
            expect(result).toBe(true);
        });

        it('should return false on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            const result = await service.validateApiKey('gemini', 'key');
            expect(result).toBe(false);
        });
    });

    describe('hasSecureKey', () => {
        it('should return true when a stored key exists', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

            const result = await service.hasSecureKey('gemini');

            expect(result).toBe(true);
            expect(tauri.invoke).toHaveBeenCalledWith('has_secure_key', {
                service: 'gemini_api_key',
            });
        });

        it('should return false on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

            const result = await service.hasSecureKey('gemini');

            expect(result).toBe(false);
        });
    });

    describe('getSecureKeyMeta', () => {
        it('should return key metadata from backend', async () => {
            const meta = { exists: true, length: 24 };
            (tauri.getSecureKeyMeta as ReturnType<typeof vi.fn>).mockResolvedValue(meta);

            const result = await service.getSecureKeyMeta('gemini');

            expect(result).toEqual(meta);
            expect(tauri.getSecureKeyMeta).toHaveBeenCalledWith('gemini_api_key');
        });

        it('should return empty metadata on error', async () => {
            (tauri.getSecureKeyMeta as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('fail'),
            );

            const result = await service.getSecureKeyMeta('gemini');

            expect(result).toEqual({ exists: false, length: 0 });
        });
    });

    describe('getSecureKey', () => {
        it('should return the decrypted key from backend', async () => {
            (tauri.getSecureKey as ReturnType<typeof vi.fn>).mockResolvedValue('secret');

            const result = await service.getSecureKey('gemini');

            expect(result).toBe('secret');
            expect(tauri.getSecureKey).toHaveBeenCalledWith('gemini_api_key');
        });

        it('should return null on error', async () => {
            (tauri.getSecureKey as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

            const result = await service.getSecureKey('gemini');

            expect(result).toBeNull();
        });
    });

    describe('validateStoredApiKey', () => {
        it('should validate the stored key via backend', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

            const result = await service.validateStoredApiKey('openrouter');

            expect(result).toBe(true);
            expect(tauri.invoke).toHaveBeenCalledWith('validate_stored_api_key', {
                provider: 'openrouter',
            });
        });

        it('should return false when stored-key validation fails', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

            const result = await service.validateStoredApiKey('openrouter');

            expect(result).toBe(false);
        });
    });

    describe('addCustomModel', () => {
        it('should invoke add_custom_model', async () => {
            await service.addCustomModel('gemini', 'custom-1', 'My Model');
            expect(tauri.invoke).toHaveBeenCalledWith('add_custom_model', {
                providerId: 'gemini',
                id: 'custom-1',
                name: 'My Model',
                baseModelId: 'custom-1',
            });
        });

        it('should rethrow errors', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            await expect(service.addCustomModel('x', 'y', 'z')).rejects.toThrow('fail');
        });
    });

    describe('addCustomModelWithBase', () => {
        it('should invoke add_custom_model with provided base model id', async () => {
            await service.addCustomModelWithBase(
                'gemini-image',
                'black-forest-labs/flux.2-max',
                'FLUX.2 Max',
                'google/gemini-3-pro-image-preview',
            );

            expect(tauri.invoke).toHaveBeenCalledWith('add_custom_model', {
                providerId: 'gemini-image',
                id: 'black-forest-labs/flux.2-max',
                name: 'FLUX.2 Max',
                baseModelId: 'google/gemini-3-pro-image-preview',
            });
        });
    });

    describe('getCustomModels', () => {
        it('should return models from backend', async () => {
            const models = [{ id: 'm1', name: 'Model 1' }];
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(models);
            const result = await service.getCustomModels();
            expect(result).toEqual(models);
        });

        it('should return empty array on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            const result = await service.getCustomModels();
            expect(result).toEqual([]);
        });
    });

    describe('removeCustomModel', () => {
        it('should invoke remove_custom_model', async () => {
            await service.removeCustomModel('custom-1');

            expect(tauri.invoke).toHaveBeenCalledWith('remove_custom_model', {
                id: 'custom-1',
            });
        });

        it('should rethrow remove errors', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

            await expect(service.removeCustomModel('custom-1')).rejects.toThrow('fail');
        });
    });
});
