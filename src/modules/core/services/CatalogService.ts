/**
 * @module core/services/CatalogService
 * @description Manages the application catalog and configuration
 */

import { TauriProvider } from './TauriProvider';
import { IApp, IModule } from '../types/coreTypes';

interface ICatalogData {
    ai: IApp[];
    services: IApp[];
    stars?: string[];
    [key: string]: unknown;
}

interface IApiProvider {
    id: string;
    name: string;
    type: string;
    baseUrl?: string;
    [key: string]: unknown;
}

interface IAppConfig {
    catalog?: ICatalogData;
    models?: Record<string, unknown>;
    api_providers?: IApiProvider[];
}

declare global {
    var catalogService: CatalogService;
}

interface ICatalogGlobal {
    catalogService?: CatalogService;
    APP_DATA?: Record<string, IApp[]>;
    updateModuleSettings?: (m: Record<string, unknown>) => void;
    dispatchEvent: (event: Event) => boolean;
}

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };

    constructor(private readonly _tauri: TauriProvider) {
        const win = globalThis as unknown as ICatalogGlobal;
        
        if (win.catalogService) {
            console.warn('[CatalogService] Singleton instance already exists.');
        }
        win.catalogService = this;

        // Sync with global APP_DATA
        if (win.APP_DATA) {
            Object.assign(this._appData, win.APP_DATA);
        } else {
            win.APP_DATA = this._appData as unknown as Record<string, IApp[]>;
        }
    }

    /**
     * Asynchronously loads the application catalog from the Tauri backend.
     */
    public async loadCatalog(): Promise<void> {
        try {
            if (this._tauri.isTauri()) {
                const config = await this._tauri.invoke<IAppConfig>('get_config');

                console.debug('[CatalogService] Raw config:', config);

                if (config?.catalog) {
                    // Update internal state
                    this._appData.stars = config.catalog.stars;
                    this._appData.ai = config.catalog.ai || [];
                    this._appData.services = config.catalog.services || [];

                    // Hydrate with installed schemas
                    try {
                        const installedModules = await this._tauri.invoke<IModule[]>('get_modules');
                        const installedMap = new Map(installedModules.map(m => [m.id, m]));

                        const mergeSchema = (list: IApp[]) => {
                            list.forEach(app => {
                                // Dynamic Config Schema Generation
                                const providers = config.api_providers;
                                if (providers && Array.isArray(providers)) {
                                    const provider = providers.find(p => p.id === app.id);
                                    if (provider) {
                                        app.config_schema = {
                                            api_key: {
                                                label: `${provider.name} API Key`,
                                                field_type: 'text',
                                                default: '',
                                                required: true
                                            }
                                        };
                                        // Pass providers models to global state for SettingsUI
                                        app.api_provider_data = provider as unknown as Record<string, unknown>;

                                        if (provider.baseUrl && provider.type === 'openai-compatible') {
                                            app.config_schema.endpoint = {
                                                label: 'Endpoint URL',
                                                field_type: 'text',
                                                default: provider.baseUrl,
                                                required: true
                                            };
                                        }
                                    }
                                }

                                // Legacy / Local Fallbacks
                                if (app.id === 'localai' && !app.config_schema) {
                                    app.config_schema = {
                                        endpoint: { label: 'LocalAI Endpoint', field_type: 'text', default: 'http://localhost:8080/v1', required: true },
                                        model: { label: 'Model Name', field_type: 'text', default: 'phi-3', required: true }
                                    };
                                }

                                if (installedMap.has(app.id)) {
                                    app.installed = true;
                                    const inst = installedMap.get(app.id);
                                    if (inst?.config_schema) {
                                        app.config_schema = inst.config_schema;
                                    }
                                }
                            });
                        };

                        mergeSchema(this._appData.ai);
                        mergeSchema(this._appData.services);
                    } catch (e) {
                        console.warn('[CatalogService] Failed to hydrate modules:', e);
                    }

                    this._syncToGlobal();
                    this._updateLegacySettings(config.models);

                    console.log('[CatalogService] Catalog loaded:', this._appData);
                    globalThis.dispatchEvent(new CustomEvent('catalog-loaded'));
                }
            } else {
                 console.log('[CatalogService] Mock Mode - skipping load');
            }
        } catch (e) {
            console.error('[CatalogService] Failed to load catalog:', e);
        }
    }

    /**
     * Returns the current catalog data.
     */
    public getCatalog(): ICatalogData {
        return this._appData;
    }

    /**
     * Synchronizes internal state to global state.
     */
    private _syncToGlobal(): void {
        const win = globalThis as unknown as ICatalogGlobal;
        const globalAppData = win.APP_DATA;
        if (globalAppData) {
            if (this._appData.ai) {
                globalAppData.ai = this._appData.ai;
            }
            if (this._appData.services) {
                globalAppData.services = this._appData.services;
            }
             // Cast because global definition might be simpler than runtime object
             (globalAppData as unknown as ICatalogData).stars = this._appData.stars;
        }
    }

    /**
     * Updates legacy module settings from config.
     */
    private _updateLegacySettings(models: unknown): void {
        const win = globalThis as unknown as ICatalogGlobal;
        if (win.updateModuleSettings && models) {
            try {
                win.updateModuleSettings(models as Record<string, unknown>);
            } catch {
                console.warn('[CatalogService] Warning updating module settings');
            }
        }
    }
}
