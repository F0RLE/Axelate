import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../types/coreTypes';
import { AppUiModuleLifecycle } from './AppUiModuleLifecycle';

describe('AppUiModuleLifecycle', () => {
    const platformService = {
        stop: vi.fn(),
        isApiModule: vi.fn(() => false),
    };

    const getSelectedApp = vi.fn();
    const isSelectedInAnotherAiSlot = vi.fn();
    const resolveAppById = vi.fn();

    let lifecycle: AppUiModuleLifecycle;

    beforeEach(() => {
        vi.clearAllMocks();
        lifecycle = new AppUiModuleLifecycle({
            platformService: platformService as never,
            getSelectedApp,
            isSelectedInAnotherAiSlot,
            resolveAppById,
        });
        (globalThis as unknown as { t?: (key: string, fallback: string) => string }).t = (
            _key,
            fallback,
        ) => fallback;
        (globalThis as unknown as { showToast?: ReturnType<typeof vi.fn> }).showToast = vi.fn();
    });

    it('stops stale launched module after quick reselection', async () => {
        let releaseFirstLaunch!: () => void;
        const firstLaunchPromise = new Promise<void>((resolve) => {
            releaseFirstLaunch = resolve;
        });
        const launchApp = vi
            .fn<(...args: [string]) => Promise<void>>()
            .mockImplementationOnce(async () => firstLaunchPromise);

        const app = { id: 'svc-a', name: 'Service A' } as IApp;
        const version = lifecycle.bumpLaunchSelectionVersion('services');
        platformService.stop.mockResolvedValue(undefined);
        getSelectedApp.mockReturnValue({ id: 'svc-b' });

        const pending = lifecycle.launchSelectedApp('services', app, version, launchApp);
        releaseFirstLaunch();
        await pending;

        expect(platformService.stop).toHaveBeenCalledWith(app);
    });

    it('stops previous module and shows toast for local app', async () => {
        const card = document.createElement('div');
        card.dataset['currentModule'] = 'svc-old';
        card.dataset['currentModuleName'] = 'Old Service';
        const nextApp = { id: 'svc-new', name: 'New Service' } as IApp;
        const previousApp = { id: 'svc-old', name: 'Old Service' } as IApp;
        resolveAppById.mockReturnValue(previousApp);
        platformService.stop.mockResolvedValue(undefined);

        lifecycle.stopPreviousModule(card, nextApp, 'services');
        await Promise.resolve();

        expect(platformService.stop).toHaveBeenCalledWith(previousApp);
        expect(
            (globalThis as unknown as { showToast: ReturnType<typeof vi.fn> }).showToast,
        ).toHaveBeenCalledWith('Old Service stopped', 'info');
    });
});
