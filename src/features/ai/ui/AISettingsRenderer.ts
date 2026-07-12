import type { IApp } from '@/shared/types/coreTypes';
import {
    type ICustomModel,
    type SettingsService,
} from '@/features/settings/services/SettingsService';
import { type AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IAIModelData } from '../types/aiTypes';
import type { CatalogProviderPolicy } from '@/shared/types/bindings';
import { BaseComponent } from '@/shared/ui/BaseComponent';
import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { isCustomProviderId } from '@/shared/utils/customProviderSupport';
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
type AISettingsActiveRenderTarget = {
    container: HTMLElement;
    app: IApp;
};
type KeyInput = HTMLInputElement | HTMLTextAreaElement;

function isKeyInput(value: EventTarget | null): value is KeyInput {
    return value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement;
}

// IAISettingsGlobal removed as it's no longer used for strictness reasons

/**
 * @class AISettingsRenderer
 * @description Manages the lifecycle and rendering of AI-specific settings modules.
 */
class AISettingsRenderer extends BaseComponent {
    private _settingsService: SettingsService | null = null;
    private _aiSettings: AISettingsService | null = null;
    private _tauri: TauriProvider | null = null;
    private _i18nUI: I18nUI | null = null;
    private _logger: AISettingsRendererLogger | null = null;
    private _translate: TranslateFunc = (_key, fallback) => fallback;
    private _showToastCallback: ShowToast = () => undefined;
    private _renderAbortController: AbortController | null = null;
    private _activeRenderTarget: AISettingsActiveRenderTarget | null = null;
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
        this._activeRenderTarget = null;
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
        this._activeRenderTarget = { container, app };

        const appId = app.id;
        const models = await this._getProviderModels(app);
        const providerPolicy = this._resolveProviderPolicy(app);

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
            apiBaseUrl: this._getApiBaseUrl(app),
            showApiEndpointSelector: providerPolicy.showApiEndpointSelector,
            usesCustomProviderKey: providerPolicy.usesCustomProviderKey,
            showModelStats: this._viewPolicy.shouldShowModelStats({
                ...app,
                providerPolicy,
            }),
            showCustomModelComposer: providerPolicy.showCustomModelComposer,
            translate: t,
            viewPolicy: this._viewPolicy,
            supportsInternetAccess: providerPolicy.supportsInternetAccess,
            supportsThinking: providerPolicy.supportsThinking,
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
        return this._selectionController.renderModelStats(
            appId,
            modelKey,
            this._getTranslator(),
            this._viewPolicy,
        );
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
        const secretService = this._getSecretService(appId);

        const input = container.querySelector(`#${appId}-api-key-input`) as
            HTMLInputElement | HTMLTextAreaElement | null;

        if (input !== null && secretService !== null) {
            await this._keyController.hydrateStoredMask(input, secretService);
        }
        bindAISettingsInteractions({
            appId,
            container,
            signal: renderSignal,
            normalizeKeyInput: (event) => {
                const target = event.target;
                if (!isKeyInput(target)) {
                    return;
                }

                const hadStoredKey =
                    target.dataset['storedMasked'] === 'true' ||
                    target.dataset['storedRevealed'] === 'true';
                this._keyController.normalizeInput(event);
                if (hadStoredKey) {
                    void this._removeClearedStoredKey(target, secretService, appId);
                }
            },
            maybeClearStoredMask: (event) => {
                this._keyController.maybeClearStoredMask(event);
            },
            openKeyProviderUrl: () => {
                if (this._tauri) {
                    const url = this._getKeyProviderUrl(appId);
                    if (url !== null) {
                        void this._tauri.openUrl(url);
                    }
                }
            },
            toggleKeyVisibility: async () => this.toggleKeyVisibility(appId),
            checkKey: async () => this.checkKey(appId),
            selectModel: (modelKey) => this.selectModel(appId, modelKey),
            submitCustomModel: async () => this._submitCustomModel(appId),
            removeCustomModel: async (modelKey) => this._removeCustomModel(appId, modelKey),
            setApiBaseUrl: (baseUrl) => this._setApiBaseUrl(appId, baseUrl),
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
        const secretService = this._getSecretService(appId);
        if (secretService === null) {
            return;
        }
        await this._keyController.toggleVisibility(input, btn, secretService);
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
        const secretService = this._getSecretService(appId);
        if (secretService === null) {
            return;
        }
        await this._keyController.checkKey(
            input,
            btn,
            secretService,
            this._getValidationProviderId(appId),
            this._getValidationBaseUrl(appId),
        );
    }

    private async _removeClearedStoredKey(
        input: KeyInput,
        secretService: string | null,
        appId: string,
    ): Promise<void> {
        if (secretService === null) {
            return;
        }

        const removed = await this._keyController.removeClearedStoredKey(input, secretService);
        if (removed && input.value.trim() === '') {
            this._resetKeyCheckButton(appId);
        }
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
            viewPolicy: this._viewPolicy,
            app: this._activeRenderTarget?.app ?? { id: appId },
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

    private async _getProviderModels(app: IApp): Promise<IAIModelData[]> {
        const providerData = app.apiProviderData ?? {};
        const builtInModels = (providerData['models'] as IAIModelData[] | undefined) ?? [];

        if (!isCustomProviderId(app.id) || this._settingsService === null) {
            return builtInModels;
        }

        const customModels = await this._settingsService.getCustomModels();
        const providerCustomModels = customModels.filter((model) => model.provider_id === app.id);

        return this._mergeCustomModels(builtInModels, providerCustomModels);
    }

    private _mergeCustomModels(
        builtInModels: IAIModelData[],
        customModels: ICustomModel[],
    ): IAIModelData[] {
        const existingIds = new Set(builtInModels.map((model) => model.id));
        const translate = this._getTranslator();
        const mappedCustomModels: IAIModelData[] = customModels
            .filter((model) => !existingIds.has(model.id))
            .map((model) => ({
                id: model.id,
                name: model.name.trim() !== '' ? model.name : model.id,
                desc: translate('ui.settings.custom_model_desc', ''),
                isCustom: true,
            }));

        return [...builtInModels, ...mappedCustomModels];
    }

    private async _submitCustomModel(appId: string): Promise<void> {
        if (this._settingsService === null) {
            return;
        }

        const modelIdInput = this._queryActiveElement<HTMLInputElement>(
            `#${appId}-custom-model-id-input`,
        );
        const modelId = modelIdInput?.value.trim() ?? '';
        const translate = this._getTranslator();

        if (modelId === '' || /\s/u.test(modelId)) {
            this._showToast(
                translate(
                    'ui.settings.custom_model_invalid',
                    'Enter a valid model ID without spaces',
                ),
                'warning',
            );
            modelIdInput?.focus();
            return;
        }

        try {
            await this._settingsService.addCustomModel(
                appId,
                modelId,
                this._deriveCustomModelName(modelId),
            );
            this._aiSettings?.setSelectedAIModel(appId, modelId);
            if (modelIdInput !== null) {
                modelIdInput.value = '';
            }
            this._showToast(
                translate('ui.settings.custom_model_added', 'Custom model added'),
                'success',
            );
            await this._rerenderActiveApp();
        } catch (error) {
            this._logger?.error('[AISettingsRenderer] Failed to add custom model', error);
            this._showToast(
                translate('ui.settings.custom_model_add_failed', 'Failed to add custom model'),
                'error',
            );
        }
    }

    private async _removeCustomModel(appId: string, modelId: string): Promise<void> {
        if (this._settingsService === null) {
            return;
        }

        const translate = this._getTranslator();

        try {
            await this._settingsService.removeCustomModel(modelId);

            const nextModels = await this._getProviderModels(
                this._activeRenderTarget?.app ?? { id: appId, apiProviderData: { models: [] } },
            );
            const fallbackModelId = nextModels.find((model) => model.id !== modelId)?.id ?? '';
            if ((this._aiSettings?.getSelectedAIModel(appId) ?? '') === modelId) {
                this._aiSettings?.setSelectedAIModel(appId, fallbackModelId);
            }

            this._showToast(
                translate('ui.settings.custom_model_removed', 'Custom model removed'),
                'success',
            );
            await this._rerenderActiveApp();
        } catch (error) {
            this._logger?.error('[AISettingsRenderer] Failed to remove custom model', error);
            this._showToast(
                translate(
                    'ui.settings.custom_model_remove_failed',
                    'Failed to remove custom model',
                ),
                'error',
            );
        }
    }

    private _deriveCustomModelName(modelId: string): string {
        const rawName = modelId.split('/').at(-1) ?? modelId;
        const parts = rawName
            .split(/[-_]+/u)
            .filter((part) => part !== '')
            .map((part) => {
                if (/^[a-z]{1,3}\d*(\.\d+)?$/iu.test(part)) {
                    return part.toUpperCase();
                }

                return part.charAt(0).toUpperCase() + part.slice(1);
            });

        const firstPart = parts[0];
        const secondPart = parts[1];
        if (
            firstPart !== undefined &&
            secondPart !== undefined &&
            /^[A-Z]{2,6}$/u.test(firstPart) &&
            /^\d/u.test(secondPart)
        ) {
            return [`${firstPart}-${secondPart}`, ...parts.slice(2)].join(' ');
        }

        return parts.join(' ');
    }

    private _getApiBaseUrl(app: IApp): string {
        const providerBaseUrl =
            typeof app.apiProviderData?.['baseUrl'] === 'string'
                ? app.apiProviderData['baseUrl']
                : 'https://openrouter.ai/api/v1';
        return this._aiSettings?.getApiBaseUrl(app.id, providerBaseUrl) ?? providerBaseUrl;
    }

    private _setApiBaseUrl(appId: string, baseUrl: string): void {
        const saved = this._aiSettings?.setApiBaseUrl(appId, baseUrl) ?? false;
        const translate = this._getTranslator();
        if (saved) {
            this._showToast(
                translate('ui.settings.api_endpoint_saved', 'API endpoint saved'),
                'success',
            );
            return;
        }

        this._showToast(
            translate('ui.settings.api_endpoint_invalid', 'Use an HTTPS OpenAI-compatible URL'),
            'warning',
        );
    }

    private _getValidationBaseUrl(appId: string): string | undefined {
        if (this._getActiveProviderPolicy(appId)?.showApiEndpointSelector !== true) {
            return undefined;
        }

        return this._aiSettings?.getApiBaseUrl(appId);
    }

    private async _rerenderActiveApp(): Promise<void> {
        if (this._activeRenderTarget === null) {
            return;
        }

        await this.render(this._activeRenderTarget.container, this._activeRenderTarget.app);
    }

    private _getSecretService(appId: string): string | null {
        return this._getActiveProviderPolicy(appId)?.secretService ?? null;
    }

    private _getValidationProviderId(appId: string): string {
        return this._getActiveProviderPolicy(appId)?.keyProviderId ?? appId;
    }

    private _getKeyProviderUrl(appId: string): string | null {
        const rawUrl = this._getActiveProviderPolicy(appId)?.keyProviderUrl;
        if (typeof rawUrl !== 'string') {
            return null;
        }

        try {
            const url = new URL(rawUrl.trim());
            return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
        } catch {
            return null;
        }
    }

    private _getActiveProviderPolicy(appId: string): IApp['providerPolicy'] | null {
        const app = this._activeRenderTarget?.app;
        if (app?.id !== appId) {
            return null;
        }

        return this._resolveProviderPolicy(app);
    }

    private _resolveProviderPolicy(app: IApp): CatalogProviderPolicy {
        if (app.providerPolicy !== null && app.providerPolicy !== undefined) {
            return app.providerPolicy;
        }

        return {
            isCloudProvider: false,
            isCustomProvider: false,
            isCleanApp: this._viewPolicy.isCleanApp(app.id),
            secretService: null,
            keyProviderId: null,
            keyProviderUrl: null,
            usesCustomProviderKey: false,
            showApiEndpointSelector: false,
            showCustomModelComposer: false,
            showModelStats: true,
            supportsInternetAccess: false,
            supportsThinking: false,
            imageOnly: app.capability === 'image',
        };
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

    private _resetKeyCheckButton(appId: string): void {
        const button = this._queryActiveElement<HTMLButtonElement>(`#${appId}-key-check-btn`);
        if (button === null) {
            return;
        }

        const existingTimer = this._buttonResetTimers.get(button);
        if (existingTimer !== undefined) {
            clearTimeout(existingTimer);
            this._buttonResetTimers.delete(button);
        }

        this._keyController.resetButtonState(
            button,
            this._getTranslator()('ui.gpt.key_check_btn', 'Check'),
        );
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
