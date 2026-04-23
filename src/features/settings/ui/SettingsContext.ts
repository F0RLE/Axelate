import type { IApp } from '@/shared/types/coreTypes';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';

interface ISettingsBaseContext {
    t: (key: string, defaultVal?: string, params?: unknown) => string;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    i18nUI: I18nUI;
}

export interface IAppSettingsUIContext extends ISettingsBaseContext {
    toggleNavItem: (id: string, en: boolean) => void;
    toggleMonitorItem: (id: string, en: boolean) => void;
}

export interface IModuleSettingsUIContext extends ISettingsBaseContext {
    currentModule?: IApp;
}
