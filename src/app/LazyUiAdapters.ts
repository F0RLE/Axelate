import type { EventBus } from '@/shared/services/EventBus';
import type { IApp } from '@/shared/types/coreTypes';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { ConsoleLogService } from '@/features/console/services/ConsoleLogService';
import type {
    ClosableDeferredUiController,
    DeferredUiController,
    ModuleSettingsUiController,
} from './CoreUiContracts';

abstract class LazyUiAdapter<T extends DeferredUiController> implements DeferredUiController {
    private _instance: T | null = null;
    private _loadPromise: Promise<T> | null = null;
    private _initPromise: Promise<void> | null = null;
    private _isDestroyed = false;

    public async init(): Promise<void> {
        if (this._isDestroyed) {
            return;
        }

        if (this._initPromise !== null) {
            await this._initPromise;
            return;
        }

        this._initPromise = this._initInstance();
        try {
            await this._initPromise;
        } finally {
            this._initPromise = null;
        }
    }

    public destroy(): void {
        if (this._isDestroyed) {
            return;
        }

        this._isDestroyed = true;

        if (this._instance !== null) {
            this._instance.destroy();
            this._instance = null;
        } else if (this._loadPromise !== null) {
            void this._loadPromise.then((instance) => {
                instance.destroy();
            });
        }
    }

    protected async withInstance<R>(callback: (instance: T) => Promise<R> | R): Promise<R | void> {
        if (this._isDestroyed) {
            return;
        }

        const instance = await this._getInstance();
        return await callback(instance);
    }

    protected getLoadedInstance(): T | null {
        return this._instance;
    }

    protected abstract loadInstance(): Promise<T>;

    private async _initInstance(): Promise<void> {
        const instance = await this._getInstance();
        if (this._isDestroyed) {
            instance.destroy();
            return;
        }

        await instance.init();
    }

    private async _getInstance(): Promise<T> {
        if (this._instance !== null) {
            return this._instance;
        }

        this._loadPromise ??= this.loadInstance().then((instance) => {
            this._instance = instance;
            return instance;
        });

        return await this._loadPromise;
    }
}

export class LazySettingsUiAdapter
    extends LazyUiAdapter<ClosableDeferredUiController>
    implements ClosableDeferredUiController
{
    public constructor(
        private readonly _deps: {
            settingsService: SettingsService;
            uiSettings: UISettingsService;
            aiSettings: AISettingsService;
            i18n: I18nService;
            i18nUI: I18nUI;
            tauriProvider: TauriProvider;
            navigation: NavigationService;
            tracer: LoggerService;
            showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
        },
    ) {
        super();
    }

    public close(): void {
        this.getLoadedInstance()?.close();
    }

    protected async loadInstance(): Promise<ClosableDeferredUiController> {
        const module = await import('@/features/settings/ui/SettingsUI');
        return new module.SettingsUI(
            this._deps.settingsService,
            this._deps.uiSettings,
            this._deps.aiSettings,
            this._deps.i18n,
            this._deps.i18nUI,
            this._deps.tauriProvider,
            this._deps.navigation,
            {
                tracer: this._deps.tracer,
                showToast: this._deps.showToast,
            },
        );
    }
}

export class LazyModuleSettingsUiAdapter
    extends LazyUiAdapter<ModuleSettingsUiController>
    implements ModuleSettingsUiController
{
    public constructor(
        private readonly _deps: {
            settingsService: SettingsService;
            uiSettings: UISettingsService;
            aiSettings: AISettingsService;
            i18n: I18nService;
            i18nUI: I18nUI;
            tauriProvider: TauriProvider;
            navigation: NavigationService;
            eventBus: EventBus;
            tracer: Pick<LoggerService, 'error' | 'warn' | 'info' | 'debug'>;
            showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
            reopenModuleSettings: (app: IApp) => void;
            closeAppSelection: () => void;
            onModuleSettingsChanged: (app: IApp) => void;
        },
    ) {
        super();
    }

    public close(): void {
        this.getLoadedInstance()?.close();
    }

    public async openModuleSettings(app: IApp): Promise<void> {
        await this.init();
        await this.withInstance(async (instance) => {
            await instance.openModuleSettings(app);
        });
    }

    protected async loadInstance(): Promise<ModuleSettingsUiController> {
        const module = await import('@/features/settings/ui/ModuleSettingsUI');
        return new module.ModuleSettingsUI(
            this._deps.settingsService,
            this._deps.uiSettings,
            this._deps.aiSettings,
            this._deps.i18n,
            this._deps.i18nUI,
            this._deps.tauriProvider,
            this._deps.navigation,
            {
                eventBus: this._deps.eventBus,
                tracer: this._deps.tracer,
                showToast: this._deps.showToast,
                reopenModuleSettings: this._deps.reopenModuleSettings,
                closeAppSelection: this._deps.closeAppSelection,
                onModuleSettingsChanged: this._deps.onModuleSettingsChanged,
            },
        );
    }
}

export class LazyMonitoringUiAdapter
    extends LazyUiAdapter<DeferredUiController>
    implements DeferredUiController
{
    public constructor(private readonly _monitoringService: MonitoringService) {
        super();
    }

    protected async loadInstance(): Promise<DeferredUiController> {
        const module = await import('@/features/monitoring/ui/MonitoringUI');
        return new module.MonitoringUI(this._monitoringService);
    }
}

export class LazyConsoleUiAdapter
    extends LazyUiAdapter<DeferredUiController>
    implements DeferredUiController
{
    public constructor(
        private readonly _deps: {
            consoleLogService: ConsoleLogService;
            eventBus: EventBus;
            translate: (key: string, fallback: string) => string;
            showToast: (
                message: string,
                type?: 'success' | 'error' | 'warning' | 'info',
                duration?: number,
            ) => void;
            copyText: (text: string) => Promise<void>;
        },
    ) {
        super();
    }

    protected async loadInstance(): Promise<DeferredUiController> {
        const module = await import('@/features/console/ui/ConsoleUI');
        return new module.ConsoleUI(this._deps.consoleLogService, {
            eventBus: this._deps.eventBus,
            translate: this._deps.translate,
            showToast: this._deps.showToast,
            copyText: this._deps.copyText,
        });
    }
}
