import type { IApp, ICatalogData, IModuleDownloadState, ITauriInstance } from './coreTypes';
import type { IUIState } from '../services/StateService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { CatalogService } from '../services/CatalogService';
import type { errorHandler } from '../services/ErrorHandler';

/**
 * @description Typed signatures for Axelate's global bridge functions.
 * Use these instead of 'Function' or 'any' safely.
 */

export type TTranslateFunction = (key: string, defaultValue?: string) => string;
export type TShowToastFunction = (
    message: string,
    type?: 'info' | 'success' | 'warning' | 'error',
) => void;
export type TOpenSettingsFunction = (app: IApp) => void;
export type TDownloadModuleFunction = (id: string, url: string, hash?: string) => Promise<void>;
export type TStopProviderFunction = () => void;

export interface IGlobalBridge {
    t?: TTranslateFunction;
    showToast?: TShowToastFunction;
    openModuleSettings?: TOpenSettingsFunction;
    downloadModule?: TDownloadModuleFunction;
    aiBridge?: {
        stopProvider: TStopProviderFunction;
        [key: string]: unknown;
    };
    moduleDownloadState?: Record<string, IModuleDownloadState>;
    __TAURI__?: ITauriInstance;
    __TAURI_INTERNALS__?: unknown;
    uiState?: IUIState;
    errorHandler?: typeof errorHandler;
    getCatalogCategory?: (cat: string) => IApp[];
    templateLoader?: {
        load: (id: string) => Promise<string>;
    };
    navigationService?: NavigationService;
    navigate?: (pageId: string) => void;
    catalogService?: CatalogService;
    APP_DATA?: ICatalogData;
    [key: string]: unknown;
}

export type TGlobalWin = typeof globalThis & IGlobalBridge;
