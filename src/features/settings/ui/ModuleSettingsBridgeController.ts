import type { IApp } from '@/shared/types/coreTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type ModuleSettingsBridgeLogger = Pick<LoggerService, 'error'>;

export class ModuleSettingsBridgeController {
    private _previousOpenModuleSettings: unknown;
    public constructor(
        private readonly _tracer: ModuleSettingsBridgeLogger,
        private readonly _bridgeTarget: Window & typeof globalThis = globalThis as Window &
            typeof globalThis,
    ) {}

    public install(openModuleSettings: (app: IApp) => Promise<void>): void {
        this._previousOpenModuleSettings = this._bridgeTarget.openModuleSettings;

        this._bridgeTarget.openModuleSettings = (app: IApp) => {
            void openModuleSettings(app).catch((error: unknown) => {
                this._tracer.error(String(error));
            });
        };
    }

    public uninstall(): void {
        if (typeof this._previousOpenModuleSettings === 'function') {
            this._bridgeTarget.openModuleSettings = this
                ._previousOpenModuleSettings as typeof this._bridgeTarget.openModuleSettings;
        } else {
            delete (this._bridgeTarget as unknown as Record<string, unknown>)['openModuleSettings'];
        }

        this._previousOpenModuleSettings = undefined;
    }
}
