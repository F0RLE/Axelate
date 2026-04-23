import type { IApp } from '@/shared/types/coreTypes';

export interface DeferredUiController {
    init(): void | Promise<void>;
    destroy(): void;
}

export interface ClosableDeferredUiController extends DeferredUiController {
    close(): void;
}

export interface ModuleSettingsUiController extends ClosableDeferredUiController {
    openModuleSettings(app: IApp): Promise<void>;
}
