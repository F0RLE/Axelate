import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runCoreBootstrap: vi.fn(),
    initializeDeferredUi: vi.fn(),
    restoreSelectedModules: vi.fn(),
    destroyCoreResources: vi.fn(),
}));

vi.mock('./CoreBootstrapRunner', () => ({
    runCoreBootstrap: mocks.runCoreBootstrap,
}));

vi.mock('./CoreRuntimeSupport', () => ({
    initializeDeferredUi: mocks.initializeDeferredUi,
    restoreSelectedModules: mocks.restoreSelectedModules,
}));

vi.mock('./CoreComposition', () => ({
    destroyCoreResources: mocks.destroyCoreResources,
}));

import { CoreLifecycleController, type CoreLifecycleDeps } from './CoreLifecycleController';

function createDeps(isDestroyed: () => boolean): CoreLifecycleDeps {
    const tauriProvider = {
        isTauri: vi.fn(() => true),
        listen: vi.fn().mockResolvedValue(vi.fn()),
    };
    return {
        bootstrap: {
            aiBridge: {},
            tauriProvider,
            tracer: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            templateLoader: {},
            stateStore: {},
            windowService: {},
            windowUI: {},
            i18n: {},
            i18nUI: {},
            catalog: {},
            navigation: {},
            navigationUI: {},
            chatController: { init: vi.fn(), destroy: vi.fn() },
            bridge: {},
            eventHandler: {},
        },
        immediateUi: {
            navigation: {},
            navigationUI: {},
            downloadUI: {},
            moduleService: {},
            sidebarUI: {},
        },
        deferredUi: {
            settingsService: {},
            monitoringUI: {},
            settingsUI: {},
            moduleSettingsUI: {},
            i18nUI: {},
            consoleUI: {},
            tracer: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            moduleSettings: {},
            catalog: {},
            appUI: {},
            aiBridge: {},
        },
        backendSelection: {
            tauriProvider,
            stateStore: { updateNestedState: vi.fn() },
            appUI: { updateModuleCard: vi.fn() },
        },
        disposables: {
            stateManager: {},
            eventHandler: {},
            chatController: {},
            appUI: {},
            settingsUI: {},
            moduleSettingsUI: {},
            downloadUI: {},
            navigationUI: {},
            windowUI: {},
            windowService: {},
            moduleService: {},
            i18nUI: {},
            consoleUI: {},
            monitoringUI: {},
            monitoringService: {},
            sidebarUI: {},
            particles: {},
            soundService: {},
            stateStore: {},
            aiBridge: {},
            bridge: {},
            errorHandler: {},
            globalTextContextMenu: { init: vi.fn(), destroy: vi.fn() },
        },
        state: { isDestroyed },
        globalShortcutKeydown: vi.fn(),
    } as unknown as CoreLifecycleDeps;
}

describe('CoreLifecycleController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runCoreBootstrap.mockResolvedValue({ currentPage: 'home' });
        mocks.initializeDeferredUi.mockResolvedValue(undefined);
    });

    it('stops async initialization after bootstrap if core was destroyed', async () => {
        const deps = createDeps(() => true);
        const controller = new CoreLifecycleController(deps);

        await controller.runInit();

        expect(mocks.initializeDeferredUi).not.toHaveBeenCalled();
        expect(deps.backendSelection.tauriProvider.listen).not.toHaveBeenCalled();
        expect(deps.bootstrap.tracer.info).not.toHaveBeenCalledWith('[Core] Ready.');
    });

    it('unsubscribes backend selection listener if destroy happens while subscribing', async () => {
        let destroyed = false;
        const unlisten = vi.fn();
        const deps = createDeps(() => destroyed);
        vi.mocked(deps.backendSelection.tauriProvider.listen).mockImplementationOnce(() => {
            destroyed = true;
            return Promise.resolve(unlisten);
        });
        const controller = new CoreLifecycleController(deps);

        await controller.runInit();

        expect(unlisten).toHaveBeenCalledTimes(1);
        expect(deps.bootstrap.tracer.info).not.toHaveBeenCalledWith('[Core] Ready.');
    });
});
