import type { IApp, ITauriInstance } from './coreTypes';
import type { IUIState } from '../services/StateService';
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
    };
    __TAURI__?: ITauriInstance;
    uiState?: IUIState;
    errorHandler?: typeof errorHandler;
    getCatalogCategory?: (cat: string) => IApp[];
    templateLoader?: {
        load: (id: string) => Promise<string>;
    };
    [key: string]: unknown;
}

export type TGlobalWin = typeof globalThis & IGlobalBridge;
