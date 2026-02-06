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
    apiProviders?: IApiProvider[];
}

declare global {
    var catalogService: CatalogService;
}


const FALLBACK_CONFIG: IAppConfig = {
    catalog: {
        ai: [
            {
                id: 'axelate-localai',
                nameKey: 'ui.launcher.app.axelate_localai.name',
                descKey: 'ui.launcher.app.axelate_localai.desc',
                name: 'Axelate',
                desc: 'Universal hub for pro-grade images and text.',
                icon: '🌌',
                type: 'local',
                repoUrl: 'https://github.com/F0RLE/Axelate_LocalAI_module',
                expectedHash: '',
            },
            {
                id: 'gpt',
                nameKey: 'ui.launcher.app.gpt.name',
                descKey: 'ui.launcher.app.gpt.desc',
                name: 'GPT',
                desc: 'Smart assistant for chat, coding and images.',
                icon: '🤖',
                type: 'api',
            },
            {
                id: 'gemini',
                nameKey: 'ui.launcher.app.gemini.name',
                descKey: 'ui.launcher.app.gemini.desc',
                name: 'Gemini',
                desc: 'Massive-context analysis and creative visuals.',
                icon: '✨',
                type: 'api',
            },
            {
                id: 'claude',
                nameKey: 'ui.launcher.app.claude.name',
                descKey: 'ui.launcher.app.claude.desc',
                name: 'Claude',
                desc: 'Advanced AI for analysis and creativity.',
                icon: '✱',
                type: 'api',
            },
            {
                id: 'llama',
                nameKey: 'ui.launcher.app.llama.name',
                descKey: 'ui.launcher.app.llama.desc',
                name: 'Llama',
                desc: 'Powerful open models.',
                icon: '🦙',
                type: 'api',
            },
            {
                id: 'deepseek',
                nameKey: 'ui.launcher.app.deepseek.name',
                descKey: 'ui.launcher.app.deepseek.desc',
                name: 'DeepSeek',
                desc: 'Specialized models for coding.',
                icon: '🧠',
                type: 'api',
            },
        ],
        services: [
            {
                id: 'axelate-telegram-bot',
                nameKey: 'ui.launcher.app.axelate_telegram.name',
                descKey: 'ui.launcher.app.axelate_telegram.desc',
                name: 'Axelate Telegram Bot',
                desc: 'LLM rewriting, image gen, channel posting.',
                icon: '🤖',
                type: 'local',
                repoUrl: 'https://github.com/F0RLE/Axelate-tg-bot-module',
                expectedHash: '',
            },
        ],
    },
    apiProviders: [
        { id: 'gpt', name: 'GPT', type: 'api', baseUrl: 'https://api.openai.com/v1' },
        { id: 'gemini', name: 'Gemini', type: 'api' },
        { id: 'claude', name: 'Claude', type: 'api' },
        { id: 'llama', name: 'Llama', type: 'api' },
        { id: 'deepseek', name: 'DeepSeek', type: 'api' },
    ],
    models: {},
};

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };

    constructor(private readonly _tauri: TauriProvider) {
        if (globalThis.catalogService) {
            console.warn('[CatalogService] Singleton instance already exists.');
        }
        globalThis.catalogService = this;

        // Sync with global APP_DATA (Architectural compliance Section 51)
        if (globalThis.APP_DATA) {
            Object.assign(this._appData, globalThis.APP_DATA);
        } else {
            globalThis.APP_DATA = this._appData as any;
        }
    }

    /**
     * Asynchronously loads the application catalog from the Tauri backend.
     */
    public async loadCatalog(): Promise<void> {
        let config: IAppConfig | null = null;
        let installedModules: IModule[] = [];

        // 1. Fetch Config (Robust Failsafe)
        try {
            if (this._tauri.isTauri()) {
                config = await this._tauri.invoke<IAppConfig>('get_config');
            } else {
                const res = await fetch('/api/config');
                if (res.ok) config = await res.json();
            }
        } catch (e) {
            console.warn('[CatalogService] Backend config failed, using fallback:', e);
            config = FALLBACK_CONFIG;
        }

        // 2. Fetch Modules (Independent)
        try {
            if (this._tauri.isTauri()) {
                installedModules = await this._tauri.invoke<IModule[]>('get_modules');
            } else {
                const res = await fetch('/api/modules');
                if (res.ok) installedModules = await res.json();
            }
        } catch (e) {
            console.warn('[CatalogService] Module list failed:', e);
        }

        try {
            console.log('[CatalogService] Loaded config:', config);

            if (config?.catalog) {
                // Update internal state
                this._appData.stars = config.catalog.stars;
                this._appData.ai = config.catalog.ai || [];
                this._appData.services = config.catalog.services || [];

                // Hydrate with schemas & providers (SHARED LOGIC)
                // Fix: specific case-insensitive mapping to ensure 'Axelate-LocalAI' matches 'axelate-localai'
                const installedMap = new Map(installedModules.map((m) => [m.id.toLowerCase(), m]));

                const mergeSchema = (list: IApp[]) => {
                    list.forEach((app) => {
                        // Normalize type to lowercase for consistent checking
                        if (app.type) app.type = app.type.toLowerCase() as 'api' | 'local';

                        const providers = config?.apiProviders;
                        if (providers && Array.isArray(providers)) {
                            // Only hydrate API metadata for settings UI if needed
                            const provider = providers.find((p) => p.id === app.id);
                            if (provider) {
                                app.apiProviderData = provider as unknown as Record<
                                    string,
                                    unknown
                                >;
                            }
                        }

                        const isApi =
                            app.type === 'api' ||
                            config?.apiProviders?.some((p) => p.id === app.id);

                        // Force installed status for API providers (Virtual Modules)
                        if (isApi) {
                            app.installed = true;
                        }

                        // Check case-insensitively
                        if (installedMap.has(app.id.toLowerCase())) {
                            app.installed = true;
                            const inst = installedMap.get(app.id.toLowerCase());
                            if (inst?.configSchema) {
                                // Prefer backend config schema if available
                                app.configSchema = inst.configSchema;
                            }
                        }
                    });
                };

                mergeSchema(this._appData.ai);
                mergeSchema(this._appData.services);

                this._syncToGlobal();
                this._updateLegacySettings(config.models);

                console.log('[CatalogService] Catalog initialized:', this._appData);
                globalThis.dispatchEvent(new CustomEvent('catalog-loaded'));
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
        const globalAppData = globalThis.APP_DATA;
        if (globalAppData) {
            if (this._appData.ai) {
                globalAppData.ai = this._appData.ai;
            }
            if (this._appData.services) {
                globalAppData.services = this._appData.services;
            }
            (globalAppData as any).stars = this._appData.stars;
        }
    }

    /**
     * Updates legacy module settings from config.
     */
    private _updateLegacySettings(models: unknown): void {
        if (globalThis.updateModuleSettings && models) {
            try {
                globalThis.updateModuleSettings(models as Record<string, unknown>);
            } catch {
                console.warn('[CatalogService] Warning updating module settings');
            }
        }
    }
}
