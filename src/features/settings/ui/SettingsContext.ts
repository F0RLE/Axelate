import type { IApp } from '@/shared/types/coreTypes';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';

export interface ISettingsUIContext {
    currentModule?: IApp;
    t: (key: string, defaultVal?: string, params?: unknown) => string;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    toggleNavItem?: (id: string, en: boolean) => void;
    toggleMonitorItem?: (id: string, en: boolean) => void;
    i18nUI: I18nUI;
}
