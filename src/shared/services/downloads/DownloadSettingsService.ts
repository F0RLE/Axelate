import type { UiStateStore } from '../state/UiStateStore';
import { type IBridge } from '@/shared/types/IBridge';
import { logger } from '@/infrastructure/logging/LoggerService';

export class DownloadSettingsService {
    constructor(
        private readonly _store: UiStateStore,
        private readonly _bridge: IBridge,
    ) {}

    public getDownloadSettings(): { limitEnabled: boolean; maxSpeed: number } {
        const state = this._store.getState();
        return {
            limitEnabled: state.download_limit_enabled,
            maxSpeed: state.download_max_speed,
        };
    }

    public setDownloadSettings(limitEnabled: boolean, maxSpeed: number): void {
        this._store.updateState({
            download_limit_enabled: limitEnabled,
            download_max_speed: maxSpeed,
        });
        this.syncToBackend();
    }

    public syncToBackend(): void {
        if (this._bridge.isTauri()) {
            const state = this._store.getState();
            this._bridge
                .invoke('set_download_settings', {
                    enabled: state.download_limit_enabled,
                    max_speed: state.download_max_speed,
                })
                .catch((e: unknown) => {
                    logger.error(
                        `[DownloadSettingsService] Failed to sync download settings: ${String(e)}`,
                    );
                });
        }
    }
}
