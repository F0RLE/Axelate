import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { SettingsService } from '../services/SettingsService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { EngineConfigService } from '@/features/ai/services/EngineConfigService';
import { ModuleSettingsAutosaveController } from './ModuleSettingsAutosaveController';
import { ModuleSettingsCustomUiController } from './ModuleSettingsCustomUiController';
import { ModuleSettingsEngineRenderer } from './ModuleSettingsEngineRenderer';
import { ModuleSettingsSchemaRenderer } from './ModuleSettingsSchemaRenderer';
import { ModuleSettingsSpecializedRenderer } from './ModuleSettingsSpecializedRenderer';
import type { IModuleSettingsUIContext } from './SettingsContext';

type SettingValue = string | number | boolean | null;
type ModuleSettingsTracer = Pick<LoggerService, 'error' | 'warn' | 'info' | 'debug'>;

type ModuleSettingsControllerFactoryDeps = {
    service: SettingsService;
    tauri: TauriProvider;
    tracer: ModuleSettingsTracer;
    engineConfigService: EngineConfigService;
    getContext: () => IModuleSettingsUIContext;
    registerCleanup: (cleanup: () => void) => void;
    debouncedSave: (key: string, value: SettingValue) => void;
    showSaveIndicator: () => void;
    hideSaveIndicator: () => void;
    showDirtyIndicator: () => void;
};

export class ModuleSettingsControllerFactory {
    constructor(private readonly _deps: ModuleSettingsControllerFactoryDeps) {}

    public createAutosaveController(): ModuleSettingsAutosaveController {
        return new ModuleSettingsAutosaveController(
            (key, defaultValue) => this._deps.getContext().t(key, defaultValue),
            async (key, value) => await this._deps.service.saveSetting(key, value),
            this._deps.tracer,
        );
    }

    public createEngineRenderer(): ModuleSettingsEngineRenderer {
        return new ModuleSettingsEngineRenderer({
            service: this._deps.service,
            tauri: this._deps.tauri,
            engineConfigService: this._deps.engineConfigService,
            getContext: () => this._deps.getContext(),
            registerCleanup: (cleanup) => {
                this._deps.registerCleanup(cleanup);
            },
            debouncedSave: (key, value) => {
                this._deps.debouncedSave(key, value);
            },
            showSaveIndicator: () => {
                this._deps.showSaveIndicator();
            },
            tracer: this._deps.tracer,
        });
    }

    public createCustomUiController(): ModuleSettingsCustomUiController {
        return new ModuleSettingsCustomUiController({
            service: this._deps.service,
            translate: (key, defaultValue) => this._deps.getContext().t(key, defaultValue),
            registerCleanup: (cleanup) => {
                this._deps.registerCleanup(cleanup);
            },
            showDirtyIndicator: () => {
                this._deps.showDirtyIndicator();
            },
            showSavedIndicator: () => {
                this._deps.showSaveIndicator();
            },
            hideSavedIndicator: () => {
                this._deps.hideSaveIndicator();
            },
            showToast: (message, type) => {
                const toastType = type === 'success' || type === 'error' ? type : 'info';
                this._deps.getContext().showToast(message, toastType);
            },
            tracer: this._deps.tracer,
        });
    }

    public createSpecializedRenderer(): ModuleSettingsSpecializedRenderer {
        return new ModuleSettingsSpecializedRenderer({
            service: this._deps.service,
            tauri: this._deps.tauri,
            getContext: () => this._deps.getContext(),
            debouncedSave: (key, value) => {
                this._deps.debouncedSave(key, value);
            },
            tracer: this._deps.tracer,
        });
    }

    public createSchemaRenderer(): ModuleSettingsSchemaRenderer {
        return new ModuleSettingsSchemaRenderer({
            getSavedSettings: () =>
                this._deps.service.getSettings() as unknown as Record<string, SettingValue>,
            onFieldChange: (key, value) => {
                this._deps.debouncedSave(key, value);
            },
            translate: (key, defaultValue) => this._deps.getContext().t(key, defaultValue),
        });
    }
}
