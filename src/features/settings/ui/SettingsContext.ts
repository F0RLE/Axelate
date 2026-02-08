import type { IApp } from '@/shared/types/coreTypes';

export interface ISettingsUIContext {
    currentModule?: IApp;
    t: (key: string, defaultVal?: string, params?: unknown) => string;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    toggleNavItem?: (id: string, en: boolean) => void;
    toggleMonitorItem?: (id: string, en: boolean) => void;
}
