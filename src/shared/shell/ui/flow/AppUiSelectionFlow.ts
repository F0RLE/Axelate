import type { IApp } from '../../../types/coreTypes';
type LaunchAppFn = (category: string, app: IApp) => Promise<void>;

type AppUiSelectionFlowDeps = {
    getSelectedApp: (category: string) => IApp | undefined;
    clearModuleCard: (category: string) => void;
    updateModuleCard: (category: string, app: IApp) => void;
    updateModalSelection: (appId: string | null) => void;
    bumpLaunchSelectionVersion: (category: string) => number;
    stopSelectedApp: (app: IApp, category: string) => Promise<boolean>;
    launchSelectedApp: (
        category: string,
        app: IApp,
        launchSelectionVersion: number,
        launchApp: LaunchAppFn,
    ) => Promise<void>;
    removeSelectedModule: (category: string) => void;
    setSelectedModule: (category: string, moduleData: Partial<IApp>) => void;
    launchApp?: LaunchAppFn;
};

export class AppUiSelectionFlow {
    constructor(private readonly _deps: AppUiSelectionFlowDeps) {}

    public performSelectionAction(category: string, app: IApp): void {
        const alreadySelected = this._deps.getSelectedApp(category)?.id === app.id;

        if (alreadySelected) {
            this._deps.clearModuleCard(category);
            this._deps.removeSelectedModule(category);
            this._deps.updateModalSelection(null);
            void this._deps.stopSelectedApp(app, category);
            return;
        }

        const launchSelectionVersion = this._deps.bumpLaunchSelectionVersion(category);
        this._deps.updateModuleCard(category, app);
        this._deps.updateModalSelection(app.id);
        this._persistSelectedModule(category, app);

        if (this._deps.launchApp !== undefined) {
            void this._deps.launchSelectedApp(
                category,
                app,
                launchSelectionVersion,
                this._deps.launchApp,
            );
        }
    }

    private _persistSelectedModule(category: string, app: IApp): void {
        this._deps.setSelectedModule(category, {
            id: app.id,
            name: app.name ?? '',
            nameKey: app.nameKey ?? '',
            icon: app.icon ?? '',
            type: app.type ?? 'local',
            descKey: app.descKey ?? '',
            desc: app.desc ?? '',
        });
    }

    public activateExistingSelection(category: string, app: IApp): void {
        void category;
        void app;
    }
}
