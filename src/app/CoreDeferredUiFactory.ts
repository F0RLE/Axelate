import type { ConsoleLogService } from '@/features/console/services/ConsoleLogService';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { EventBus } from '@/shared/services/EventBus';
import type { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AppUI } from '@/shared/shell/AppUI';
import type { IApp } from '@/shared/types/coreTypes';
import {
    createClipboardWriter,
    createToastBridge,
    type ModuleSettingsGateway,
} from './CoreUiBridgeHelpers';
import type {
    ClosableDeferredUiController,
    DeferredUiController,
    ModuleSettingsUiController,
} from './CoreUiContracts';
import {
    LazyConsoleUiAdapter,
    LazyModuleSettingsUiAdapter,
    LazySettingsUiAdapter,
} from './LazyUiAdapters';

type CreateSettingsUIDeps = {
    settingsService: SettingsService;
    uiSettings: UISettingsService;
    aiSettings: AISettingsService;
    i18n: I18nService;
    i18nUI: I18nUI;
    tauriProvider: TauriProvider;
    navigation: NavigationService;
    tracer: LoggerService;
    appUI: AppUI;
};

type CreateModuleSettingsUIDeps = CreateSettingsUIDeps & {
    eventBus: EventBus;
    moduleSettingsUIRef: ModuleSettingsGateway;
    aiBridge: AIBridge;
    modulePlatformService: ModulePlatformService;
};

type CreateConsoleUIDeps = {
    consoleLogService: ConsoleLogService;
    eventBus: EventBus;
    i18n: I18nService;
    tauriProvider: TauriProvider;
    appUI: AppUI;
};

export function createSettingsUI(deps: CreateSettingsUIDeps): ClosableDeferredUiController {
    return new LazySettingsUiAdapter({
        settingsService: deps.settingsService,
        uiSettings: deps.uiSettings,
        aiSettings: deps.aiSettings,
        i18n: deps.i18n,
        i18nUI: deps.i18nUI,
        tauriProvider: deps.tauriProvider,
        navigation: deps.navigation,
        tracer: deps.tracer,
        showToast: createToastBridge(deps.appUI),
    });
}

export function createModuleSettingsUI(
    deps: CreateModuleSettingsUIDeps,
): ModuleSettingsUiController {
    return new LazyModuleSettingsUiAdapter({
        settingsService: deps.settingsService,
        uiSettings: deps.uiSettings,
        aiSettings: deps.aiSettings,
        i18n: deps.i18n,
        i18nUI: deps.i18nUI,
        tauriProvider: deps.tauriProvider,
        navigation: deps.navigation,
        eventBus: deps.eventBus,
        tracer: deps.tracer,
        showToast: createToastBridge(deps.appUI),
        reopenModuleSettings: (app: IApp) => {
            void deps.moduleSettingsUIRef.openModuleSettings(app);
        },
        closeAppSelection: () => {
            deps.appUI.closeAppSelection();
        },
        onModuleSettingsChanged: (app) => {
            const activeProviderId = deps.aiBridge.getState().activeProviderId;
            if (activeProviderId === app.id) {
                deps.aiBridge.stopProvider();
                return;
            }

            void deps.modulePlatformService
                .getStatus(app)
                .then(async (status) => {
                    if (status === 'running') {
                        await deps.modulePlatformService.stop(app);
                    }
                })
                .catch((error: unknown) => {
                    deps.tracer.warn(
                        `[ModuleSettingsUI] Failed to stop changed module ${app.id}: ${String(error)}`,
                    );
                });
        },
    });
}

export function createConsoleUI(deps: CreateConsoleUIDeps): DeferredUiController {
    return new LazyConsoleUiAdapter({
        consoleLogService: deps.consoleLogService,
        eventBus: deps.eventBus,
        translate: deps.i18n.t.bind(deps.i18n),
        showToast: createToastBridge(deps.appUI),
        copyText: createClipboardWriter(deps.tauriProvider),
    });
}
