/**
 * @module core/types/coreTypes
 * @description Centralized type definitions for the Core module
 */

import type { IUIState } from '../services/state/UiStateStore';
import type { IWindowConfig } from '../services/WindowService';

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
    preview?: {
        title?: string | null;
        description?: string | null;
        sticker?: string | null;
        image?: string | null;
    } | null;
    category?: string;
    type?: 'api' | 'local';
    capability?: 'text' | 'image'; // AI output capability; used for modal filter tabs
    installed?: boolean;
    installedComputeModes?: Array<'gpu' | 'cpu'>;
    repoUrl?: string;
    expectedHash?: string;
    dlType?: string;
    comingSoon?: boolean;
    managedExternally?: boolean;
    version?: string;
    configSchema?: Record<string, IConfigField>;
    settingsUi?: string | null;
    apiProviderData?: Record<string, unknown>; // Dynamic provider metadata for rich UI
    providerPolicy?: Bindings.CatalogProviderPolicy | null;
    status?: string | null;
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
        | 'verifying'
        | 'extracting'
        | 'paused'
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

export type ReleaseComputeTarget = 'auto' | 'gpu' | 'cpu' | 'both';

export interface ReleaseDownloadSelection {
    tag_name: string | null;
    compute_target: ReleaseComputeTarget;
}

export interface ReleaseDownloadVariant {
    compute_target: ReleaseComputeTarget;
    assets: string[];
    total_size: number;
}

export interface ReleaseDownloadVersion {
    tag_name: string;
    published_at?: string | null;
    cpu?: ReleaseDownloadVariant | null;
    gpu?: ReleaseDownloadVariant | null;
    recommended: ReleaseComputeTarget;
}

export interface ReleaseDownloadOptions {
    module_id: string;
    versions: ReleaseDownloadVersion[];
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
