import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '@/shared/types/coreTypes';
import { ModuleSettingsBridgeController } from './ModuleSettingsBridgeController';

describe('ModuleSettingsBridgeController', () => {
    beforeEach(() => {
        delete (globalThis as unknown as Record<string, unknown>)['openModuleSettings'];
        delete (globalThis as unknown as Record<string, unknown>)['setCardWidth'];
    });

    it('installs and uninstalls global bridge handlers', async () => {
        const controller = new ModuleSettingsBridgeController();
        const openModuleSettings = vi.fn<(...args: [IApp]) => Promise<void>>().mockResolvedValue(
            undefined,
        );
        const setCardWidth = vi.fn();
        const app = { id: 'svc' } as IApp;
        const btn = document.createElement('button');

        controller.install(openModuleSettings, setCardWidth);
        (globalThis as unknown as { openModuleSettings: (app: IApp) => void }).openModuleSettings(
            app,
        );
        (
            globalThis as unknown as { setCardWidth: (btn: HTMLElement, width: string) => void }
        ).setCardWidth(btn, '420px');
        await Promise.resolve();

        expect(openModuleSettings).toHaveBeenCalledWith(app);
        expect(setCardWidth).toHaveBeenCalledWith(btn, '420px');

        controller.uninstall();
        expect('openModuleSettings' in globalThis).toBe(false);
        expect('setCardWidth' in globalThis).toBe(false);
    });
});
