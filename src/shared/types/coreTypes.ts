/**
 * @module core/types/coreTypes
 * @description Centralized type definitions for the Core module
 */

import type { IUIState } from '../services/state/UiStateStore';
import type { IWindowConfig } from '../services/WindowService';

/**
 * Interface for the Tauri host instance.
 */
export interface ITauriInstance {
    core: {
        invoke: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
    };
    window: {
        getCurrentWindow: () => {
            isMaximized: () => Promise<boolean>;
            setSize: (_size: { width: number; height: number }) => Promise<void>;
            center: () => Promise<void>;
            innerSize: () => Promise<{ width: number; height: number }>;
            outerPosition: () => Promise<{ x: number; y: number }>;
        };
        LogicalSize: new (_width: number, _height: number) => { width: number; height: number };
    };
    event: {
        listen: (
            _event: string,
            _handler: (_event: { payload: unknown }) => void,
        ) => Promise<() => void>;
    };
}

/**
 * Application/Module metadata from the catalog.
 */
export interface IApp {
    id: string;
    name?: string;
    nameKey?: string;
    desc?: string;
    descKey?: string;
    icon?: string;
    category?: string;
    type?: 'api' | 'local';
    capability?: 'text' | 'image'; // AI output capability; used for modal filter tabs
    installed?: boolean;
    repoUrl?: string;
    expectedHash?: string;
    dlType?: string;
    comingSoon?: boolean;
    managedExternally?: boolean;
    configSchema?: Record<string, IConfigField>;
    settingsUi?: string | null;
    apiProviderData?: Record<string, unknown>; // Dynamic provider metadata for rich UI
}

/**
 * Event payload for page changes.
 */
export interface INavigationEvent {
    pageId: string;
    previousPageId: string | null;
}

/**
 * Configuration field definition for a module or app.
 */
import type * as Bindings from './bindings';

/* ... imports ... */

export type IConfigField = Bindings.ConfigField;

/**
 * Generic module information.
 */
export type IModule = Bindings.Module & {
    // Frontend specific augmentations
    status?: string | null;
    isDeletable?: boolean;
};

// Window interface is defined in vite-env.d.ts

/**
 * Standard log entry format.
 */
export interface ILogEntry {
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    message: string;
    timestamp?: string;
    source?: string;
}

/**
 * State of a module download/installation process.
 */
export interface IModuleDownloadState {
    status:
        | 'init'
        | 'pending'
        | 'connecting'
        | 'downloading'
        | 'extracting'
        | 'complete'
        | 'error'
        | 'cancelled';
    progress: number;
    message?: string;
    downloaded?: number;
    total?: number;
    speed?: number;
    error?: unknown;
}

/**
 * Unified application bootstrap data from backend.
 */
export interface IBootstrapData {
    uiState: IUIState;
    windowConfig: IWindowConfig;
    systemLanguage: string;
    initialZoom: number;
}

export interface ICatalogData {
    ai: IApp[];
    services: IApp[];
    stars?: string[];
}
