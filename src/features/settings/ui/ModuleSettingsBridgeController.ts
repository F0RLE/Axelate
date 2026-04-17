import type { IApp } from '@/shared/types/coreTypes';
import type { IGlobalBridge } from '@/shared/types/global_bridge_types';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { tracer } from '@/infrastructure/logging/LoggerService';

export class ModuleSettingsBridgeController {
    private _previousOpenModuleSettings: unknown;
    private _previousSetCardWidth: unknown;

    public install(
        openModuleSettings: (app: IApp) => Promise<void>,
        setCardWidth: (btn: HTMLElement, width: string) => void,
    ): void {
        const win = getGlobalWin();
        this._previousOpenModuleSettings = win.openModuleSettings;
        this._previousSetCardWidth = (win as unknown as IGlobalBridge)['setCardWidth'];

        win.openModuleSettings = (app: IApp) => {
            void openModuleSettings(app).catch((error: unknown) => {
                tracer.error(String(error));
            });
        };
        (win as unknown as IGlobalBridge)['setCardWidth'] = (btn: HTMLElement, width: string) => {
            setCardWidth(btn, width);
        };
    }

    public uninstall(): void {
        const win = getGlobalWin();
        if (typeof this._previousOpenModuleSettings === 'function') {
            win.openModuleSettings = this
                ._previousOpenModuleSettings as typeof win.openModuleSettings;
        } else {
            delete (win as unknown as Record<string, unknown>)['openModuleSettings'];
        }

        if (typeof this._previousSetCardWidth === 'function') {
            (win as unknown as IGlobalBridge)['setCardWidth'] = this._previousSetCardWidth as (
                btn: HTMLElement,
                width: string,
            ) => void;
        } else {
            delete (win as unknown as Record<string, unknown>)['setCardWidth'];
        }

        this._previousOpenModuleSettings = undefined;
        this._previousSetCardWidth = undefined;
    }
}
