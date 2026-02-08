/**
 * @module core/services/CatalogService
 * @description Manages the application catalog and configuration
 */

import { type TauriProvider } from './TauriProvider';
import type { IApp, IModule, IConfigField } from '../types/coreTypes';
import type { AppConfig, ModuleItem, ApiProvider } from '../types/bindings';
import { logger } from './LoggerService';

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
            'gpt-5.3-codex': {
                descKey: '',
                name: 'GPT‑5.3 Codex',
                desc: 'Top coding and developer workflows — best code reasoning and generation.',
                pricing: [
                    { tier: 'Input', note: '$1.75' },
                    { tier: 'Output', note: '$14.00' },
                ],
                stats: { speed: 6, logic: 10, creative: 8 },
            },
            'gpt-5.2': {
                descKey: '',
                name: 'GPT‑5.2',
                desc: 'Balanced general reasoning, multimodal tasks and productivity AI.',
                pricing: [
                    { tier: 'Input', note: '$1.75' },
                    { tier: 'Output', note: '$14.00' },
                ],
                stats: { speed: 7, logic: 9, creative: 9 },
            },
            'gpt-5-mini': {
                descKey: '',
                name: 'GPT‑5 Mini',
                desc: 'Fast, cost‑effective model with good all‑around skills.',
                pricing: [
                    { tier: 'Input', note: '$0.30' },
                    { tier: 'Output', note: '$1.00' },
                ],
                stats: { speed: 10, logic: 5, creative: 5 },
            },
        },
        gemini: {
            'gemini-3-pro': {
                descKey: '',
                name: 'Gemini 3 Pro',
                desc: 'Huge context (up to ~1M), strong multimodal and reasoning skills.',
                pricing: [
                    { tier: 'Input', note: '$2.00' },
                    { tier: 'Output', note: '$12.00' },
                ],
                stats: { speed: 6, logic: 9, creative: 9 },
            },
            'gemini-3-flash': {
                descKey: '',
                name: 'Gemini 3 Flash',
                desc: 'High‑volume, affordable model with long context and speed.',
                pricing: [
                    { tier: 'Input', note: '$0.50' },
                    { tier: 'Output', note: '$3.00' },
                ],
                stats: { speed: 9, logic: 7, creative: 7 },
            },
        },
        claude: {
            'claude-opus-4.6': {
                descKey: '',
                name: 'Claude Opus 4.6',
                desc: 'Enterprise‑grade reasoning and long context work, adaptive thinking.',
                pricing: [
                    { tier: 'Input', note: '$5.00' },
                    { tier: 'Output', note: '$25.00' },
                ],
                stats: { speed: 5, logic: 10, creative: 10 },
            },
            'claude-sonnet-4.5': {
                descKey: '',
                name: 'Claude Sonnet 4.5',
                desc: 'Balanced performance for general tasks and coding workflows.',
                pricing: [
                    { tier: 'Input', note: '$3.00' },
                    { tier: 'Output', note: '$15.00' },
                ],
                stats: { speed: 7, logic: 8, creative: 8 },
            },
            'claude-haiku-4.5': {
                descKey: '',
                name: 'Claude Haiku 4.5',
                desc: 'Cost‑efficient model for high‑volume tasks.',
                pricing: [
                    { tier: 'Input', note: '$1.00' },
                    { tier: 'Output', note: '$5.00' },
                ],
                stats: { speed: 9, logic: 6, creative: 5 },
            },
        },
        deepseek: {
            'deepseek-v3.2': {
                descKey: '',
                name: 'DeepSeek V3.2',
                desc: 'Open‑source alternative with strong reasoning at low cost.',
                pricing: [
                    { tier: 'Input', note: '$0.27' },
                    { tier: 'Output', note: '$1.10' },
                ],
                stats: { speed: 8, logic: 8, creative: 6 },
            },
            'deepseek-chat': {
                descKey: '',
                name: 'DeepSeek Chat',
                desc: 'Budget‑friendly conversational model.',
                pricing: [
                    { tier: 'Input', note: '$0.14' },
                    { tier: 'Output', note: '$0.28' },
                ],
                stats: { speed: 9, logic: 6, creative: 5 },
            },
        },
        llama: {
            'llama-4-scout': {
                descKey: '',
                name: 'Llama 4 Scout',
                desc: 'Open self‑hosted model with massive context scaling.',
                pricing: [
                    { tier: 'Input', note: 'Self‑hosted' },
                    { tier: 'Output', note: 'Self‑hosted' },
                ],
                stats: { speed: 7, logic: 7, creative: 7 },
            },
            'llama-4-behemoth': {
                descKey: '',
                name: 'Llama 4 Behemoth',
                desc: 'Largest open self‑hosted model for deep reasoning.',
                pricing: [
                    { tier: 'Input', note: 'Self‑hosted' },
                    { tier: 'Output', note: 'Self‑hosted' },
                ],
                stats: { speed: 5, logic: 9, creative: 9 },
            },
        },
    },
};

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };

    constructor(private readonly _tauri: TauriProvider) {
        const win = globalThis as TGlobalWin;
        // Detection removed to satisfy strict bool check - assuming singleton
        win.catalogService = this;

        // Sync with global APP_DATA (Architectural compliance Section 51)
        win.APP_DATA = this._appData;

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
            logger.warn(`[CatalogService] Backend config failed, using fallback: ${String(e)}`);
            config = FALLBACK_CONFIG;
        }

        config = this._ensureValidConfig(config);

        // 2. Fetch Modules (Independent)
        try {
            if (this._tauri.isTauri()) {
                installedModules = await this._tauri.invoke<IModule[]>('get_modules');
                logger.info(
                    `[CatalogService] Fetched ${installedModules.length} installed modules from backend.`,
                );
            } else {
                const res = await fetch('/api/modules');
                if (res.ok) installedModules = (await res.json()) as IModule[];
            }
        } catch (e) {
            logger.warn(`[CatalogService] Module list failed: ${String(e)}`);
        }

        try {
            logger.info(`[CatalogService] Loaded config: ${JSON.stringify(config)}`);

            if (config?.catalog) {
                const safeConfig = config;
                this._appData.stars = safeConfig.catalog.stars ?? [];

                // Map ModuleItem[] to IApp[] explicitly to handle type property mismatch
                const mapModules = (items: ModuleItem[]): IApp[] => {
                    return items.map(
                        (item) =>
                            ({
                                ...item,
                                type: item.type === 'api' ? 'api' : 'local',
                            }) as IApp,
                    );
                };

                this._appData.ai = mapModules(safeConfig.catalog.ai);
                this._appData.services = mapModules(safeConfig.catalog.services);
                
                logger.info(
                    `[CatalogService] Mapped AI apps: ${this._appData.ai.length}, Services: ${this._appData.services.length}`,
                );

                // Hydrate with schemas & providers
                const installedMap = new Map(installedModules.map((m) => [m.id.toLowerCase(), m]));

                const mergeAppSchema = (app: IApp) => {
                    // Determine if this is an API-type app
                    const isApi =
                        app.type === 'api' ||
                        (safeConfig.apiProviders?.some((p: ApiProvider) => p.id === app.id) ?? false);

                    if (isApi) app.installed = true;

                    // Initialize apiProviderData
                    const provider = safeConfig.apiProviders?.find((p: ApiProvider) => p.id === app.id);
                    if (provider) {
                        app.apiProviderData = {
                            ...(provider as unknown as Record<string, unknown>),
                        };
                    }

                    // Merge models
                    const modelsRecord = safeConfig.models as Record<string, unknown> | undefined;
                    if (isApi && modelsRecord?.[app.id] !== undefined) {
                        app.apiProviderData ??= { id: app.id, name: app.name };
                        app.apiProviderData['models'] = modelsRecord[app.id];
                    }

                    // Backend config schema
                    const inst = installedMap.get(app.id.toLowerCase());
                    if (inst?.configSchema) {
                        app.configSchema = inst.configSchema as unknown as Record<
                            string,
                            IConfigField
                        >;
                    }
                };

                this._appData.ai.forEach(mergeAppSchema);
                this._appData.services.forEach(mergeAppSchema);

                this._syncToGlobal();
                if (safeConfig.models) {
                    this._updateLegacySettings(safeConfig.models);
                }

                logger.info(
                    `[CatalogService] Catalog initialized: ${JSON.stringify(this._appData)}`,
                );
                globalThis.dispatchEvent(new CustomEvent('catalog-loaded'));
            }
        } catch (e) {
            logger.error(`[CatalogService] Failed to load catalog: ${String(e)}`);
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
            this._appData.ai.find((a) => a.id === id) ??
            this._appData.services.find((s) => s.id === id)
        );
    }

    /**
     * Synchronizes internal state to global state.
     */
    private _syncToGlobal(): void {
        const globalAppData = globalThis.APP_DATA;
        globalAppData.ai = this._appData.ai;
        globalAppData.services = this._appData.services;
        if (this._appData.stars !== undefined) {
            globalAppData.stars = this._appData.stars;
        }
    }

    /**
     * Updates legacy module settings from config.
     */
    private _updateLegacySettings(models: unknown): void {
        const win = globalThis as TGlobalWin;
        const updateFn = win.updateModuleSettings; // Assuming this exists or add to IGlobalBridge?
        if (typeof updateFn === 'function' && models !== undefined && models !== null) {
            try {
                updateFn(models as Record<string, unknown>);
            } catch {
                logger.warn('[CatalogService] Warning updating module settings');
            }
        }
    }

    /**
     * Validates the configuration and returns a fallback if invalid.
     */
    private _ensureValidConfig(config: AppConfig | null): AppConfig {
        const isCatalogEmpty =
            !config?.catalog ||
            (!config.catalog.ai?.length && !config.catalog.services?.length);

        if (isCatalogEmpty) {
            logger.warn(
                `[CatalogService] Config invalid or empty (AI: ${config?.catalog?.ai?.length}, Services: ${config?.catalog?.services?.length}). Forcing fallback.`,
            );
            return FALLBACK_CONFIG;
        }
        return config;
    }
}
