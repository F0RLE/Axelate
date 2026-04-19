import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModuleSettingsSpecializedRenderer } from './ModuleSettingsSpecializedRenderer';
import type { IModuleSettingsUIContext } from './SettingsContext';

function createRendererHarness(options?: {
    settings?: Record<string, unknown>;
    isTauri?: boolean;
    launchAction?: string;
}) {
    const showToast = vi.fn();
    const debouncedSave = vi.fn();
    const invoke = vi.fn().mockImplementation((command: string) => {
        if (command === 'launch_module') {
            return Promise.resolve({ action: options?.launchAction });
        }
        return Promise.resolve(null);
    });
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const context: IModuleSettingsUIContext = {
        t: (key: string, defaultValue?: string) => `t:${key}:${defaultValue ?? ''}`,
        showToast,
        i18nUI: { applyTranslations: vi.fn() } as never,
    };

    const renderer = new ModuleSettingsSpecializedRenderer({
        service: {
            getSettings: vi.fn().mockReturnValue(options?.settings ?? {}),
        } as never,
        tauri: {
            isTauri: vi.fn().mockReturnValue(options?.isTauri ?? false),
            invoke,
            openUrl,
        } as never,
        getContext: () => context,
        debouncedSave,
        tracer: {
            error: vi.fn(),
        },
    });

    return {
        renderer,
        debouncedSave,
        invoke,
        openUrl,
        showToast,
    };
}

describe('ModuleSettingsSpecializedRenderer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('should render telegram settings fields and persist normalized topics', () => {
        const { renderer, debouncedSave } = createRendererHarness({
            settings: {
                telegram_topics: 'News: @one | Updates: @two',
                telegram_source_mode: 'web',
            },
        });
        const container = document.createElement('div');

        renderer.renderTelegramBotSettings(container);

        expect(container.textContent).toContain('t:ui.settings.telegram_stub_title:Telegram Bot');
        const topics = container.querySelectorAll('textarea')[0] as HTMLTextAreaElement;
        expect(topics.value).toBe('News: @one\nUpdates: @two');

        topics.value = 'A: @x\nB: @y';
        topics.dispatchEvent(new Event('input', { bubbles: true }));
        expect(debouncedSave).toHaveBeenCalledWith('telegram_topics', 'A: @x | B: @y');

        const sourceMode = container.querySelector('select') as HTMLSelectElement;
        expect(sourceMode.value).toBe('web');
    });

    it('should open comfyui url and start local module when requested', async () => {
        const originalSetTimeout = globalThis.setTimeout;
        vi.stubGlobal('setTimeout', ((callback: TimerHandler) => {
            if (typeof callback === 'function') {
                callback();
            }
            return 0;
        }) as typeof globalThis.setTimeout);

        const { renderer, invoke, openUrl } = createRendererHarness({
            settings: {
                comfyui_base_url: '127.0.0.1:8282/',
            },
            isTauri: true,
            launchAction: 'start_local',
        });
        const container = document.createElement('div');

        renderer.renderComfyUiSettings(container, { id: 'comfyui' } as never);
        const button = container.querySelector('button') as HTMLButtonElement;
        button.click();
        await vi.waitFor(() => {
            expect(openUrl).toHaveBeenCalled();
        });

        expect(invoke).toHaveBeenCalledWith('launch_module', { moduleId: 'comfyui' });
        expect(invoke).toHaveBeenCalledWith('control_module', {
            request: {
                module_id: 'comfyui',
                action: 'start',
            },
        });
        expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:8282');

        vi.stubGlobal('setTimeout', originalSetTimeout);
    });
});
