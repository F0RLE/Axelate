import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '@/shared/types/coreTypes';
import { ModuleSettingsBridgeController } from './ModuleSettingsBridgeController';

describe('ModuleSettingsBridgeController', () => {
    beforeEach(() => {
        delete (globalThis as unknown as Record<string, unknown>)['openModuleSettings'];
    });

    it('installs and uninstalls global openModuleSettings bridge handler', async () => {
        const controller = new ModuleSettingsBridgeController({
            error: vi.fn(),
        });
        const openModuleSettings = vi
            .fn<(...args: [IApp]) => Promise<void>>()
            .mockResolvedValue(undefined);
        const app = { id: 'svc' } as IApp;

        controller.install(openModuleSettings);
        (globalThis as unknown as { openModuleSettings: (app: IApp) => void }).openModuleSettings(
            app,
        );
        await Promise.resolve();

        expect(openModuleSettings).toHaveBeenCalledWith(app);

        controller.uninstall();
        expect('openModuleSettings' in globalThis).toBe(false);
    });
});
