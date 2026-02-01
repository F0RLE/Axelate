/**
 * @module core/types/coreTypes
 * @description Centralized type definitions for the Core module
 */

import { IUIState } from '../services/StateService';
import { IWindowConfig } from '../services/WindowService';

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
        listen: <T>(
            _event: string,
            _handler: (_event: { payload: T }) => void,
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
    type?: 'api' | 'local';
    installed?: boolean;
    repoUrl?: string;
    configSchema?: Record<string, IConfigField>;
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
export interface IConfigField {
    fieldType: string;
    label: string;
    default?: unknown;
    required: boolean;
    options?: string[];
}

/**
 * Generic module information.
 */
export interface IModule {
    id: string;
    name: string;
    version: string;
    status: string;
    configSchema?: Record<string, IConfigField>;
    isDeletable: boolean;
}

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
    status: 'init' | 'pending' | 'connecting' | 'downloading' | 'extracting' | 'complete' | 'error';
    progress: number;
    message?: string;
    downloaded?: number;
    total?: number;
    error?: unknown;
}

/**
 * Unified application bootstrap data from backend.
 */
export interface IBootstrapData {
    uiState: IUIState;
    windowConfig: IWindowConfig;
    systemLanguage: string;
    modules: IModule[];
    initialZoom: number;
}
