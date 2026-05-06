import type { ChatController } from '@/features/chat/chat';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { TemplateLoader } from '@/shared/services/TemplateLoader';
import type { WindowService } from '@/shared/services/WindowService';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { SidebarUI } from '@/shared/shell/SidebarUI';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { IBootstrapData } from '@/shared/types/coreTypes';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type {
    ClosableDeferredUiController,
    DeferredUiController,
    ModuleSettingsUiController,
} from './CoreUiContracts';
import { restoreSelectedModules as restoreSelectedModulesState } from './CoreStateRestore';

type RuntimeLogger = Pick<LoggerService, 'debug' | 'info' | 'warn' | 'error'>;
type BootstrapSafetyRevealArgs = {
    tracer: RuntimeLogger;
    windowService: WindowService;
    windowUI: WindowUI;
};

type HydrateCriticalServicesArgs = {
    bootstrapData: IBootstrapData;
    templateLoader: TemplateLoader;
    stateStore: UiStateStore;
    windowService: WindowService;
    windowUI: WindowUI;
    i18n: I18nService;
    i18nUI: I18nUI;
    catalog: CatalogService;
    tracer: RuntimeLogger;
};

type ShowInitialPageArgs = {
    navigation: NavigationService;
    stateStore: UiStateStore;
    chatController: ChatController;
    navigationUI: NavigationUI;
};

type InitializeImmediateUiArgs = {
    navigation: NavigationService;
    navigationUI: NavigationUI;
    downloadUI: DownloadUI;
    moduleService: ModuleService;
    sidebarUI: SidebarUI;
};

type InitializeDeferredUiArgs = {
    settingsService: SettingsService;
    monitoringUI: DeferredUiController;
    settingsUI: ClosableDeferredUiController;
    moduleSettingsUI: ModuleSettingsUiController;
    i18nUI: I18nUI;
    consoleUI: DeferredUiController;
    restoreSelectedModules: () => void;
};

const INITIAL_TEMPLATE_TARGETS = [
    ['components/sidebar', 'sidebar'],
    ['pages/home', 'page-home'],
    ['pages/chat', 'page-chat'],
    ['pages/modules', 'page-modules'],
    ['pages/downloads', 'page-downloads'],
    ['pages/console', 'page-console'],
    ['pages/settings', 'page-settings'],
] as const;

type NavigatorWithUserAgentData = Navigator & {
    userAgentData?: {
        platform?: string;
    };
};

export function applyPlatformTheme(): void {
    const navigatorWithUserAgentData = globalThis.navigator as NavigatorWithUserAgentData;
    const rawPlatform =
        navigatorWithUserAgentData.userAgentData?.platform ?? globalThis.navigator.platform;
    const normalized = rawPlatform.toLowerCase();

    let platform = 'windows';
    if (normalized.includes('mac')) {
        platform = 'macos';
    } else if (normalized.includes('linux')) {
        platform = 'linux';
    }

    document.body.dataset['platform'] = platform;
}

export async function fetchBootstrapData(
    tauriProvider: TauriProvider,
    tracer: RuntimeLogger,
): Promise<IBootstrapData> {
    try {
        return await tauriProvider.invoke<IBootstrapData>('get_app_bootstrap_data');
    } catch (error) {
        tracer.warn(`[CoreRuntimeSupport] Bootstrap command failed: ${String(error)}`);

        const [uiState, windowConfig, systemLanguage, initialZoom] = await Promise.all([
            tauriProvider.invoke<IBootstrapData['uiState']>('get_ui_state'),
            tauriProvider.invoke<IBootstrapData['windowConfig']>('get_window_config'),
            tauriProvider.invoke<string>('get_system_language'),
            tauriProvider.invoke<number>('get_resolution_zoom'),
        ]);

        return {
            uiState,
            windowConfig,
            systemLanguage,
            initialZoom,
        };
    }
}

export async function hydrateCriticalServices(args: HydrateCriticalServicesArgs): Promise<void> {
    const preferredLanguage = args.bootstrapData.uiState.preferred_language;
    args.stateStore.setState(args.bootstrapData.uiState);
    await loadCriticalTemplates(args.templateLoader);
    await Promise.all([
        args.windowService.init(args.bootstrapData.windowConfig, args.bootstrapData.initialZoom),
        args.i18n.init(
            preferredLanguage !== null ? preferredLanguage : args.bootstrapData.systemLanguage,
        ),
        args.catalog.loadCatalog(),
    ]);
    args.windowUI.init();
    args.i18nUI.applyTranslations();
}

export async function showInitialPage(args: ShowInitialPageArgs): Promise<void> {
    const state = args.stateStore.getState();
    const pageId = state.pending_chat_reveal === true ? 'chat' : (state.last_page ?? 'home');

    args.navigation.refreshFromUiState(pageId);
    await args.navigationUI.showPage(pageId, null, true, true);

    if (pageId === 'chat') {
        args.chatController.init();
    }
}

export async function initializeImmediateUi(args: InitializeImmediateUiArgs): Promise<void> {
    await args.sidebarUI.init();
    args.navigationUI.init();
    args.navigationUI.syncActiveNavigationButton(args.navigation.getCurrentPage() ?? 'home');
    void args.moduleService.init();
    void args.downloadUI.init();
}

export async function initializeDeferredUi(args: InitializeDeferredUiArgs): Promise<void> {
    await args.settingsService.loadSettings();
    void args.monitoringUI.init();
    await args.settingsUI.init();
    await args.moduleSettingsUI.init();
    void args.consoleUI.init();
    args.i18nUI.applyTranslations();
    args.restoreSelectedModules();
}

export function restoreSelectedModules(args: {
    tracer: RuntimeLogger;
    moduleSettings: Parameters<typeof restoreSelectedModulesState>[0]['moduleSettings'];
    catalog: Parameters<typeof restoreSelectedModulesState>[0]['catalog'];
    appUI: Parameters<typeof restoreSelectedModulesState>[0]['appUI'];
}): void {
    restoreSelectedModulesState({
        tracer: args.tracer,
        moduleSettings: args.moduleSettings,
        catalog: args.catalog,
        appUI: args.appUI,
    });
}

export function createBootstrapSafetyRevealTimer(
    args: BootstrapSafetyRevealArgs,
    timeoutMs = 12000,
): ReturnType<typeof setTimeout> {
    return globalThis.setTimeout(() => {
        args.tracer.warn('[Core] Emergency bootstrap timeout triggered! Forcing UI reveal.');
        void args.windowService.show();
        args.windowUI.hideSplashScreen();
    }, timeoutMs);
}

export async function waitForNextPaintCycle(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    });
}

async function loadCriticalTemplates(templateLoader: TemplateLoader): Promise<void> {
    await Promise.all(
        INITIAL_TEMPLATE_TARGETS.map(async ([templatePath, containerId]) => {
            const injected = await templateLoader.loadAndInject(templatePath, containerId);
            if (!injected) {
                throw new Error(
                    `[CoreRuntimeSupport] Failed to inject template ${templatePath} into #${containerId}`,
                );
            }
        }),
    );
}
