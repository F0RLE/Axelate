/**
 * @module shared/types/IStateService
 * @description Interface for StateService state management (DIP support)
 */

export interface IStateService {
    getDownloadSettings(): { limitEnabled: boolean; maxSpeed: number };
    setDownloadSettings(limitEnabled: boolean, maxSpeed: number): void;
    // Add other methods as needed for other consumers,
    // but for DownloadUI refactor, these are the critical ones.
}
