import { AIBridge } from '@/features/ai/services/AIBridge';
import { ConsoleLogService } from '@/features/console/services/ConsoleLogService';
import { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import { SettingsService } from '@/features/settings/services/SettingsService';
import { I18nService } from '@/infrastructure/i18n/I18nService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { CatalogService } from '@/shared/services/CatalogService';
import { EventBus } from '@/shared/services/EventBus';
import { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import { ModuleService } from '@/shared/services/ModuleService';
import { SoundService } from '@/shared/services/SoundService';
import { TemplateLoader } from '@/shared/services/TemplateLoader';
import { WindowService } from '@/shared/services/WindowService';
import { AISettingsService } from '@/shared/services/ai/AISettingsService';
import { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import { UiStateStore } from '@/shared/services/state/UiStateStore';
import { UISettingsService } from '@/shared/services/ui/UISettingsService';
import { NavigationService } from '@/infrastructure/navigation/NavigationService';

export type CoreServiceBundle = {
    tauriProvider: TauriProvider;
    eventBus: EventBus;
    templateLoader: TemplateLoader;
    stateStore: UiStateStore;
    uiSettings: UISettingsService;
    aiSettings: AISettingsService;
    moduleSettings: ModuleSettingsService;
    aiBridge: AIBridge;
    moduleService: ModuleService;
    modulePlatformService: ModulePlatformService;
    windowService: WindowService;
    i18n: I18nService;
    catalog: CatalogService;
    navigation: NavigationService;
    soundService: SoundService;
    monitoringService: MonitoringService;
    consoleLogService: ConsoleLogService;
    settingsService: SettingsService;
};

export function createCoreServiceBundle(tracer: LoggerService): CoreServiceBundle {
    const tauriProvider = new TauriProvider(tracer);
    tauriProvider.init();

    const eventBus = new EventBus();
    const templateLoader = new TemplateLoader(tracer);
    templateLoader.init();

    const stateStore = new UiStateStore(tauriProvider, tracer);
    const uiSettings = new UISettingsService(stateStore);
    const aiSettings = new AISettingsService(stateStore);
    const moduleSettings = new ModuleSettingsService(stateStore);
    const aiBridge = new AIBridge(tracer);
    const moduleService = new ModuleService(tauriProvider, tracer);
    const modulePlatformService = new ModulePlatformService(() => moduleService, aiBridge, tracer);
    const windowService = new WindowService(tauriProvider, tracer);
    const i18n = new I18nService(tauriProvider, eventBus, tracer);
    const catalog = new CatalogService(tauriProvider, tracer);
    const navigation = new NavigationService(tracer);
    const soundService = new SoundService(tracer);
    const monitoringService = new MonitoringService(tauriProvider, tracer);
    const consoleLogService = new ConsoleLogService(tauriProvider, tracer, (key, fallback) =>
        i18n.t(key, fallback),
    );
    const settingsService = new SettingsService(tauriProvider, tracer);

    return {
        tauriProvider,
        eventBus,
        templateLoader,
        stateStore,
        uiSettings,
        aiSettings,
        moduleSettings,
        aiBridge,
        moduleService,
        modulePlatformService,
        windowService,
        i18n,
        catalog,
        navigation,
        soundService,
        monitoringService,
        consoleLogService,
        settingsService,
    };
}

export function configureCoreServices(
    bundle: Pick<CoreServiceBundle, 'windowService' | 'navigation' | 'uiSettings'>,
): void {
    bundle.windowService.setUISettingsService(bundle.uiSettings);
    bundle.navigation.setUISettingsService(bundle.uiSettings);
}
