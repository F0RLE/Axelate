import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../types/coreTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { AppUiModuleLifecycle } from './AppUiModuleLifecycle';

describe('AppUiModuleLifecycle', () => {
    const platformService = {
        stop: vi.fn(),
        isApiModule: vi.fn(() => false),
    };

    const getSelectedApp = vi.fn();
    const isSelectedInAnotherAiSlot = vi.fn();
    const resolveAppById = vi.fn();
    const translate = vi.fn((_key: string, fallback: string) => fallback);
    const showToast = vi.fn();

    let lifecycle: AppUiModuleLifecycle;

    beforeEach(() => {
        vi.clearAllMocks();
        lifecycle = new AppUiModuleLifecycle({
            platformService: platformService as never,
            tracer: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            } as unknown as LoggerService,
            getSelectedApp,
            isSelectedInAnotherAiSlot,
            resolveAppById,
            translate,
            showToast,
        });
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
        expect(showToast).toHaveBeenCalledWith('Old Service stopped', 'info');
    });
});
