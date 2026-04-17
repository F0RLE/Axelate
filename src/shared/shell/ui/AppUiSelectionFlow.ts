import type { IApp } from '../../types/coreTypes';
import { getGlobalWin } from '../../utils/globalAccessor';

type LaunchAppFn = (id: string) => Promise<void>;

type AppUiSelectionFlowDeps = {
    getSelectedApp: (category: string) => IApp | undefined;
    clearModuleCard: (category: string) => void;
    updateModuleCard: (category: string, app: IApp) => void;
    updateModalSelection: (appId: string | null) => void;
    bumpLaunchSelectionVersion: (category: string) => number;
    stopSelectedApp: (app: IApp) => Promise<boolean>;
    launchSelectedApp: (
        category: string,
        app: IApp,
        launchSelectionVersion: number,
        launchApp: LaunchAppFn,
    ) => Promise<void>;
};

export class AppUiSelectionFlow {
    constructor(private readonly _deps: AppUiSelectionFlowDeps) {}

    public performSelectionAction(category: string, app: IApp): void {
        const win = getGlobalWin();
        const alreadySelected = this._deps.getSelectedApp(category)?.id === app.id;

        if (alreadySelected) {
            this._deps.clearModuleCard(category);
            win.uiState.removeSelectedModule(category);
            this._deps.updateModalSelection(null);
            void this._deps.stopSelectedApp(app);
            return;
        }

        const launchSelectionVersion = this._deps.bumpLaunchSelectionVersion(category);
        this._deps.updateModuleCard(category, app);
        this._deps.updateModalSelection(app.id);
        this._persistSelectedModule(category, app);

        if (typeof win.launchApp === 'function') {
            void this._deps.launchSelectedApp(
                category,
                app,
                launchSelectionVersion,
                win.launchApp as LaunchAppFn,
            );
        }
    }

    private _persistSelectedModule(category: string, app: IApp): void {
        const uiState = getGlobalWin().uiState;
        if (typeof uiState.setSelectedModule !== 'function') {
            return;
        }

        uiState.setSelectedModule(category, {
            id: app.id,
            name: app.name ?? '',
            nameKey: app.nameKey ?? '',
            icon: app.icon ?? '',
            type: app.type ?? 'local',
            descKey: app.descKey ?? '',
            desc: app.desc ?? '',
        });
    }
}
