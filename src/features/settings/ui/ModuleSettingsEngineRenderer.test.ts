import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleSettingsEngineRenderer } from './ModuleSettingsEngineRenderer';
import { open } from '@tauri-apps/plugin-dialog';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

describe('ModuleSettingsEngineRenderer model picker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function createRenderer(): ModuleSettingsEngineRenderer {
        return new ModuleSettingsEngineRenderer({
            service: {
                getSettings: vi.fn().mockReturnValue({}),
            } as never,
            tauri: {} as never,
            engineConfigService: {} as never,
            getContext: () => ({
                t: (_key: string, defaultValue?: string) => defaultValue ?? '',
                showToast: vi.fn(),
                i18nUI: { applyTranslations: vi.fn() } as never,
            }),
            registerCleanup: vi.fn(),
            debouncedSave: vi.fn(),
            showSaveIndicator: vi.fn(),
        });
    }

    it('should allow both gguf and safetensors for image engines', async () => {
        vi.mocked(open).mockResolvedValue('C:\\Models\\sd.gguf');
        const renderer = createRenderer() as any;
        const container = document.createElement('div');
        const input = document.createElement('input');

        renderer._addFileBrowseButton(container, input, true);
        const button = container.querySelector('button');
        expect(button).toBeInstanceOf(HTMLButtonElement);

        (button as HTMLButtonElement).click();
        await vi.waitFor(() => {
            expect(open).toHaveBeenCalled();
        });

        expect(open).toHaveBeenCalledWith(
            expect.objectContaining({
                filters: [
                    { name: 'SD Models', extensions: ['gguf', 'safetensors'] },
                    { name: 'GGUF Models', extensions: ['gguf'] },
                    { name: 'SafeTensors', extensions: ['safetensors'] },
                ],
            }),
        );
        expect(input.dataset['fullPath']).toBe('C:\\Models\\sd.gguf');
        expect(input.value).toBe('sd.gguf');
    });
});
