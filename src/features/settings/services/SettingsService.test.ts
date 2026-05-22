import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService } from './SettingsService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type * as Bindings from '@/shared/types/bindings';

const mocks = vi.hoisted(() => ({
    invokeSafe: vi.fn(),
    commands: {
        controlModule: vi.fn(),
        getAgentControlState: vi.fn(),
        setAgentControlEnabled: vi.fn(),
        createAgentProfile: vi.fn(),
        rotateAgentProfile: vi.fn(),
        revokeAgentProfile: vi.fn(),
        deleteAgentProfile: vi.fn(),
        decideAgentApproval: vi.fn(),
    },
}));

vi.mock('@/shared/api/invoke', (): { invokeSafe: (...args: unknown[]) => unknown } => ({
    invokeSafe: (...args: unknown[]): unknown => mocks.invokeSafe(...args) as unknown,
}));

vi.mock('@/shared/types/bindings', async (importOriginal) => {
    const actual = await importOriginal<typeof Bindings>();
    return {
        ...actual,
        commands: {
            ...actual.commands,
            controlModule: mocks.commands.controlModule,
            getAgentControlState: mocks.commands.getAgentControlState,
            setAgentControlEnabled: mocks.commands.setAgentControlEnabled,
            createAgentProfile: mocks.commands.createAgentProfile,
            rotateAgentProfile: mocks.commands.rotateAgentProfile,
            revokeAgentProfile: mocks.commands.revokeAgentProfile,
            deleteAgentProfile: mocks.commands.deleteAgentProfile,
            decideAgentApproval: mocks.commands.decideAgentApproval,
        },
    };
});

function createMockTauri(): TauriProvider {
    return {
        invoke: vi.fn().mockResolvedValue(undefined),
        isTauri: vi.fn(() => true),
        listen: vi.fn().mockResolvedValue(() => {}),
        saveSecureKey: vi.fn().mockResolvedValue(undefined),
        removeSecureKey: vi.fn().mockResolvedValue(undefined),
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
        vi.clearAllMocks();
        tauri = createMockTauri();
        tracer = { error: vi.fn() };
        service = new SettingsService(tauri, tracer);
        mocks.commands.controlModule.mockReturnValue(
            Promise.resolve({
                status: 'ok',
                data: { success: true, message: 'ok', status: 'running' },
            }),
        );
        mocks.invokeSafe.mockImplementation((promise: Promise<unknown>) => promise);
        mocks.commands.getAgentControlState.mockReturnValue(
            Promise.resolve({
                status: 'ok',
                data: {
                    enabled: false,
                    apiBaseUrl: 'http://127.0.0.1:17878',
                    profiles: [],
                    audit: [],
                    approvals: [],
                },
            }),
        );
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
            const result = await service.controlService('start', 'ollama');
            expect(result).toBe(true);
            expect(mocks.commands.controlModule).toHaveBeenCalledWith({
                module_id: 'ollama',
                action: 'start',
            });
            expect(mocks.invokeSafe).toHaveBeenCalled();
        });

        it('should return false on error', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'error',
                error: { message: 'fail' },
            });
            const result = await service.controlService('stop', 'ollama');
            expect(result).toBe(false);
        });

        it('should return false when backend reports unsuccessful control', async () => {
            mocks.invokeSafe.mockResolvedValueOnce({
                status: 'ok',
                data: { success: false, message: 'not implemented', status: null },
            });

            const result = await service.controlService('restart', 'ollama');

            expect(result).toBe(false);
        });
    });

    describe('Agent Control', () => {
        it('should load redacted agent control state', async () => {
            const result = await service.getAgentControlState();

            expect(result.apiBaseUrl).toBe('http://127.0.0.1:17878');
            expect(mocks.commands.getAgentControlState).toHaveBeenCalled();
        });

        it('should create trusted local profiles through generated commands', async () => {
            mocks.commands.createAgentProfile.mockReturnValueOnce(
                Promise.resolve({
                    status: 'ok',
                    data: {
                        profile: {
                            id: 'agent-1',
                            name: 'Trusted Local',
                            scopes: ['observe', 'operate'],
                            tokenPrefix: 'axl_agent_123',
                            createdAt: '2026-05-22T00:00:00Z',
                            lastSeenAt: null,
                            revoked: false,
                        },
                        token: 'axl_agent_123secret',
                    },
                }),
            );

            const result = await service.createAgentProfile('Trusted Local', [
                'observe',
                'operate',
            ]);

            expect(result.token).toBe('axl_agent_123secret');
            expect(mocks.commands.createAgentProfile).toHaveBeenCalledWith('Trusted Local', [
                'observe',
                'operate',
            ]);
        });

        it('should rotate, revoke, delete, toggle, and decide approvals via backend-owned state', async () => {
            const stateResponse = Promise.resolve({
                status: 'ok',
                data: {
                    enabled: true,
                    apiBaseUrl: 'http://127.0.0.1:17878',
                    profiles: [],
                    audit: [],
                    approvals: [],
                },
            });
            mocks.commands.setAgentControlEnabled.mockReturnValueOnce(stateResponse);
            mocks.commands.revokeAgentProfile.mockReturnValueOnce(stateResponse);
            mocks.commands.deleteAgentProfile.mockReturnValueOnce(stateResponse);
            mocks.commands.decideAgentApproval.mockReturnValueOnce(stateResponse);
            mocks.commands.rotateAgentProfile.mockReturnValueOnce(
                Promise.resolve({
                    status: 'ok',
                    data: {
                        profile: {
                            id: 'agent-1',
                            name: 'Trusted Local',
                            scopes: ['observe'],
                            tokenPrefix: 'axl_agent_456',
                            createdAt: '2026-05-22T00:00:00Z',
                            lastSeenAt: null,
                            revoked: false,
                        },
                        token: 'axl_agent_456secret',
                    },
                }),
            );

            await service.setAgentControlEnabled(true);
            await service.rotateAgentProfile('agent-1');
            await service.revokeAgentProfile('agent-1');
            await service.deleteAgentProfile('agent-1');
            await service.decideAgentApproval('approval-1', false);

            expect(mocks.commands.setAgentControlEnabled).toHaveBeenCalledWith(true);
            expect(mocks.commands.rotateAgentProfile).toHaveBeenCalledWith('agent-1');
            expect(mocks.commands.revokeAgentProfile).toHaveBeenCalledWith('agent-1');
            expect(mocks.commands.deleteAgentProfile).toHaveBeenCalledWith('agent-1');
            expect(mocks.commands.decideAgentApproval).toHaveBeenCalledWith('approval-1', false);
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
        it('should store keys in the backend-provided secure service slot', async () => {
            await service.saveSecureKey('cloud_api_key', 'my-api-key');
            expect(tauri.invoke).toHaveBeenCalledWith('save_secure_key', {
                service: 'cloud_api_key',
                key: 'my-api-key',
            });
        });

        it('should handle error gracefully', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
            await expect(service.saveSecureKey('cloud_api_key', 'k')).rejects.toThrow('fail');
        });
    });

    describe('removeSecureKey', () => {
        it('should remove secure key through tauri provider helper', async () => {
            await service.removeSecureKey('cloud_api_key');

            expect(tauri.removeSecureKey).toHaveBeenCalledWith('cloud_api_key');
            expect(tauri.invoke).not.toHaveBeenCalledWith('remove_secure_key', expect.anything());
        });

        it('should fall back to invoke when helper is unavailable', async () => {
            delete (tauri as unknown as { removeSecureKey?: unknown }).removeSecureKey;

            await service.removeSecureKey('cloud_api_key');

            expect(tauri.invoke).toHaveBeenCalledWith('remove_secure_key', {
                service: 'cloud_api_key',
            });
        });

        it('should propagate remove errors', async () => {
            (tauri.removeSecureKey as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('fail'),
            );

            await expect(service.removeSecureKey('cloud_api_key')).rejects.toThrow('fail');
        });
    });

    describe('validateApiKey', () => {
        it('should return true when valid', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            const result = await service.validateApiKey('gemini', 'key');
            expect(result).toBe(true);
            expect(tauri.invoke).toHaveBeenCalledWith('validate_api_key', {
                provider: 'gemini',
                key: 'key',
                baseUrl: null,
            });
        });

        it('should pass custom validation base URLs through to the backend', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

            const result = await service.validateApiKey(
                'custom-text',
                'key',
                'https://api.openai.com/v1',
            );

            expect(result).toBe(true);
            expect(tauri.invoke).toHaveBeenCalledWith('validate_api_key', {
                provider: 'custom-text',
                key: 'key',
                baseUrl: 'https://api.openai.com/v1',
            });
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

            const result = await service.hasSecureKey('cloud_api_key');

            expect(result).toBe(true);
            expect(tauri.invoke).toHaveBeenCalledWith('has_secure_key', {
                service: 'cloud_api_key',
            });
        });

        it('should return false on error', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

            const result = await service.hasSecureKey('cloud_api_key');

            expect(result).toBe(false);
        });
    });

    describe('getSecureKeyMeta', () => {
        it('should return key metadata from backend', async () => {
            const meta = { exists: true, length: 24 };
            (tauri.getSecureKeyMeta as ReturnType<typeof vi.fn>).mockResolvedValue(meta);

            const result = await service.getSecureKeyMeta('cloud_api_key');

            expect(result).toEqual(meta);
            expect(tauri.getSecureKeyMeta).toHaveBeenCalledWith('cloud_api_key');
        });

        it('should return empty metadata on error', async () => {
            (tauri.getSecureKeyMeta as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('fail'),
            );

            const result = await service.getSecureKeyMeta('cloud_api_key');

            expect(result).toEqual({ exists: false, length: 0 });
        });
    });

    describe('getSecureKey', () => {
        it('should return the decrypted key from backend', async () => {
            (tauri.getSecureKey as ReturnType<typeof vi.fn>).mockResolvedValue('secret');

            const result = await service.getSecureKey('cloud_api_key');

            expect(result).toBe('secret');
            expect(tauri.getSecureKey).toHaveBeenCalledWith('cloud_api_key');
        });

        it('should return null on error', async () => {
            (tauri.getSecureKey as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

            const result = await service.getSecureKey('cloud_api_key');

            expect(result).toBeNull();
        });
    });

    describe('validateStoredApiKey', () => {
        it('should validate the stored key via backend', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

            const result = await service.validateStoredApiKey('cloud');

            expect(result).toBe(true);
            expect(tauri.invoke).toHaveBeenCalledWith('validate_stored_api_key', {
                provider: 'cloud',
                baseUrl: null,
            });
        });

        it('should return false when stored-key validation fails', async () => {
            (tauri.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

            const result = await service.validateStoredApiKey('cloud');

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
