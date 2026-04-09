/**
 * @module core/boot/GlobalBridge
 * @description Exposes core functionality to the global window object.
 * Uses CoreContainer for internal access, maintains backward compat on globalThis.
 */

import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { AppUI } from '@/shared/shell/AppUI';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { WindowService } from '@/shared/services/WindowService';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { IApp } from '@/shared/types/coreTypes';
import type { IAICatalogApp } from '@/features/ai/types/aiTypes';
import { container } from './CoreContainer';
import { resolveProviderModel } from '@/features/ai/utils/catalogHelpers';
import { aiBridge } from '@/features/ai/services/AIBridge';

export interface ICoreBridge {
    readonly aiSettings: AISettingsService;
    readonly appUI: AppUI;
    readonly catalog: CatalogService;
    readonly i18n: I18nService;
    readonly i18nUI: I18nUI;
    readonly tracer: LoggerService;
    readonly moduleService: ModuleService;
    readonly navigationUI: NavigationUI;
    readonly tauriProvider: TauriProvider;
    readonly windowService: WindowService;
    readonly windowUI: WindowUI;
}

/**
 * GlobalBridge handles the exposure of core services to the global window object.
 * Uses CoreContainer for internal access, maintains backward compat on globalThis.
 */
export class GlobalBridge {
    private readonly _core: ICoreBridge;
    private _originalFetch: typeof globalThis.fetch | null = null;

    constructor(core: ICoreBridge) {
        this._core = core;
    }

    /**
     * Initialize the bridge by setting up globals and interceptors.
     */
    public init(): void {
        this._setupFetchInterceptor();
        this._setupAxelateAPI();
        this._exposeCoreGlobals();
        this._syncCatalogToGlobal();
    }

    public destroy(): void {
        if (this._originalFetch !== null) {
            globalThis.fetch = this._originalFetch;
            this._originalFetch = null;
        }

        const keys = [
            'checkModuleInstalled',
            't',
            'currentLang',
            'setLanguage',
            'applyTranslations',
            'minimizeWindow',
            'toggleMaximizeWindow',
            'hideToTray',
            'confirmClose',
            'showPage',
            'openAppSelection',
            'closeAppSelection',
            'launchApp',
            'showToast',
            'showSkeletonLoaders',
            'hideSkeletonLoaders',
            'setButtonLoading',
            'showPromptTab',
            'getCatalogCategory',
            'axelateAPI',
        ] as const;
        for (const key of keys) {
            Reflect.deleteProperty(globalThis, key);
        }
        Reflect.deleteProperty(globalThis, 'APP_DATA');
    }

    /**
     * Sync catalog data to globalThis.APP_DATA for backward compat.
     */
    private _syncCatalogToGlobal(): void {
        const catalogData = this._core.catalog.getCatalog();
        (globalThis as unknown as Record<string, unknown>)['APP_DATA'] = catalogData;

        // Expose getCatalogCategory via container
        globalThis.getCatalogCategory = (cat: string) => container.getCatalogCategory(cat);
    }

    /**
     * Expose core functions to globalThis for use by legacy JS modules and UI.
     */
    private _exposeCoreGlobals(): void {
        const win = globalThis;

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
        win.applyTranslations = (): void => {
            this._core.i18nUI.applyTranslations();
        };

        // Window Controls
        win.minimizeWindow = (): Promise<void> => this._core.windowService.minimize();
        win.toggleMaximizeWindow = (): Promise<void> => this._core.windowService.toggleMaximize();
        win.hideToTray = (): Promise<void> => this._core.windowService.hideToTray();
        win.confirmClose = (): Promise<void> => this._core.windowService.close();
        // Navigation and Selection
        win.showPage = (id: string, btn?: HTMLElement | null, isInitial?: boolean): void => {
            void this._core.navigationUI.showPage(id, btn, isInitial);
        };

        win.openAppSelection = (category: string) => {
            const cat = category.toLowerCase();
            const catalog = this._core.catalog.getCatalog();

            // Map compound keys (ai_text, ai_image) to the same AI catalog
            let apps: IApp[];
            if (cat === 'ai' || cat === 'ai_text' || cat === 'ai_image') {
                apps = catalog.ai;
            } else if (cat === 'services') {
                apps = catalog.services;
            } else {
                apps = [];
            }

            this._core.tracer.info(
                `[GlobalBridge] openAppSelection requested for ${cat}. Found ${String(apps.length)} apps.`,
            );
            this._core.appUI.openAppSelection(cat, apps);
        };
        win.closeAppSelection = () => {
            this._core.appUI.closeAppSelection();
        };

        // App Launching
        win.launchApp = async (id: string): Promise<void> => {
            this._core.tracer.debug(`[GlobalBridge] Launching App: ${id}`);

            // Only activate AI provider for apps in the AI catalog.
            // Services/bots are launched directly without an AI provider session.
            const catalog = this._core.catalog.getCatalog();
            const isAiApp = catalog.ai.some((a) => a.id === id);

            if (isAiApp) {
                await aiBridge.startProvider(id);
            }

            if (this._core.tauriProvider.isTauri()) {
                try {
                    const result = await this._core.tauriProvider.invoke<{
                        action: string;
                        provider?: string;
                    }>('launch_module', { moduleId: id });

                    if (
                        result.action === 'navigate' &&
                        result.provider !== undefined &&
                        result.provider !== ''
                    ) {
                        this._core.aiSettings.setLastActiveProvider(result.provider);
                    } else if (result.action === 'start_local') {
                        await this._core.moduleService.control(id, 'start');
                    }
                } catch (err) {
                    this._core.tracer.error('[GlobalBridge] Launch module failed:', err);
                }
            } else {
                const apiModules = ['gpt', 'gemini', 'claude', 'mistral'];
                if (apiModules.includes(id)) {
                    this._core.aiSettings.setLastActiveProvider(id);
                }
            }
        };

        // Module Control and State Updates
        // UI Feedback and Utilities
        win.showToast = (m: string, t?: string, d?: number, title?: string | null): void => {
            this._core.appUI.showToast(m, t, d, title ?? null);
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
    }

    /**
     * Setup the axelateAPI bridge for legacy module compatibility.
     */
    private _setupAxelateAPI(): void {
        const win = globalThis;
        win.axelateAPI = {
            minimize: async () => {
                if (this._core.tauriProvider.isTauri())
                    await this._core.tauriProvider.invoke('minimize_window');
                else this._core.tracer.debug('[AxelateAPI] minimize (no Tauri)');
            },
            toggleMaximize: async () => {
                if (this._core.tauriProvider.isTauri())
                    await this._core.tauriProvider.invoke('toggle_maximize');
                else this._core.tracer.debug('[AxelateAPI] toggleMaximize (no Tauri)');
            },
            close: async () => {
                if (this._core.tauriProvider.isTauri())
                    await this._core.tauriProvider.invoke('close_window');
                else this._core.tracer.debug('[AxelateAPI] close (no Tauri)');
            },
            secureStorage: {
                save: async (service: string, key: string) => {
                    if (this._core.tauriProvider.isTauri()) {
                        await this._core.tauriProvider.invoke('save_secure_key', { service, key });
                    } else {
                        this._core.tracer.warn(
                            `[AxelateAPI] Secure storage not available in web mode. Key not persisted for: ${service}`,
                        );
                        // Security: Do not persist keys in localStorage/sessionStorage
                    }
                },
            },
        };
    }

    private _setupFetchInterceptor(): void {
        const g = globalThis;
        const originalFetch = g.fetch;

        if (typeof originalFetch !== 'function') {
            this._core.tracer.warn(
                '[GlobalBridge] fetch is not defined on globalThis, skipping interceptor',
            );
            return;
        }

        this._originalFetch = originalFetch;

        const boundFetch = originalFetch.bind(g);

        g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            let url = '';
            try {
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
                if (!url.startsWith('ipc:') && !url.includes('ipc.localhost')) {
                    this._core.tracer.error('[GlobalBridge] Fetch interceptor error:', err);
                }
                throw err;
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
                this._core.aiSettings.getLastActiveProvider() ??
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
            this._core.tracer.error('[GlobalBridge] Chat Request Error:', e);
            return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
        }
    }

    /**
     * Resolves the appropriate API model ID for a provider.
     */
    private _resolveModel(provider: string): string {
        return resolveProviderModel(
            provider,
            this._core.catalog.getCatalog().ai as unknown as IAICatalogApp[],
            (p) => this._core.aiSettings.getSelectedAIModel(p),
        );
    }
}
