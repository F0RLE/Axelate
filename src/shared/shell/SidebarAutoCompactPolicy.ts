import type { IWindowConfig } from '../services/WindowService';

type SidebarAutoCompactPolicyConfig = {
    collapsedWidth: number;
    expandedWidth: number;
    autoCompactZoomThreshold: number;
    autoCompactMaxZoomEpsilon: number;
};

export class SidebarAutoCompactPolicy {
    constructor(private readonly _config: SidebarAutoCompactPolicyConfig) {}

    public isAutoCompact(
        zoom: number,
        _windowConfig: IWindowConfig | null | undefined,
        maxSafeZoom?: number,
    ): boolean {
        if (maxSafeZoom !== undefined && Number.isFinite(maxSafeZoom)) {
            return zoom >= maxSafeZoom - this._config.autoCompactMaxZoomEpsilon;
        }

        return zoom >= this._config.autoCompactZoomThreshold;
    }

    public getSidebarWidth(collapsed: boolean, autoCompact: boolean): number {
        return collapsed || autoCompact ? this._config.collapsedWidth : this._config.expandedWidth;
    }

    public getPersistedWidth(collapsed: boolean): number {
        return collapsed ? this._config.collapsedWidth : this._config.expandedWidth;
    }
}
