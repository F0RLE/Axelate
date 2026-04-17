import type { IApp } from '../../types/coreTypes';

export class AppUiSelectionState {
    private readonly _selectedApps = new Map<string, IApp>();

    public clear(): void {
        this._selectedApps.clear();
    }

    public set(category: string, app: IApp): void {
        this._selectedApps.set(category, app);
    }

    public get(category: string): IApp | undefined {
        return this._selectedApps.get(category);
    }

    public delete(category: string): boolean {
        return this._selectedApps.delete(category);
    }

    public has(category: string): boolean {
        return this._selectedApps.has(category);
    }

    public values(): IterableIterator<IApp> {
        return this._selectedApps.values();
    }

    public entries(): IterableIterator<[string, IApp]> {
        return this._selectedApps.entries();
    }

    public asMap(): Map<string, IApp> {
        return this._selectedApps;
    }

    public getModalSelectedId(category: string): string | undefined {
        return (
            this.get(category)?.id ??
            (category.startsWith('ai') ? this.get('ai_text')?.id : undefined)
        );
    }

    public resolveCategoryFromCard(card: HTMLElement): string {
        const defaultCategory = card.id === 'ai-module-card' ? 'ai_text' : 'services';
        const shownCapability = card.dataset['currentCapability'];
        if (shownCapability !== undefined && shownCapability !== '') {
            return shownCapability;
        }

        const shownId = card.dataset['currentModule'];
        if (shownId === undefined) {
            return defaultCategory;
        }

        for (const [capability, app] of this._selectedApps.entries()) {
            if (app.id === shownId) {
                return capability;
            }
        }

        return defaultCategory;
    }

    public getOtherAiSlot(category: string): string {
        return category === 'ai_text' ? 'ai_image' : 'ai_text';
    }

    public hasAnyAiSlot(): boolean {
        return this.has('ai_text') || this.has('ai_image');
    }

    public isSelectedInAnotherAiSlot(category: string, appId: string): boolean {
        for (const [slot, selectedApp] of this._selectedApps.entries()) {
            if (slot !== category && slot.startsWith('ai') && selectedApp.id === appId) {
                return true;
            }
        }

        return false;
    }

    public shouldKeepRemovedAiAppRunning(category: string, app: IApp): boolean {
        if (!category.startsWith('ai')) {
            return false;
        }

        const otherApp = this.get(this.getOtherAiSlot(category));
        return otherApp?.id === app.id;
    }

    public getSharedAiCardState(card: HTMLElement): {
        textApp: IApp;
        imageApp: IApp;
        secondaryApp: IApp;
        openCapability: string;
    } | null {
        const textApp = this.get('ai_text');
        const imageApp = this.get('ai_image');
        if (textApp === undefined || imageApp === undefined) {
            return null;
        }

        const shownModule = card.dataset['currentModule'];
        const shownCapability = card.dataset['currentCapability'];
        const isTextShown = shownCapability === 'ai_text' || shownModule === textApp.id;

        return {
            textApp,
            imageApp,
            secondaryApp: isTextShown ? imageApp : textApp,
            openCapability: isTextShown ? 'ai_image' : 'ai_text',
        };
    }
}
