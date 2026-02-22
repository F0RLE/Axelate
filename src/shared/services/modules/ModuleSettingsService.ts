import type { UiStateStore } from '../state/UiStateStore';
import type { IApp } from '@/shared/types/coreTypes';

export class ModuleSettingsService {
    constructor(private readonly _store: UiStateStore) {}

    public getSelectedModules(): Record<string, Partial<IApp>> {
        return this._store.getState().selected_modules;
    }

    public getSelectedModule(category: string): Partial<IApp> | undefined {
        return this._store.getState().selected_modules[category];
    }

    public setSelectedModule(category: string, data: Partial<IApp>): void {
        this._store.updateNestedState('selected_modules', category, data);
    }

    public removeSelectedModule(category: string): void {
        this._store.removeNestedState('selected_modules', category);
    }
}
