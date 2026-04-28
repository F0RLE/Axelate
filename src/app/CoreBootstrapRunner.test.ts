import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCoreBootstrap } from './CoreBootstrapRunner';

const bootstrapData = {
    uiState: {
        preferred_language: 'en',
        last_page: 'settings',
        pending_chat_reveal: false,
    },
    windowConfig: { minWidth: 800 },
    systemLanguage: 'en',
    initialZoom: 1,
};

function createRunnerDeps() {
    const callOrder: string[] = [];
    const record = (label: string) =>
        vi.fn(() => {
            callOrder.push(label);
        });
    const recordAsync = (label: string) =>
        vi.fn(() => {
            callOrder.push(label);
            return Promise.resolve();
        });

    const bootstrap = {
        tauriProvider: {
            invoke: vi.fn((command: string) => {
                callOrder.push(`invoke:${command}`);
                return Promise.resolve(bootstrapData);
            }),
        },
        tracer: {
            debug: record('tracer:debug'),
            info: record('tracer:info'),
            warn: record('tracer:warn'),
            error: record('tracer:error'),
        },
        templateLoader: {
            loadAndInject: vi.fn(() => Promise.resolve(true)),
        },
        stateStore: {
            setState: record('state:set'),
            getState: vi.fn(() => bootstrapData.uiState),
        },
        windowService: {
            init: recordAsync('window:init'),
            show: recordAsync('window:show'),
        },
        windowUI: {
            init: record('window-ui:init'),
            hideSplashScreen: record('window-ui:hide-splash'),
        },
        i18n: {
            init: recordAsync('i18n:init'),
        },
        i18nUI: {
            applyTranslations: record('i18n-ui:apply'),
        },
        catalog: {
            loadCatalog: recordAsync('catalog:load'),
        },
        navigation: {
            refreshFromUiState: record('navigation:refresh'),
            getCurrentPage: vi.fn(() => 'settings'),
        },
        navigationUI: {
            showPage: recordAsync('navigation-ui:show-page'),
            init: record('navigation-ui:init'),
        },
        chatController: {
            init: record('chat:init'),
        },
        aiBridge: {
            init: recordAsync('ai-bridge:init'),
        },
        bridge: {
            init: record('bridge:init'),
        },
        eventHandler: {
            init: record('event-handler:init'),
        },
    };

    const immediateUi = {
        navigation: bootstrap.navigation,
        navigationUI: bootstrap.navigationUI,
        downloadUI: {
            init: record('download:init'),
        },
        moduleService: {
            init: record('module:init'),
        },
        sidebarUI: {
            init: recordAsync('sidebar:init'),
        },
    };

    return { bootstrap, immediateUi, callOrder };
}

describe('CoreBootstrapRunner', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                callback(0);
                return 0;
            }),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should run bootstrap before immediate UI and splash reveal', async () => {
        const { bootstrap, immediateUi, callOrder } = createRunnerDeps();
        const registerGlobalShortcuts = vi.fn(() => {
            callOrder.push('shortcuts:register');
        });

        const result = await runCoreBootstrap({
            bootstrap: bootstrap as never,
            immediateUi: immediateUi as never,
            registerGlobalShortcuts,
        });

        expect(result.currentPage).toBe('settings');
        expect(bootstrap.bridge.init.mock.invocationCallOrder[0]).toBeLessThan(
            bootstrap.eventHandler.init.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
        );
        expect(bootstrap.aiBridge.init.mock.invocationCallOrder[0]).toBeLessThan(
            bootstrap.templateLoader.loadAndInject.mock.invocationCallOrder[0] ??
                Number.POSITIVE_INFINITY,
        );
        expect(bootstrap.templateLoader.loadAndInject).toHaveBeenCalledTimes(8);
        expect(immediateUi.sidebarUI.init.mock.invocationCallOrder[0]).toBeLessThan(
            immediateUi.navigationUI.init.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
        );
        expect(registerGlobalShortcuts.mock.invocationCallOrder[0]).toBeLessThan(
            bootstrap.windowUI.hideSplashScreen.mock.invocationCallOrder[0] ??
                Number.POSITIVE_INFINITY,
        );
        expect(callOrder).toContain('window-ui:hide-splash');
    });

    it('should reveal the window and rethrow when critical bootstrap fails', async () => {
        const { bootstrap, immediateUi } = createRunnerDeps();
        const failure = new Error('bootstrap failed');
        bootstrap.windowService.init.mockRejectedValueOnce(failure);

        await expect(
            runCoreBootstrap({
                bootstrap: bootstrap as never,
                immediateUi: immediateUi as never,
                registerGlobalShortcuts: vi.fn(),
            }),
        ).rejects.toThrow(failure);

        expect(bootstrap.windowService.show).toHaveBeenCalledTimes(1);
        expect(bootstrap.windowUI.hideSplashScreen).toHaveBeenCalledTimes(1);
        expect(bootstrap.tracer.error).toHaveBeenCalledWith(
            '[Core] Critical bootstrap failure: Error: bootstrap failed',
        );
    });
});
