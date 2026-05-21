import {
    applyPlatformTheme,
    createBootstrapSafetyRevealTimer,
    fetchBootstrapData,
    hydrateCriticalServices,
    initializeImmediateUi,
    showInitialPage,
    waitForNextPaintCycle,
} from './CoreRuntimeSupport';
import type { CoreBootstrapDeps, CoreImmediateUiDeps } from './CoreLifecycleController';

type RunCoreBootstrapArgs = {
    bootstrap: CoreBootstrapDeps;
    immediateUi: CoreImmediateUiDeps;
    registerGlobalShortcuts: () => void;
};

export type CoreBootstrapResult = {
    currentPage: string | null;
};

export async function runCoreBootstrap(args: RunCoreBootstrapArgs): Promise<CoreBootstrapResult> {
    const { bootstrap } = args;
    bootstrap.tracer.debug('[Core] Init sequence started.');
    applyPlatformTheme();

    const safetyTimeout = createBootstrapSafetyRevealTimer({
        tracer: bootstrap.tracer,
        windowService: bootstrap.windowService,
        windowUI: bootstrap.windowUI,
    });

    try {
        bootstrap.bridge.init();
        bootstrap.eventHandler.init();
        await bootstrap.aiBridge.init();

        const bootstrapData = await fetchBootstrapData(bootstrap.tauriProvider, bootstrap.tracer);
        await hydrateCriticalServices({
            bootstrapData,
            templateLoader: bootstrap.templateLoader,
            stateStore: bootstrap.stateStore,
            windowService: bootstrap.windowService,
            windowUI: bootstrap.windowUI,
            i18n: bootstrap.i18n,
            i18nUI: bootstrap.i18nUI,
            catalog: bootstrap.catalog,
            tracer: bootstrap.tracer,
        });
        await showInitialPage({
            navigation: bootstrap.navigation,
            stateStore: bootstrap.stateStore,
            chatController: bootstrap.chatController,
            navigationUI: bootstrap.navigationUI,
        });
        await bootstrap.windowService.show();
        await initializeImmediateUi(args.immediateUi);
        args.registerGlobalShortcuts();

        bootstrap.tracer.debug('[Core] App Ready. Hiding splash...');
        await waitForNextPaintCycle();
        bootstrap.windowUI.hideSplashScreen();
    } catch (e) {
        bootstrap.tracer.error(`[Core] Critical bootstrap failure: ${String(e)}`);
        void bootstrap.windowService.show().catch(() => {
            /* ignore emergency reveal failure */
        });
        bootstrap.windowUI.hideSplashScreen();
        throw e;
    } finally {
        clearTimeout(safetyTimeout);
    }

    return {
        currentPage: bootstrap.navigation.getCurrentPage() ?? null,
    };
}
