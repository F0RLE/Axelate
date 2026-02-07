/**
 * @module core/services/CatalogService
 * @description Manages the application catalog and configuration
 */

import { type TauriProvider } from './TauriProvider';
import type { IApp, IModule } from '../types/coreTypes';
import type { AppConfig } from '../types/bindings';

// Redundant ICatalogData removed (Inherited from global.d.ts)

// Local interfaces removed in favor of Bindings

import type { TGlobalWin } from '../types/global_bridge_types';

const FALLBACK_CONFIG: AppConfig = {
    version: '1.0.0',
    catalog: {
        ai: [
            {
                id: 'axelate-localai',
                nameKey: 'ui.launcher.app.axelate_localai.name',
                descKey: 'ui.launcher.app.axelate_localai.desc',
                name: 'Axelate',
                desc: 'Universal hub for pro-grade images and text.',
                description: 'Universal hub for pro-grade images and text.',
                icon: '🌌',
                type: 'local',
                repoUrl: 'https://github.com/F0RLE/Axelate_LocalAI_module',
                expectedHash: '',
                version: '1.0.0',
                installed: true,
            },
            {
                id: 'gpt',
                nameKey: 'ui.launcher.app.gpt.name',
                descKey: 'ui.launcher.app.gpt.desc',
                name: 'GPT',
                desc: 'Smart assistant for chat, coding and images.',
                description: 'Smart assistant for chat, coding and images.',
                icon: '🤖',
                type: 'api',
                version: '1.0.0',
                installed: true,
            },
            {
                id: 'gemini',
                nameKey: 'ui.launcher.app.gemini.name',
                descKey: 'ui.launcher.app.gemini.desc',
                name: 'Gemini',
                desc: 'Massive-context analysis and creative visuals.',
                description: 'Massive-context analysis and creative visuals.',
                icon: '✨',
                type: 'api',
                version: '1.0.0',
                installed: true,
            },
            {
                id: 'claude',
                nameKey: 'ui.launcher.app.claude.name',
                descKey: 'ui.launcher.app.claude.desc',
                name: 'Claude',
                desc: 'Advanced AI for analysis and creativity.',
                description: 'Advanced AI for analysis and creativity.',
                icon: '✱',
                type: 'api',
                version: '1.0.0',
                installed: true,
            },
            {
                id: 'llama',
                nameKey: 'ui.launcher.app.llama.name',
                descKey: 'ui.launcher.app.llama.desc',
                name: 'Llama',
                desc: 'Powerful open models.',
                description: 'Powerful open models.',
                icon: '🦙',
                type: 'api',
                version: '1.0.0',
                installed: true,
            },
            {
                id: 'deepseek',
                nameKey: 'ui.launcher.app.deepseek.name',
                descKey: 'ui.launcher.app.deepseek.desc',
                name: 'DeepSeek',
                desc: 'Specialized models for coding.',
                description: 'Specialized models for coding.',
                icon: '🧠',
                type: 'api',
                version: '1.0.0',
                installed: true,
            },
        ],
        services: [
            {
                id: 'axelate-telegram-bot',
                nameKey: 'ui.launcher.app.axelate_telegram.name',
                descKey: 'ui.launcher.app.axelate_telegram.desc',
                name: 'Axelate Telegram Bot',
                desc: 'LLM rewriting, image gen, channel posting.',
                description: 'LLM rewriting, image gen, channel posting.',
                icon: '🤖',
                type: 'local',
                repoUrl: 'https://github.com/F0RLE/Axelate-tg-bot-module',
                expectedHash: '',
                version: '1.0.0',
                installed: false,
            },
        ],
    },
    apiProviders: [
        { id: 'gpt', name: 'GPT', providerType: 'api', baseUrl: 'https://api.openai.com/v1' },
        { id: 'gemini', name: 'Gemini', providerType: 'api' },
        { id: 'claude', name: 'Claude', providerType: 'api' },
        { id: 'llama', name: 'Llama', providerType: 'api' },
        { id: 'deepseek', name: 'DeepSeek', providerType: 'api' },
    ],
    models: {
        gpt: {
            'gpt-5.2': { descKey: '', name: 'GPT-5.2', desc: 'Best for coding', pricing: [], stats: { speed: 3, logic: 5, creative: 5 } },
            'gpt-5-mini': { descKey: '', name: 'GPT-5 mini', desc: 'Fast and efficient', pricing: [], stats: { speed: 4, logic: 3, creative: 3 } },
        },
        gemini: {
            'gemini-3-pro': { descKey: '', name: 'Gemini 3 Pro', desc: 'State-of-the-art reasoning', pricing: [], stats: { speed: 3, logic: 5, creative: 5 } },
            'gemini-3-flash': { descKey: '', name: 'Gemini 3 Flash', desc: 'Fast for quick tasks', pricing: [], stats: { speed: 5, logic: 3, creative: 3 } },
        },
    },
};

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };

    constructor(private readonly _tauri: TauriProvider) {
        const win = globalThis as TGlobalWin;
        if (win.catalogService) {
            console.warn('[CatalogService] Singleton instance collision detected.');
        }
        win.catalogService = this;

        // Sync with global APP_DATA (Architectural compliance Section 51)
        if (win.APP_DATA) {
            Object.assign(this._appData, win.APP_DATA);
        } else {
            win.APP_DATA = this._appData;
        }

        // Expose category resolver for AppUI type safety
        win.getCatalogCategory = (cat: string): IApp[] => {
            if (cat === 'ai') return this._appData.ai;
            if (cat === 'services') return this._appData.services;
            return [];
        };
    }

    /**
     * Asynchronously loads the application catalog from the Tauri backend.
     */
    public async loadCatalog(): Promise<void> {
        let config: AppConfig | null = null;
        let installedModules: IModule[] = [];

        // 1. Fetch Config (Robust Failsafe)
        try {
            if (this._tauri.isTauri()) {
                config = await this._tauri.invoke<AppConfig>('get_config');
            } else {
                const res = await fetch('/api/config');
                if (res.ok) config = (await res.json()) as AppConfig;
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
                if (res.ok) installedModules = (await res.json()) as IModule[];
            }
        } catch (e) {
            console.warn('[CatalogService] Module list failed:', e);
        }

        try {
            console.log('[CatalogService] Loaded config:', config);

            if (config?.catalog) {
                // Update internal state
                this._appData.stars = config.catalog.stars ?? [];
                this._appData.ai = config.catalog.ai || [];
                this._appData.services = config.catalog.services || [];

                // Hydrate with schemas & providers (SHARED LOGIC)
                // Fix: specific case-insensitive mapping to ensure 'Axelate-LocalAI' matches 'axelate-localai'
                const installedMap = new Map(installedModules.map((m) => [m.id.toLowerCase(), m]));

                const mergeSchema = (list: IApp[]) => {
                    list.forEach((app) => {
                        // Normalize type to lowercase for consistent checking
                        if (app.type) app.type = app.type.toLowerCase() as 'api' | 'local';

                        // Determine if this is an API-type app
                        const isApi =
                            app.type === 'api' ||
                            config?.apiProviders?.some((p: { id: string }) => p.id === app.id);

                        // Force installed status for API providers (Virtual Modules)
                        if (isApi) {
                            app.installed = true;
                        }

                        // Initialize apiProviderData for API apps
                        const providers = config?.apiProviders;
                        if (providers && Array.isArray(providers)) {
                            const provider = providers.find((p: { id: string }) => p.id === app.id);
                            if (provider) {
                                app.apiProviderData = { ...(provider as unknown as Record<string, unknown>) };
                            }
                        }

                        // Merge models from config.models[app.id] for API apps
                        // This works even if apiProviders is missing (e.g., when loaded from backend)
                        if (isApi) {
                            const modelsRecord = config?.models as Record<string, unknown> | undefined;
                            if (modelsRecord?.[app.id]) {
                                // Initialize apiProviderData if not set
                                app.apiProviderData ??= { id: app.id, name: app.name };
                                app.apiProviderData['models'] = modelsRecord[app.id];
                            }
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
     * Retrieves an app by its ID from the catalog.
     */
    public getAppById(id: string): IApp | undefined {
        return (
            this._appData.ai.find((a) => a.id === id) ||
            this._appData.services.find((s) => s.id === id)
        );
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
            if (this._appData.stars) {
                globalAppData.stars = this._appData.stars;
            }
        }
    }

    /**
     * Updates legacy module settings from config.
     */
    private _updateLegacySettings(models: unknown): void {
        const win = globalThis as TGlobalWin;
        const updateFn = win.updateModuleSettings; // Assuming this exists or add to IGlobalBridge?
        if (typeof updateFn === 'function' && models) {
            try {
                updateFn(models as Record<string, unknown>);
            } catch {
                console.warn('[CatalogService] Warning updating module settings');
            }
        }
    }
}
