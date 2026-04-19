/**
 * @module app/CoreContainer
 * @description Centralized DI container for app services, UI, and infrastructure.
 */

import type { Core } from './init';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { WindowService } from '@/shared/services/WindowService';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { SoundService } from '@/shared/services/SoundService';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { ConsoleLogService } from '@/features/console/services/ConsoleLogService';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { ChatController } from '@/features/chat/chat';
import type { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { AppUI } from '@/shared/shell/AppUI';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { SidebarUI } from '@/shared/shell/SidebarUI';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { SettingsUI } from '@/features/settings/ui/SettingsUI';
import type { ModuleSettingsUI } from '@/features/settings/ui/ModuleSettingsUI';
import type { MonitoringUI } from '@/features/monitoring/ui/MonitoringUI';
import type { ConsoleUI } from '@/features/console/ui/ConsoleUI';
import type { Particles } from '@/shared/shell/Particles';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TemplateLoader } from '@/shared/services/TemplateLoader';
import type { EventBus } from '@/shared/services/EventBus';
import type { ErrorHandler } from '@/shared/services/ErrorHandler';
import type { StateManager } from '@/shared/services/StateManager';
import type { IApp } from '@/shared/types/coreTypes';

export interface CoreServices {
    core: Core;
    tauriProvider: TauriProvider;
    tracer: LoggerService;
    stateStore: UiStateStore;
    uiSettings: UISettingsService;
    aiSettings: AISettingsService;
    moduleSettings: ModuleSettingsService;
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
    chatController: ChatController;
    aiBridge: AIBridge;
}

export interface CoreUI {
    appUI: AppUI;
    i18nUI: I18nUI;
    windowUI: WindowUI;
    navigationUI: NavigationUI;
    sidebarUI: SidebarUI;
    downloadUI: DownloadUI;
    settingsUI: SettingsUI;
    moduleSettingsUI: ModuleSettingsUI;
    monitoringUI: MonitoringUI;
    consoleUI: ConsoleUI;
    particles: Particles;
}

export interface CoreInfrastructure {
    templateLoader: TemplateLoader;
    eventBus: EventBus;
    errorHandler: ErrorHandler;
    stateManager: StateManager;
}

export interface CoreContainerShape {
    services: CoreServices;
    ui: CoreUI;
    infra: CoreInfrastructure;
}

export class CoreContainer {
    private _services = {} as CoreServices;
    private _ui = {} as CoreUI;
    private _infra = {} as CoreInfrastructure;
    private _locked = false;

    get services(): CoreServices {
        return this._services;
    }

    get ui(): CoreUI {
        return this._ui;
    }

    get infra(): CoreInfrastructure {
        return this._infra;
    }

    get isLocked(): boolean {
        return this._locked;
    }

    registerServices(services: CoreServices): void {
        if (this._locked) return;
        Object.assign(this._services, services);
    }

    registerUI(ui: CoreUI): void {
        if (this._locked) return;
        Object.assign(this._ui, ui);
    }

    registerInfra(infra: CoreInfrastructure): void {
        if (this._locked) return;
        Object.assign(this._infra, infra);
    }

    lock(): void {
        this._locked = true;
    }

    reset(): void {
        this._locked = false;
        this._services = {} as CoreServices;
        this._ui = {} as CoreUI;
        this._infra = {} as CoreInfrastructure;
    }

    /** Shared catalog category resolver for composition root consumers. */
    getCatalogCategory(category: string): IApp[] {
        const services = this._services as Partial<Pick<CoreServices, 'catalog'>>;
        const catalogService = services.catalog;
        if (catalogService === undefined) return [];

        const catalog = catalogService.getCatalog() as unknown;
        if (typeof catalog !== 'object' || catalog === null) {
            return [];
        }

        const typedCatalog = catalog as { ai?: IApp[]; services?: IApp[] };
        const aiCatalog = Array.isArray(typedCatalog.ai) ? typedCatalog.ai : [];
        const servicesCatalog = Array.isArray(typedCatalog.services) ? typedCatalog.services : [];
        const lowCat = category.toLowerCase();
        if (lowCat === 'ai' || lowCat === 'ai_text' || lowCat === 'ai_image') return aiCatalog;
        if (lowCat === 'services') return servicesCatalog;
        return [];
    }
}

export const container = new CoreContainer();

/**
 * Typed accessor for the app container.
 */
export function getContainer(): CoreContainer {
    return container;
}
