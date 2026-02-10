/**
 * @module core/boot/GlobalBridge
 * @description Exposes core functionality to the global window object
 */

import type { Core } from './init';
import type { IApp } from '@/shared/types/coreTypes';
import type { TGlobalWin } from '@/shared/types/global_bridge_types';

/**
 * GlobalBridge handles the exposure of core services to the global window object.
 * This decouples legacy bridge logic and boilerplate from the main Core orchestrator.
 */
export class GlobalBridge {
    private readonly _core: Core;

    constructor(core: Core) {
        this._core = core;
    }

    /**
     * Initialize the bridge by setting up globals and interceptors.
     * @sideeffect Modifies globalThis and intercepts floor fetch
     */
    public init(): void {
        this._setupFetchInterceptor();
        this._setupAxelateAPI();
        this._exposeCoreGlobals();
    }

    /**
     * Expose core functions to globalThis for use by legacy JS modules and UI.
     * @sideeffect Pollutes globalThis namespace with core methods
     */
    private _exposeCoreGlobals(): void {
        const win = globalThis;

        // Module management
        win.downloadModule = (id: string, url: string, hash?: string): Promise<void> =>
            this._core.moduleService.downloadModule(id, url, hash);
        win.deleteModule = async (id: string): Promise<void> => {
            await this._core.moduleService.deleteModule(id);
        };
        win.checkModuleInstalled = (id: string): Promise<boolean> =>
            this._core.moduleService.checkInstalled(id);

        // I18n and Localization
        win.t = (key: string, def?: string, ...args: unknown[]): string =>
            this._core.i18n.t(key, def, args[0] as Record<string, unknown>);

        // Use a getter for currentLang to ensure it's always in sync with I18nService
        Object.defineProperty(win, 'currentLang', {
            get: () => this._core.i18n.getCurrentLang(),
            configurable: true,
            enumerable: true,
        });

        win.setLanguage = async (lang: string): Promise<void> => {
            await this._core.i18nUI.setLanguage(lang);
        };

        // UI Language controls
        win.toggleLangMenu = (): void => {
            this._core.i18nUI.toggleMenu();
        };
        win.toggleSidebarLangMenu = (): void => {
            this._core.i18nUI.toggleSidebarLangMenu();
        };
        win.applyTranslations = (): void => {
            this._core.i18nUI.applyTranslations();
        };
        win.initEmojiFlags = (): void => {
            this._core.i18nUI.initEmojiFlags();
        };
        win.updateLangButtons = (): void => {
            this._core.i18nUI.updateSwitcherUI();
        };

        // Window Controls
        win.minimizeWindow = (): Promise<void> => this._core.windowService.minimize();
        win.toggleMaximizeWindow = (): Promise<void> => this._core.windowService.toggleMaximize();
        win.hideToTray = (): Promise<void> => this._core.windowService.hideToTray();
        win.confirmClose = (): Promise<void> => this._core.windowService.close();
        win.hideSplashScreen = (): void => {
            this._core.windowUI.hideSplashScreen();
        };
        win.changeLanguage = async (lang: string): Promise<void> => {
            await this._core.i18nUI.setLanguage(lang);
        };

        // Navigation and Selection
        win.showPage = (id: string, btn?: HTMLElement | null, isInitial?: boolean): void => {
            void this._core.navigationUI.showPage(id, btn, isInitial);
        };

        win.openAppSelection = (category: string) => {
            const global = globalThis as TGlobalWin;
            const getCat = global.getCatalogCategory as ((_c: string) => IApp[]) | undefined;
            const apps = getCat?.(category) ?? [];
            this._core.logger.info(
                `[GlobalBridge] openAppSelection requested for ${category}. Found ${String(apps.length)} apps.`,
            );
            this._core.appUI.openAppSelection(category, apps);
        };
        win.closeAppSelection = () => {
            this._core.appUI.closeAppSelection();
        };

        win.selectApp = (category: string, app: IApp): Promise<void> => {
            this._core.appUI.updateModuleCard(category, app);
            const uiState = (win as TGlobalWin).uiState;
            if (typeof uiState.setSelectedModule === 'function') {
                uiState.setSelectedModule(category, {
                    id: app.id,
                    name: app.name ?? '',
                    nameKey: app.nameKey ?? '',
                    icon: app.icon ?? '',
                    type: app.type ?? 'local',
                    descKey: app.descKey ?? '',
                    desc: app.desc ?? '',
                });
            }
            return Promise.resolve();
        };

        // App Launching
        win.launchApp = async (id: string): Promise<void> => {
            this._core.logger.debug(`[GlobalBridge] Launching App: ${id}`);
            if (this._core.tauriProvider.isTauri()) {
                try {
                    const result = await this._core.tauriProvider.invoke<{
                        action: string;
                        provider?: string;
                    }>('launch_module', { module_id: id });

                    if (
                        result.action === 'navigate' &&
                        result.provider !== undefined &&
                        result.provider !== ''
                    ) {
                        localStorage.setItem('selected_ai_provider', result.provider);
                    } else if (result.action === 'start_local') {
                        await this._core.moduleService.control(id, 'start');
                    }
                } catch (err) {
                    this._core.logger.error('[GlobalBridge] Launch module failed:', err);
                }
            } else {
                const apiModules = ['gpt', 'gemini', 'claude', 'mistral', 'axelate-localai'];
                if (apiModules.includes(id)) {
                    localStorage.setItem('selected_ai_provider', id);
                }
            }
        };

        // Module Control and State Updates
        win.controlModule = (id: string, action: string): Promise<boolean> =>
            this._core.moduleService.control(id, action);
        win.updateState = (): void => {
            // No-op for now, or could trigger state refresh if needed
        };

        // UI Feedback and Utilities
        win.showToast = (m: string, t?: string, d?: number, title?: string | null): void => {
            this._core.appUI.showToast(m, t, d, title ?? null);
        };
        win.showActionFeedback = (t?: string): void => {
            this._core.appUI.showActionFeedback(t);
        };
        win.showSkeletonLoaders = (id: string, c?: number): void => {
            this._core.appUI.showSkeletonLoaders(id, c ?? 0);
        };
        win.hideSkeletonLoaders = (id: string, c?: number): void => {
            this._core.appUI.hideSkeletonLoaders(id, c ?? 0);
        };
        win.setButtonLoading = (b: HTMLButtonElement | null, l: boolean): void => {
            if (b) this._core.appUI.setButtonLoading(b, l);
        };
        win.showPromptTab = (tab: string, btn?: HTMLElement): void => {
            this._core.appUI.showPromptTab(tab, btn);
        };

        // Ensure getCatalogCategory is available even if CatalogService hasn't run yet
        const g = globalThis as TGlobalWin;
        if (typeof g.getCatalogCategory !== 'function') {
            g.getCatalogCategory = (cat: string) =>
                (g.APP_DATA as unknown as Record<string, IApp[]>)[cat] ?? [];
        }
    }

    /**
     * Setup the axelateAPI bridge for legacy module compatibility.
     * @sideeffect Exposes axelateAPI on globalThis
     */
    private _setupAxelateAPI(): void {
        const win = globalThis;
        win.axelateAPI = {
            minimize: async () => {
                if (this._core.tauriProvider.isTauri())
                    await this._core.tauriProvider.invoke('minimize_window');
                else this._core.logger.debug('[AxelateAPI] minimize (no Tauri)');
            },
            toggleMaximize: async () => {
                if (this._core.tauriProvider.isTauri())
                    await this._core.tauriProvider.invoke('toggle_maximize');
                else this._core.logger.debug('[AxelateAPI] toggleMaximize (no Tauri)');
            },
            close: async () => {
                if (this._core.tauriProvider.isTauri())
                    await this._core.tauriProvider.invoke('close_window');
                else this._core.logger.debug('[AxelateAPI] close (no Tauri)');
            },
            secureStorage: {
                save: async (service: string, key: string) => {
                    if (this._core.tauriProvider.isTauri()) {
                        await this._core.tauriProvider.invoke('save_secure_key', { service, key });
                    } else {
                        this._core.logger.warn(
                            `[AxelateAPI] Secure storage not available in web mode. Key not persisted for: ${service}`,
                        );
                        // Security: Do not persist keys in localStorage/sessionStorage
                    }
                },
                get: async (service: string): Promise<string | null> => {
                    if (this._core.tauriProvider.isTauri()) {
                        return await this._core.tauriProvider.invoke('get_secure_key', { service });
                    } else {
                        return null;
                    }
                },
            },
        };
    }

    private _setupFetchInterceptor(): void {
        const g = globalThis;
        const originalFetch = g.fetch;

        if (typeof originalFetch !== 'function') {
            this._core.logger.warn(
                '[GlobalBridge] fetch is not defined on globalThis, skipping interceptor',
            );
            return;
        }

        const boundFetch = originalFetch.bind(g);

        g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            try {
                let url: string;
                if (typeof input === 'string') {
                    url = input;
                } else if (input instanceof URL) {
                    url = input.toString();
                } else {
                    url = input.url;
                }

                if (!url.includes('/api/')) {
                    return await boundFetch(input, init);
                }

                if (url.includes('/api/log')) {
                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                if (url.includes('/api/chat/send') && this._core.tauriProvider.isTauri()) {
                    return await this._handleChatRequest(init);
                }

                return await boundFetch(input, init);
            } catch (err) {
                this._core.logger.error('[GlobalBridge] Fetch interceptor error:', err);
                return boundFetch(input, init);
            }
        };
    }

    /**
     * Handles intercepted chat requests by routing to Tauri.
     */
    private async _handleChatRequest(init?: RequestInit): Promise<Response> {
        try {
            const bodyStr = typeof init?.body === 'string' ? init.body : '{}';
            const body = JSON.parse(bodyStr) as Record<string, unknown>;
            const provider =
                (body['provider'] as string | undefined) ??
                localStorage.getItem('selected_ai_provider') ??
                'gpt';

            const model = (body['model'] as string | undefined) ?? this._resolveModel(provider);

            const res = await this._core.tauriProvider.invoke('send_chat_message', {
                request: {
                    provider: provider,
                    model: model,
                    messages: (body['history'] as unknown[] | undefined) ?? [],
                    api_key: null,
                },
            });
            return new Response(JSON.stringify(res));
        } catch (e) {
            this._core.logger.error('[GlobalBridge] Chat Request Error:', e);
            return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
        }
    }

    /**
     * Resolves the appropriate model for a provider.
     */
    private _resolveModel(provider: string): string {
        const savedKey = localStorage.getItem(`${provider}_selected_model`);
        const catalog = this._core.catalog.getCatalog();
        const appList = catalog.ai;
        const providerApp = appList.find((a) => a.id === provider);

        // Define shape of provider data
        interface ProviderData {
            models?: Record<
                string,
                {
                    apiModels?: { text?: string };
                    stats?: { logic?: number; creative?: number };
                }
            >;
        }

        const data = providerApp?.apiProviderData as unknown as ProviderData | undefined;
        const models = data?.models ?? {};

        // 1. Saved model
        if (savedKey !== null && savedKey !== '') return this._getApiId(savedKey, models);

        // 2. Default (most powerful)
        const sortedKeys = this._sortModelsByPower(models);
        const defaultKey = sortedKeys[0] ?? '';

        return this._getApiId(defaultKey, models);
    }

    /**
     * Returns the API ID for a model key.
     */
    private _getApiId(
        key: string,
        models: Record<string, { apiModels?: { text?: string } }>,
    ): string {
        const modelData = models[key];
        return modelData?.apiModels?.text ?? key;
    }

    /**
     * Sorts models by power level.
     */
    private _sortModelsByPower(
        models: Record<string, { stats?: { logic?: number; creative?: number } }>,
    ): string[] {
        return Object.keys(models).sort((a, b) => {
            const statsA = models[a]?.stats;
            const statsB = models[b]?.stats;
            const powerA = (statsA?.logic ?? 0) + (statsA?.creative ?? 0);
            const powerB = (statsB?.logic ?? 0) + (statsB?.creative ?? 0);
            return powerB - powerA;
        });
    }
}
