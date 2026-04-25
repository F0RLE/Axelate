import type { IWindowConfig } from '../services/WindowService';

type SidebarAutoCompactPolicyConfig = {
    collapsedWidth: number;
    expandedWidth: number;
    autoCompactZoomThreshold: number;
    autoCompactThresholdFactor: number;
};

type SidebarViewport = {
    width: number;
    height: number;
};

export class SidebarAutoCompactPolicy {
    constructor(private readonly _config: SidebarAutoCompactPolicyConfig) {}

    public isAutoCompact(
        zoom: number,
        windowConfig: IWindowConfig | null | undefined,
        viewport: SidebarViewport,
    ): boolean {
        if (zoom >= this._config.autoCompactZoomThreshold) {
            return true;
        }

        if (windowConfig !== null && windowConfig !== undefined) {
            const compactWarningWidth =
                windowConfig.thresholds.warningWidth * this._config.autoCompactThresholdFactor;
            const compactWarningHeight =
                windowConfig.thresholds.warningHeight * this._config.autoCompactThresholdFactor;

            return viewport.width < compactWarningWidth || viewport.height < compactWarningHeight;
        }

        return false;
    }

    public getSidebarWidth(collapsed: boolean, autoCompact: boolean): number {
        return collapsed || autoCompact ? this._config.collapsedWidth : this._config.expandedWidth;
    }

    public getPersistedWidth(collapsed: boolean): number {
        return collapsed ? this._config.collapsedWidth : this._config.expandedWidth;
    }
}
