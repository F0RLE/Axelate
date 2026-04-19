import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initRenderer = vi.fn();
const destroyRenderer = vi.fn();

vi.mock('./GeneralSettingsRenderer', () => ({
    GeneralSettingsRenderer: class {
        public init = initRenderer;
        public destroy = destroyRenderer;
    },
}));

import { SettingsUI } from './SettingsUI';
import type { SettingsService } from '../services/SettingsService';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';

describe('SettingsUI page lifecycle', () => {
    let settingsUI: SettingsUI | null = null;
    let showToastMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        initRenderer.mockReset();
        destroyRenderer.mockReset();
        document.body.innerHTML = '';
        (
            globalThis as unknown as {
                t?: (key: string, defaultValue?: string) => string;
            }
        ).t = (_key, defaultValue) => defaultValue ?? '';
        showToastMock = vi.fn();
    });

    afterEach(() => {
        settingsUI?.destroy();
        settingsUI = null;
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    function createSettingsUI(): SettingsUI {
        settingsUI = new SettingsUI(
            {} as SettingsService,
            {} as UISettingsService,
            {} as AISettingsService,
            { t: (_key: string, defaultValue = '') => defaultValue } as unknown as I18nService,
            { applyTranslations: vi.fn() } as unknown as I18nUI,
            {} as TauriProvider,
            {} as NavigationService,
            {
                tracer: {
                    info: vi.fn(),
                    error: vi.fn(),
                } as unknown as LoggerService,
                showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => {
                    (
                        showToastMock as (
                            message: string,
                            type?: 'success' | 'error' | 'warning' | 'info',
                        ) => void
                    )(message, type);
                },
            },
        );

        return settingsUI;
    }

    it('should initialize renderer immediately when container exists', async () => {
        document.body.innerHTML = '<div id="settings-grid"></div>';
        const ui = createSettingsUI();

        await ui.init();

        expect(initRenderer).toHaveBeenCalledTimes(1);
    });

    it('should wait for container insertion without polling loops', async () => {
        const ui = createSettingsUI();
        const initPromise = ui.init();

        expect(initRenderer).not.toHaveBeenCalled();

        const container = document.createElement('div');
        container.id = 'settings-grid';
        document.body.appendChild(container);

        await initPromise;

        expect(initRenderer).toHaveBeenCalledTimes(1);
    });

    it('should abort pending wait when destroyed before container appears', async () => {
        const ui = createSettingsUI();
        const initPromise = ui.init();

        ui.destroy();
        await initPromise;

        expect(initRenderer).not.toHaveBeenCalled();
        expect(destroyRenderer).toHaveBeenCalledTimes(1);
    });
});
