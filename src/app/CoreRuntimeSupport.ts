import type { ChatController } from '@/features/chat/chat';
import type { ConsoleUI } from '@/features/console/ui/ConsoleUI';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { MonitoringUI } from '@/features/monitoring/ui/MonitoringUI';
import type { ModuleSettingsUI } from '@/features/settings/ui/ModuleSettingsUI';
import type { SettingsUI } from '@/features/settings/ui/SettingsUI';
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
import {
    restoreActiveAiProvider,
    restoreSelectedModules as restoreSelectedModulesState,
} from './CoreStateRestore';

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
    navigationUI: NavigationUI;
    downloadUI: DownloadUI;
    moduleService: ModuleService;
    sidebarUI: SidebarUI;
};

type InitializeDeferredUiArgs = {
    settingsService: SettingsService;
    monitoringUI: MonitoringUI;
    settingsUI: SettingsUI;
    moduleSettingsUI: ModuleSettingsUI;
    i18nUI: I18nUI;
    consoleUI: ConsoleUI;
    restoreSelectedModules: () => void;
};

const INITIAL_TEMPLATE_TARGETS = [
    ['components/sidebar', 'sidebar'],
    ['pages/home', 'page-home'],
    ['pages/chat', 'page-chat'],
    ['pages/modules', 'page-modules'],
    ['pages/marketplace', 'page-marketplace'],
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

        const [uiState, windowConfig, systemLanguage, modules, initialZoom] = await Promise.all([
            tauriProvider.invoke<IBootstrapData['uiState']>('get_ui_state'),
            tauriProvider.invoke<IBootstrapData['windowConfig']>('get_window_config'),
            tauriProvider.invoke<string>('get_system_language'),
            tauriProvider.invoke<IBootstrapData['modules']>('get_modules'),
            tauriProvider.invoke<number>('get_resolution_zoom'),
        ]);

        return {
            uiState,
            windowConfig,
            systemLanguage,
            modules,
            initialZoom,
        };
    }
}

export async function hydrateCriticalServices(
    args: HydrateCriticalServicesArgs,
): Promise<void> {
    const preferredLanguage = args.bootstrapData.uiState.preferred_language;
    args.stateStore.setState(args.bootstrapData.uiState);
    args.tracer.debug(
        `[CoreRuntimeSupport] Bootstrap modules: ${String(args.bootstrapData.modules.length)}`,
    );
    await loadCriticalTemplates(args.templateLoader);
    await Promise.all([
        args.windowService.init(args.bootstrapData.windowConfig, args.bootstrapData.initialZoom),
        args.i18n.init(preferredLanguage !== null ? preferredLanguage : args.bootstrapData.systemLanguage),
        args.catalog.loadCatalog(),
    ]);
    args.windowUI.init();
    args.i18nUI.applyTranslations();
    args.tracer.info('[CoreRuntimeSupport] Critical services hydrated.');
}

export async function showInitialPage(args: ShowInitialPageArgs): Promise<void> {
    const state = args.stateStore.getState();
    const pageId = state.pending_chat_reveal === true ? 'chat' : state.last_page ?? 'home';

    args.navigation.refreshFromUiState(pageId);
    await args.navigationUI.showPage(pageId, null, true, true);

    if (pageId === 'chat') {
        args.chatController.init();
    }
}

export function initializeImmediateUi(args: InitializeImmediateUiArgs): void {
    args.navigationUI.init();
    void args.moduleService.init();
    void args.sidebarUI.init();
    void args.downloadUI.init();
}

export async function initializeDeferredUi(
    args: InitializeDeferredUiArgs,
): Promise<void> {
    await args.settingsService.loadSettings();
    void args.monitoringUI.init();
    await args.settingsUI.init();
    await args.moduleSettingsUI.init();
    args.consoleUI.init();
    args.i18nUI.applyTranslations();
    args.restoreSelectedModules();
}

export function restoreSelectedModules(args: {
    tracer: RuntimeLogger;
    moduleSettings: Parameters<typeof restoreSelectedModulesState>[0]['moduleSettings'];
    aiSettings: Parameters<typeof restoreActiveAiProvider>[0]['aiSettings'];
    catalog: Parameters<typeof restoreSelectedModulesState>[0]['catalog'];
    appUI: Parameters<typeof restoreSelectedModulesState>[0]['appUI'];
    aiBridge: Parameters<typeof restoreActiveAiProvider>[0]['aiBridge'];
}): void {
    const restoredSelections = restoreSelectedModulesState({
        tracer: args.tracer,
        moduleSettings: args.moduleSettings,
        catalog: args.catalog,
        appUI: args.appUI,
    });

    restoreActiveAiProvider({
        tracer: args.tracer,
        aiSettings: args.aiSettings,
        aiBridge: args.aiBridge,
        restoredSelections,
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
