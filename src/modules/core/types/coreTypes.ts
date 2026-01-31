/**
 * @module core/types/coreTypes
 * @description Centralized type definitions for the Core module
 */

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
    repo_url?: string;
    repoUrl?: string; // Fallback for camelCase JSON
    config_schema?: Record<string, IConfigField>;
    api_provider_data?: Record<string, unknown>; // Dynamic provider metadata for rich UI
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
    field_type: string;
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
    config_schema?: Record<string, IConfigField>;
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
