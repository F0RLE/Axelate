import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModuleSettingsSpecializedRenderer } from './ModuleSettingsSpecializedRenderer';
import type { IModuleSettingsUIContext } from './SettingsContext';

function createRendererHarness(options?: {
    settings?: Record<string, unknown>;
}) {
    const showToast = vi.fn();
    const debouncedSave = vi.fn();
    const context: IModuleSettingsUIContext = {
        t: (key: string, defaultValue?: string) => `t:${key}:${defaultValue ?? ''}`,
        showToast,
        i18nUI: { applyTranslations: vi.fn() } as never,
    };

    const renderer = new ModuleSettingsSpecializedRenderer({
        service: {
            getSettings: vi.fn().mockReturnValue(options?.settings ?? {}),
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
});
