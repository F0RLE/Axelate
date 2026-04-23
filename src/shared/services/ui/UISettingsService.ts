import type { UiStateStore } from '../state/UiStateStore';

export class UISettingsService {
    constructor(private readonly _store: UiStateStore) {}

    public getSidebarCollapsed(): boolean {
        return this._store.getState().sidebar_collapsed;
    }

    public setSidebarCollapsed(collapsed: boolean): void {
        this._store.updateState({ sidebar_collapsed: collapsed });
    }

    public getSidebarWidth(): number {
        return this._store.getState().sidebar_width;
    }

    public setSidebarWidth(width: number): void {
        this._store.updateState({ sidebar_width: width });
    }

    public getHiddenNavItems(): string[] {
        return this._store.getState().hidden_nav_items;
    }

    public setHiddenNavItems(items: string[]): void {
        this._store.updateState({ hidden_nav_items: items });
    }

    public getHiddenMonitors(): string[] {
        return this._store.getState().hidden_monitors;
    }

    public setHiddenMonitors(items: string[]): void {
        this._store.updateState({ hidden_monitors: items });
    }

    public getCardWidths(): Record<string, string> {
        return this._store.getState().card_widths;
    }

    public setCardWidth(cardId: string, width: string): void {
        this._store.updateNestedState('card_widths', cardId, width);
    }

    public getLastPage(): string {
        return this._store.getState().last_page ?? 'home';
    }

    public setLastPage(page: string): void {
        this._store.updateState({ last_page: page });
    }

    public getZoomLevel(): number {
        return this._store.getState().zoom_level;
    }

    public setZoomLevel(zoom: number): void {
        this._store.updateState({ zoom_level: zoom }, false); // False = no diry flag
    }

    public getResolutionZoom(resKey: string): number | undefined {
        return this._store.getState().resolution_zoom[resKey];
    }

    public setResolutionZoom(resKey: string, zoom: number): void {
        this._store.updateNestedState('resolution_zoom', resKey, zoom, false);
    }

    public getSoundEnabled(): boolean {
        return this._store.getState().sound_enabled;
    }

    public setSoundEnabled(enabled: boolean): void {
        this._store.updateState({ sound_enabled: enabled });
    }
}
