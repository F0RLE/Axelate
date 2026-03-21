import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineConfigService, type EngineConfig } from './EngineConfigService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';

describe('EngineConfigService', () => {
    let tauri: TauriProvider;
    let service: EngineConfigService;

    const config: EngineConfig = {
        engine_id: 'llamacpp',
        port: 8080,
        gpu_layers: 33,
        context_size: 8192,
        model_path: 'C:/models/model.gguf',
        extra_args: ['--flash-attn'],
    };

    beforeEach(() => {
        tauri = {
            isTauri: vi.fn().mockReturnValue(true),
            invoke: vi.fn(),
        } as unknown as TauriProvider;
        service = new EngineConfigService(tauri);
    });

    it('returns null on web without invoking backend', async () => {
        vi.mocked(tauri.isTauri).mockReturnValue(false);

        await expect(service.getConfig('llamacpp')).resolves.toBeNull();
        expect(tauri.invoke).not.toHaveBeenCalled();
    });

    it('loads config from backend in tauri mode', async () => {
        vi.mocked(tauri.invoke).mockResolvedValue(config);

        await expect(service.getConfig('llamacpp')).resolves.toEqual(config);
        expect(tauri.invoke).toHaveBeenCalledWith('get_engine_config', { engineId: 'llamacpp' });
    });

    it('returns null when backend get fails', async () => {
        vi.mocked(tauri.invoke).mockRejectedValue(new Error('broken'));

        await expect(service.getConfig('llamacpp')).resolves.toBeNull();
    });

    it('skips saving config outside tauri', async () => {
        vi.mocked(tauri.isTauri).mockReturnValue(false);

        await expect(service.setConfig(config)).resolves.toBeUndefined();
        expect(tauri.invoke).not.toHaveBeenCalled();
    });

    it('saves config and swallows backend errors', async () => {
        vi.mocked(tauri.invoke).mockResolvedValue(undefined);
        await expect(service.setConfig(config)).resolves.toBeUndefined();
        expect(tauri.invoke).toHaveBeenCalledWith('set_engine_config', { config });

        vi.mocked(tauri.invoke).mockRejectedValueOnce(new Error('save failed'));
        await expect(service.setConfig(config)).resolves.toBeUndefined();
    });
});
