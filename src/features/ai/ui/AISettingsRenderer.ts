import type { IApp } from '@/shared/types/coreTypes';
import { type SettingsService } from '@/features/settings/services/SettingsService';
import { type AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IAIModelData } from '../types/aiTypes';
import { BaseComponent } from '@/shared/ui/BaseComponent';
import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { bindAISettingsInteractions } from './AISettingsInteractionBinder';
import { AISettingsViewPolicy } from './AISettingsViewPolicy';
import { AISettingsKeyController } from './AISettingsKeyController';
import { AISettingsContentRenderer } from './AISettingsContentRenderer';
import { AISettingsSelectionController } from './AISettingsSelectionController';

const ICONS = {
    VISIBLE:
        '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-eye"></use></svg>',
    HIDDEN: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-eye-off"></use></svg>',
    CHECK: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-check"></use></svg>',
    X: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-close"></use></svg>',
    SPINNER:
        '<svg class="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><use href="#icon-clock"></use></svg>',
} as const;

type TranslateFunc = (key: string, fallback: string) => string;
type ShowToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
type AISettingsRendererLogger = Pick<LoggerService, 'info' | 'debug' | 'error'>;

// IAISettingsGlobal removed as it's no longer used for strictness reasons

/**
 * @class AISettingsRenderer
 * @description Manages the lifecycle and rendering of AI-specific settings modules.
 */
class AISettingsRenderer extends BaseComponent {
    private static readonly _SHARED_API_KEY_PROVIDER = 'openrouter';
    private _settingsService: SettingsService | null = null;
    private _aiSettings: AISettingsService | null = null;
    private _tauri: TauriProvider | null = null;
    private _i18nUI: I18nUI | null = null;
    private _logger: AISettingsRendererLogger | null = null;
    private _translate: TranslateFunc = (_key, fallback) => fallback;
    private _showToastCallback: ShowToast = () => undefined;
    private _renderAbortController: AbortController | null = null;
    private readonly _buttonResetTimers = new Map<
        HTMLButtonElement,
        ReturnType<typeof setTimeout>
    >();
    private readonly _contentRenderer = new AISettingsContentRenderer();
    private readonly _viewPolicy = new AISettingsViewPolicy();
    private readonly _selectionController = new AISettingsSelectionController();
    private readonly _keyController = new AISettingsKeyController({
        getSettingsService: () => this._settingsService,
        getTranslator: () => this._getTranslator(),
        scheduleButtonReset: (button, callback) => this._scheduleButtonReset(button, callback),
        showToast: (message, type) => {
            this._showToast(message, type);
        },
        tracer: {
            error: (message, error) => {
                this._logger?.error(message, error);
            },
        },
        icons: {
            visible: ICONS.VISIBLE,
            hidden: ICONS.HIDDEN,
            check: ICONS.CHECK,
            x: ICONS.X,
            spinner: ICONS.SPINNER,
        },
    });

    constructor() {
        super();
    }

    /**
     * Idempotent initialization of the service.
     *
     * @param settingsService - Global settings infrastructure service
     * @param stateService - UI state persistence service
     * @param tauri - Tauri provider for IPC
     */
    public override init(
        settingsService: SettingsService,
        aiSettings: AISettingsService,
        tauri: TauriProvider,
        i18nUI: I18nUI,
        translate: TranslateFunc,
        tracer: AISettingsRendererLogger,
        showToast: ShowToast,
    ): Promise<void> {
        this._settingsService = settingsService;
        this._aiSettings = aiSettings;
        this._tauri = tauri;
        this._i18nUI = i18nUI;
        this._translate = translate;
        this._logger = tracer;
        this._showToastCallback = showToast;
        return super.init();
    }

    protected onInit(): void | Promise<void> {
        this._logger?.debug('[AISettingsRenderer] Initialized');
    }

    protected onDestroy(): void {
        this._settingsService = null;
        this._aiSettings = null;
        this._tauri = null;
        this._i18nUI = null;
        this._logger = null;
        this._translate = (_key, fallback) => fallback;
        this._showToastCallback = () => undefined;
        this._selectionController.reset();
        this._cleanupRenderScope();
    }

    /**
     * Renders unified API and model settings for any AI provider.
     *
     * @param container - Target DOM element for ingestion
     * @param app - Catalog application record
     * @sideeffect Modifies the DOM by injecting sanitized HTML
     */
    public async render(container: HTMLElement, app: IApp): Promise<void> {
        if (!this._isInit) {
            this._logger?.error('[AISettingsRenderer] Not initialized. Call init() first.');
            return;
        }

        this._cleanupRenderScope();

        const appId = app.id;
        const providerData = app.apiProviderData ?? {};
        const models = (providerData['models'] as IAIModelData[] | undefined) ?? [];

        const firstModel = models.length > 0 ? models[0] : undefined;
        const defaultModelId = firstModel ? firstModel.id : '';
        const savedModel = this._selectionController.getSavedModel(
            appId,
            this._aiSettings,
            defaultModelId,
        );
        const t = this._getTranslator();

        this._selectionController.registerRender({ appId, container, models });
        this._contentRenderer.render(container, {
            app,
            appId,
            models,
            savedModel,
            translate: t,
            viewPolicy: this._viewPolicy,
            supportsInternetAccess: this._viewPolicy.supportsInternetAccess(appId),
            supportsThinking: this._viewPolicy.supportsThinking(appId),
            thinkingLevel: this._selectionController.getThinkingLevel(appId, this._aiSettings),
            internetAccessEnabled: this._selectionController.getInternetAccessEnabled(
                appId,
                this._aiSettings,
            ),
            renderModelStats: (targetAppId, modelKey) =>
                this.renderModelStats(targetAppId, modelKey),
        });
        const toggleButton = container.querySelector<HTMLButtonElement>(`#${appId}-key-toggle-btn`);
        if (toggleButton !== null) {
            toggleButton.innerHTML = ICONS.HIDDEN;
        }
        await this._bindEvents(container, appId);
    }

    /**
     * Renders comparative model statistics with star heuristics.
     *
     * @param appId - AI Provider ID
     * @param modelKey - Unique model identifier
     */
    public renderModelStats(appId: string, modelKey: string): string {
        return this._selectionController.renderModelStats(appId, modelKey, this._getTranslator());
    }

    /**
     * Binds interactive event handlers with cleanup tracking.
     *
     * @param container - UI Container
     * @param appId - Provider ID
     * @sideeffect Attaches DOM event listeners and subscribes to settings service
     */
    private async _bindEvents(container: HTMLElement, appId: string): Promise<void> {
        if (!this._settingsService) return;

        this._renderAbortController = new AbortController();
        const renderSignal = this._renderAbortController.signal;
        const keyProviderId = this._getKeyProviderId(appId);

        const input = container.querySelector(`#${appId}-api-key-input`) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | null;

        if (input !== null) {
            await this._keyController.hydrateStoredMask(input, keyProviderId);
        }
        bindAISettingsInteractions({
            appId,
            container,
            signal: renderSignal,
            normalizeKeyInput: (event) => {
                this._keyController.normalizeInput(event);
            },
            maybeClearStoredMask: (event) => {
                this._keyController.maybeClearStoredMask(event);
            },
            openKeyProviderUrl: () => {
                if (this._tauri) {
                    void this._tauri.openUrl(this._getKeyProviderUrl(keyProviderId));
                }
            },
            toggleKeyVisibility: async () => this.toggleKeyVisibility(appId),
            checkKey: async () => this.checkKey(appId),
            selectModel: (modelKey) => this.selectModel(appId, modelKey),
            setThinkingLevel: (level: ThinkingLevel) => {
                this._aiSettings?.setThinkingLevel(appId, level);
            },
            getSelectedModel: () => this._aiSettings?.getSelectedAIModel(appId) ?? '',
            setInternetAccessEnabled: (enabled) => {
                this._aiSettings?.setInternetAccessEnabled(appId, enabled);
            },
        });

        this._i18nUI?.applyTranslations(container);
    }

    /**
     * Toggles API key field visibility.
     *
     * @param appId - Unique provider identifier
     * @sideeffect Modifies input type and innerHTML
     */
    public async toggleKeyVisibility(appId: string): Promise<void> {
        const input = this._queryActiveElement<HTMLInputElement | HTMLTextAreaElement>(
            `#${appId}-api-key-input`,
        );
        const btn = this._queryActiveElement<HTMLButtonElement>(`#${appId}-key-toggle-btn`);
        await this._keyController.toggleVisibility(input, btn, this._getKeyProviderId(appId));
    }

    /**
     * Evaluates API key validity against provider infrastructure.
     *
     * @param appId - AI Provider ID
     * @sideeffect Updates button DOM state and displays toast notifications
     */
    public async checkKey(appId: string): Promise<void> {
        const input = this._queryActiveElement<HTMLInputElement | HTMLTextAreaElement>(
            `#${appId}-api-key-input`,
        );
        const btn = this._queryActiveElement<HTMLButtonElement>(`#${appId}-key-check-btn`);
        await this._keyController.checkKey(input, btn, this._getKeyProviderId(appId));
    }

    /**
     * Resolves and persists model selection transitions.
     *
     * @param appId - Provider ID
     * @param modelKey - Selected model ID
     * @sideeffect Updates local storage and refreshes stats DOM segments
     */
    public selectModel(appId: string, modelKey: string): void {
        this._selectionController.syncSelection({
            appId,
            modelKey,
            aiSettings: this._aiSettings,
            translate: this._getTranslator(),
            i18nUI: this._i18nUI,
            contentRenderer: this._contentRenderer,
        });
    }

    /**
     * Resets internal state and deactivates observers.
     * MANDATORY cleanup method required by Section 4.3.
     */
    public override destroy(): void {
        super.destroy();
    }

    /**
     * Resolves the translation service from the global context.
     */
    private _getTranslator(): TranslateFunc {
        return this._translate;
    }

    private _showToast(message: string, type: 'success' | 'error' | 'warning' | 'info'): void {
        this._showToastCallback(message, type);
    }

    private _getKeyProviderId(_appId: string): string {
        return AISettingsRenderer._SHARED_API_KEY_PROVIDER;
    }

    private _getKeyProviderUrl(providerId: string): string {
        if (providerId === AISettingsRenderer._SHARED_API_KEY_PROVIDER) {
            return 'https://openrouter.ai/settings/keys';
        }

        return '#';
    }

    private _queryActiveElement<T extends Element>(selector: string): T | null {
        return this._selectionController.queryActiveElement<T>(selector);
    }

    private _scheduleButtonReset(btn: HTMLButtonElement, callback: () => void): void {
        const existingTimer = this._buttonResetTimers.get(btn);
        if (existingTimer !== undefined) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
            this._buttonResetTimers.delete(btn);
            callback();
        }, 3000);

        this._buttonResetTimers.set(btn, timer);
    }

    private _cleanupRenderScope(): void {
        if (this._renderAbortController !== null) {
            this._renderAbortController.abort();
            this._renderAbortController = null;
        }

        for (const timer of this._buttonResetTimers.values()) {
            clearTimeout(timer);
        }
        this._buttonResetTimers.clear();
    }
}

// Singleton instantiation
export const aiSettingsRenderer = new AISettingsRenderer();
