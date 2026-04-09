/**
 * @module ai/ui/AISettingsRenderer
 * @description Handles rendering of AI provider settings UI with secure DOM patterns.
 * Implements interactive model selection and API key management.
 */

import DOMPurify from 'dompurify';

import type { IApp } from '@/shared/types/coreTypes';
import { type SettingsService } from '@/features/settings/services/SettingsService';
import { type AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';
import type { IAIModelData } from '../types/aiTypes';
import { getModelData } from '../utils/catalogHelpers';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { BaseComponent } from '@/shared/ui/BaseComponent';
import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';

const ICONS = {
    VISIBLE:
        '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-eye"></use></svg>',
    HIDDEN: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-eye-off"></use></svg>',
    CHECK: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-check"></use></svg>',
    X: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><use href="#icon-close"></use></svg>',
    SPINNER:
        '<svg class="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><use href="#icon-clock"></use></svg>',
} as const;

const PURIFY_CONFIG = {
    USE_PROFILES: { html: true, svg: true },
    ADD_TAGS: ['svg', 'path', 'circle', 'polyline', 'line', 'g', 'use'],
    ADD_ATTR: [
        'viewBox',
        'd',
        'fill',
        'stroke',
        'stroke-width',
        'cx',
        'cy',
        'r',
        'stroke-linecap',
        'stroke-linejoin',
        'points',
        'x1',
        'y1',
        'x2',
        'y2',
        'width',
        'height',
        'style',
        'class',
        'href',
    ],
};
// Types
// ============================================================================

type TranslateFunc = (key: string, fallback: string) => string;

interface IAIModelPricing {
    input_per_1m?: number;
    output_per_1m?: number;
    currency?: string;
    tier?: string;
    note?: string;
    in?: number;
    out?: number;
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
    private _checkTimeout: ReturnType<typeof setTimeout> | null = null;
    private _activeContainer: HTMLElement | null = null;
    private _renderAbortController: AbortController | null = null;

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
    ): Promise<void> {
        this._settingsService = settingsService;
        this._aiSettings = aiSettings;
        this._tauri = tauri;
        return super.init();
    }

    protected onInit(): void | Promise<void> {
        tracer.debug('[AISettingsRenderer] Initialized');
    }

    protected onDestroy(): void {
        this._settingsService = null;
        this._aiSettings = null;
        this._tauri = null;
        this._activeContainer = null;
        this._cleanupRenderScope();

        if (this._checkTimeout !== null) {
            clearTimeout(this._checkTimeout);
            this._checkTimeout = null;
        }
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
            tracer.error('[AISettingsRenderer] Not initialized. Call init() first.');
            return;
        }

        this._cleanupRenderScope();

        const appId = app.id;
        const providerData = app.apiProviderData ?? {};
        const models = (providerData['models'] as IAIModelData[] | undefined) ?? [];

        const firstModel = models.length > 0 ? models[0] : undefined;
        const defaultModelId = firstModel ? firstModel.id : '';
        const savedModel = this._aiSettings?.getSelectedAIModel(appId) ?? defaultModelId;
        const t = this._getTranslator();

        const isCleanApp =
            ['axelate', 'axelate-platform'].includes(appId) || appId.includes('telegram');

        this._activeContainer = container;
        const rawHtml = isCleanApp
            ? `
            <div class="ai-module-config universal-api-theme" data-provider-id="${appId}">
                <div class="ai-content-panel">
                    <div class="settings-card-header-center">
                        <h3 id="${appId}-title">${app.name ?? 'Module'} Settings</h3>
                         <div class="model-desc" data-i18n="ui.settings.no_settings">No additional settings required for this module.</div>
                    </div>
                </div>
            </div>`
            : `
            <div class="ai-module-config universal-api-theme" data-provider-id="${appId}">
                <!-- Unified API & Models Settings -->
                <div class="ai-settings-content">
                    <!-- 1. API KEY SECTION (CLEAN) -->
                    <section class="ai-key-section centered" aria-labelledby="${appId}-api-title">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3 id="${appId}-api-title">🔑 
                                    <a href="#" id="${appId}-api-link" class="api-key-link" style="text-decoration: none; cursor: pointer; color: inherit;" title="Manage your OpenRouter API Keys">
                                        <span data-i18n="ui.settings.api_key_label">${t('ui.settings.api_key_label', 'OpenRouter API Key')}</span>
                                    </a>
                                </h3>
                            </div>
                            <div class="ai-key-input-row">
                                <input id="${appId}-api-key-input" class="ai-key-editor is-masked" type="text" placeholder="${t('ui.settings.enter_key_placeholder', 'Enter your API key here')}" data-i18n-placeholder="ui.settings.enter_key_placeholder" spellcheck="false" autocomplete="off" />
                                <button id="${appId}-key-toggle-btn" class="ai-icon-btn" aria-label="Toggle password visibility" data-i18n-aria-label="ui.settings.toggle_visibility">${ICONS.HIDDEN}</button>
                                <button id="${appId}-key-check-btn" class="ai-check-btn" data-i18n="ui.gpt.key_check_btn">${t('ui.gpt.key_check_btn', 'Check')}</button>
                            </div>
                            <div class="encryption-note">🔒 <span data-i18n="ui.settings.keys_encrypted">${t('ui.settings.keys_encrypted', 'Shared OpenRouter key is securely encrypted locally.')}</span></div>
                        </div>
                    </section>

                    <!-- 2. MODELS SECTION (WINDOW) -->
                    <section class="ai-models-section" aria-labelledby="${appId}-models-title">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3 id="${appId}-models-title">🤖 <span data-i18n="ui.settings.select_model">${t('ui.settings.select_model', 'Select Model')}</span></h3>
                            </div>
                            <div class="ai-models-grid" role="listbox" aria-label="Available Models">
                                ${models.map((model) => this._renderModelCard(model.id, model, savedModel === model.id, t)).join('')}
                            </div>
                        </div>
                    </section>

                    ${this._renderThinkingSection(appId, savedModel, models, t)}

                    <!-- 4. STATS SECTION (CLEAN) -->
                    <section id="${appId}-model-stats" class="ai-stats-section" aria-live="polite">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3>📊 <span data-i18n="ui.settings.model_stats">${t('ui.settings.model_stats', 'Model Stats')}</span></h3>
                            </div>
                            ${this.renderModelStats(appId, savedModel)}
                        </div>
                    </section>
                </div>
            </div>
        `;

        container.innerHTML = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
        await this._bindEvents(container, appId);
    }

    /**
     * Renders the thinking level section, or empty string if not applicable.
     */
    private _renderThinkingSection(
        appId: string,
        savedModel: string,
        models: IAIModelData[],
        t: TranslateFunc,
    ): string {
        const supportsThinking =
            appId === 'gemini' || appId === 'claude' || appId === 'gpt' || appId === 'deepseek';
        if (!supportsThinking) return '';

        const savedLevel = this._aiSettings?.getThinkingLevel(appId);
        const isOff = savedLevel === 'off';
        const isLow = savedLevel === 'low';
        const isMedium = savedLevel === 'medium';
        const isHigh = savedLevel === 'high';

        const selectedModelData = models.find((m) => m.id === savedModel);
        const hasReasoning = selectedModelData?.capabilities?.reasoning === true;

        return `
            <!-- 3. THINKING LEVEL SECTION (WINDOW) -->
            <section id="${appId}-thinking-section" class="thinking-level-section" aria-labelledby="${appId}-thinking-title" style="display: ${hasReasoning ? 'block' : 'none'};">
                <div class="ai-content-panel">
                    <div class="settings-card-header-center">
                        <h3 id="${appId}-thinking-title" class="thinking-level-title">🧠 <span data-i18n="ui.settings.gemini.thinking">${t('ui.settings.gemini.thinking', 'Thinking Level')}</span></h3>
                    </div>
                    <div id="${appId}-thinking-grid" class="thinking-grid four-col" role="radiogroup" aria-label="Thinking Level">
                        <div class="thinking-option-card ${isOff ? 'selected' : ''}"
                            role="radio"
                            aria-checked="${String(isOff)}"
                            tabindex="0"
                            data-value="off">
                            <div class="thinking-option-title" data-i18n="ui.settings.thinking.off">${t('ui.settings.thinking.off', 'Off')}</div>
                        </div>
                        <div class="thinking-option-card ${isLow ? 'selected' : ''}"
                            role="radio"
                            aria-checked="${String(isLow)}"
                            tabindex="0"
                            data-value="low">
                            <div class="thinking-option-title" data-i18n="ui.settings.thinking.low">${t('ui.settings.thinking.low', 'Low')}</div>
                        </div>
                        <div class="thinking-option-card ${isMedium ? 'selected' : ''}"
                            role="radio"
                            aria-checked="${String(isMedium)}"
                            tabindex="0"
                            data-value="medium">
                            <div class="thinking-option-title" data-i18n="ui.settings.thinking.medium">${t('ui.settings.thinking.medium', 'Medium')}</div>
                        </div>
                        <div class="thinking-option-card ${isHigh ? 'selected' : ''}"
                            role="radio"
                            aria-checked="${String(isHigh)}"
                            tabindex="0"
                            data-value="high">
                            <div class="thinking-option-title" data-i18n="ui.settings.thinking.high">${t('ui.settings.thinking.high', 'High')}</div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * Renders a discrete model selection card.
     */
    private _renderModelCard(
        key: string,
        model: IAIModelData,
        isSelected: boolean,
        t: TranslateFunc,
    ): string {
        const pricingHtml = this._renderPricing(model.pricing);
        const contextHtml = this._renderContextWindow(model.contextWindow);

        return `
            <div class="ai-model-card ${isSelected ? 'selected' : ''}" 
                role="option" 
                aria-selected="${String(isSelected)}" 
                tabindex="0"
                data-model-key="${key}">
                <div class="model-name">${DOMPurify.sanitize(model.name, PURIFY_CONFIG)}</div>
                <div class="model-desc" data-i18n="${model.descKey ?? ''}">${DOMPurify.sanitize(t(model.descKey ?? '', model.desc), PURIFY_CONFIG)}</div>
                <div class="model-pricing">${pricingHtml}${contextHtml}</div>
            </div>
        `;
    }

    /**
     * Renders pricing information safely.
     * Delegates to specific handlers based on data structure.
     */
    private _renderPricing(pricing: unknown): string {
        if (pricing === null || pricing === undefined) return '';

        if (Array.isArray(pricing)) {
            return this._renderLegacyPricing(pricing as IAIModelPricing[]);
        }

        if (typeof pricing === 'object') {
            return this._renderNewPricing(pricing as IAIModelPricing);
        }

        return '';
    }

    private _renderContextWindow(contextWindow: number | null | undefined): string {
        if (
            contextWindow === null ||
            contextWindow === undefined ||
            !Number.isFinite(contextWindow)
        ) {
            return '';
        }

        return `
            <div class="price-row context-row">
                <span class="price-tag context-tag">Ctx: ${DOMPurify.sanitize(this._formatCompactContext(contextWindow), PURIFY_CONFIG)}</span>
            </div>
        `;
    }

    private _formatCompactContext(contextWindow: number): string {
        if (contextWindow >= 1_000_000) {
            const millions = contextWindow / 1_000_000;
            return `${millions
                .toFixed(millions >= 10 ? 0 : 2)
                .replace(/\.00$/, '')
                .replace(/(\.\d)0$/, '$1')}M`;
        }

        if (contextWindow >= 1_000) {
            const thousands = contextWindow / 1_000;
            return `${thousands.toFixed(thousands >= 100 ? 0 : 1).replace(/\.0$/, '')}K`;
        }

        return String(contextWindow);
    }

    /**
     * Renders legacy array-based pricing.
     */
    private _renderLegacyPricing(pricing: IAIModelPricing[]): string {
        return pricing
            .map(
                (price) => `
            <div class="price-row">
                <span>${price.tier ?? ''}</span>
                <span>${price.note ?? `${String(price.in ?? 0)} / ${String(price.out ?? 0)}`}</span>
            </div>
        `,
            )
            .join('');
    }

    /**
     * Renders new object-based pricing structure (IAIModelPricing).
     */
    private _renderNewPricing(pricing: IAIModelPricing): string {
        let html = '';
        const currency = pricing.currency ?? '$';
        const displayCurrency = currency === 'USD' ? '$' : currency;
        const separator = displayCurrency.length > 1 ? ' ' : '';

        const inputCost = pricing.input_per_1m ?? 0;
        const outputCost = pricing.output_per_1m ?? 0;
        const isFree = inputCost === 0 && outputCost === 0;

        if (isFree) {
            html += `
                <div class="price-row">
                    <span class="price-tag free">Free</span>
                </div>
            `;
        } else {
            const inPrice =
                pricing.input_per_1m === undefined
                    ? null
                    : `${displayCurrency}${separator}${String(pricing.input_per_1m)}`;

            const outPrice =
                pricing.output_per_1m === undefined
                    ? null
                    : `${displayCurrency}${separator}${String(pricing.output_per_1m)}`;

            if (inPrice !== null && outPrice !== null) {
                html += `
                <div class="price-row">
                    <span class="price-tag">In: ${inPrice}</span>
                    <span class="price-tag">Out: ${outPrice}</span>
                </div>
            `;
            }
        }

        // Removed notes/description as per user request
        return html;
    }

    /**
     * Renders comparative model statistics with star heuristics.
     *
     * @param appId - AI Provider ID
     * @param modelKey - Unique model identifier
     */
    public renderModelStats(appId: string, modelKey: string): string {
        const t = this._getTranslator();
        const modelData = getModelData(appId, modelKey);
        const stats = modelData?.stats;

        if (stats) {
            return `
                <div class="ai-stats-grid">
                    <div class="stat-item">
                        <div class="stat-header">
                            <span class="stat-icon-wrapper">⚡</span>
                            <div class="stat-label" data-i18n="ui.gpt.stats.speed">${t('ui.gpt.stats.speed', 'Speed')}</div>
                        </div>
                        <div class="stat-stars">${this._renderStars(stats.speed)}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-header">
                            <span class="stat-icon-wrapper">🧠</span>
                            <div class="stat-label" data-i18n="ui.gpt.stats.logic">${t('ui.gpt.stats.logic', 'Logic')}</div>
                        </div>
                        <div class="stat-stars">${this._renderStars(stats.logic)}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-header">
                            <span class="stat-icon-wrapper">🎨</span>
                            <div class="stat-label" data-i18n="ui.gpt.stats.creative">${t('ui.gpt.stats.creative', 'Creative')}</div>
                        </div>
                        <div class="stat-stars">${this._renderStars(stats.creative)}</div>
                    </div>
                </div>
            `;
        }

        return `<div class="model-desc">${t('ui.settings.stats_unavailable', 'Stats unavailable')}</div>`;
    }

    /**
     * Renders an aggregate star rating visual.
     */
    private _renderStars(count: number): string {
        let starsHtml = '';
        const maxStars = 5;

        for (let i = 0; i < maxStars; i++) {
            const thresholdFull = (i + 1) * 2;
            const thresholdHalf = i * 2 + 1;

            let className = 'star-icon';

            if (count >= thresholdFull) {
                className += ' full';
            } else if (count >= thresholdHalf) {
                className += ' half';
            } else {
                className += ' empty';
            }

            starsHtml += `<span class="${className}">★</span>`;
        }
        return starsHtml;
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

        const input = container.querySelector(`#${appId}-api-key-input`) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | null;

        if (input !== null) {
            const meta = await this._settingsService.getSecureKeyMeta('openrouter');
            if (meta.exists) {
                this._applyStoredKeyMask(input, meta.length);
            }
        }

        const addListener = (element: Element | null, type: string, fn: EventListener): void => {
            if (element !== null) {
                element.addEventListener(type, fn, { signal: renderSignal });
            }
        };

        addListener(input, 'input', (event) => {
            const target = event.target as HTMLInputElement | HTMLTextAreaElement;
            const normalizedValue = target.value.replace(/[\r\n]+/g, '');
            if (normalizedValue !== target.value) {
                target.value = normalizedValue;
            }
            if (target.dataset['storedRevealed'] === 'true') {
                delete target.dataset['storedMasked'];
            }
            delete target.dataset['storedRevealed'];
            target.dataset['keyDirty'] = 'true';
        });

        addListener(input, 'beforeinput', (event) => {
            const target = event.target as HTMLInputElement | HTMLTextAreaElement;
            const inputEvent = event as InputEvent;
            const inputType = inputEvent.inputType ?? '';

            if (
                target.dataset['storedMasked'] === 'true' &&
                target.dataset['storedRevealed'] !== 'true' &&
                !inputType.startsWith('delete')
            ) {
                this._clearStoredKeyMask(target);
            }
        });

        addListener(input, 'keydown', (event) => {
            if ((event as KeyboardEvent).key === 'Enter') {
                event.preventDefault();
            }
        });

        addListener(container.querySelector(`#${appId}-key-toggle-btn`), 'click', () => {
            void this.toggleKeyVisibility(appId);
        });

        // Add handler for the OpenRouter link
        addListener(container.querySelector(`#${appId}-api-link`), 'click', (e) => {
            e.preventDefault();
            if (this._tauri) {
                void this._tauri.openUrl('https://openrouter.ai/settings/keys');
            }
        });

        addListener(container.querySelector(`#${appId}-key-check-btn`), 'click', () => {
            void this.checkKey(appId);
        });

        const handleModelSelection = (event: Event) => {
            const card = (event.target as Element).closest<HTMLElement>(
                '.ai-model-card[data-model-key]',
            );
            if (!card) return;

            const keyEvent = event as KeyboardEvent;
            if (event.type === 'keydown' && keyEvent.key !== 'Enter' && keyEvent.key !== ' ')
                return;

            const modelKey = card.dataset['modelKey'];
            if (modelKey !== undefined && modelKey !== '') {
                event.preventDefault();
                this.selectModel(appId, modelKey);
            }
        };

        container.addEventListener('click', handleModelSelection, {
            signal: renderSignal,
        });
        container.addEventListener('keydown', handleModelSelection, {
            signal: renderSignal,
        });

        const thinkingGrid = container.querySelector(`#${appId}-thinking-grid`);
        if (thinkingGrid !== null) {
            const buttons = Array.from(
                thinkingGrid.querySelectorAll<HTMLElement>('.thinking-option-card'),
            );

            const updateThinking = (target: HTMLElement) => {
                const val = (target.dataset['value'] ?? 'high') as ThinkingLevel;
                this._aiSettings?.setThinkingLevel(appId, val);

                buttons.forEach((b) => {
                    b.classList.remove('selected');
                    b.setAttribute('aria-checked', 'false');
                });
                target.classList.add('selected');
                target.setAttribute('aria-checked', 'true');

                target.setAttribute('aria-checked', 'true');

                const savedModel = this._aiSettings?.getSelectedAIModel(appId) ?? '';
                if (savedModel !== '') {
                    this.selectModel(appId, savedModel);
                }
            };

            buttons.forEach((btn) => {
                btn.addEventListener(
                    'click',
                    (event) => {
                        updateThinking(event.currentTarget as HTMLElement);
                    },
                    { signal: renderSignal },
                );
                btn.addEventListener(
                    'keydown',
                    (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            updateThinking(event.currentTarget as HTMLElement);
                        }
                    },
                    { signal: renderSignal },
                );
            });
        }

        const globalContext = getGlobalWin();
        if (typeof globalContext.applyTranslations === 'function') {
            globalContext.applyTranslations();
        }
    }

    /**
     * Toggles API key field visibility.
     *
     * @param appId - Unique provider identifier
     * @sideeffect Modifies input type and innerHTML
     */
    public async toggleKeyVisibility(appId: string): Promise<void> {
        const input = document.getElementById(`${appId}-api-key-input`) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | null;
        const btn = document.getElementById(`${appId}-key-toggle-btn`);

        if (input !== null && btn !== null) {
            if (input.dataset['storedMasked'] === 'true') {
                if (input.dataset['storedRevealed'] === 'true') {
                    this._applyStoredKeyMask(input, input.value.length);
                    btn.innerHTML = ICONS.HIDDEN;
                    return;
                }

                const storedKey = await this._settingsService?.getSecureKey('openrouter');
                if (storedKey === undefined || storedKey === null || storedKey.trim() === '') {
                    this._showToast(
                        this._getTranslator()(
                            'ui.settings.key_invalid_check',
                            'Key is invalid or missing',
                        ),
                        'error',
                    );
                    return;
                }

                input.value = storedKey;
                input.classList.remove('is-masked');
                input.dataset['storedRevealed'] = 'true';
                delete input.dataset['keyDirty'];
                btn.innerHTML = ICONS.VISIBLE;
                return;
            }

            const isMasked = input.classList.contains('is-masked');
            input.classList.toggle('is-masked', !isMasked);
            btn.innerHTML = isMasked ? ICONS.VISIBLE : ICONS.HIDDEN;
        }
    }

    /**
     * Evaluates API key validity against provider infrastructure.
     *
     * @param appId - AI Provider ID
     * @sideeffect Updates button DOM state and displays toast notifications
     */
    public async checkKey(appId: string): Promise<void> {
        const input = document.getElementById(`${appId}-api-key-input`) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | null;
        const btn = document.getElementById(`${appId}-key-check-btn`) as HTMLButtonElement | null;
        if (input === null || btn === null) return;

        // Rate limiting check
        if (btn.disabled || btn.classList.contains('checking')) return;

        const t = this._getTranslator();
        const originalHtml = btn.innerHTML;
        const originalWidth = btn.offsetWidth;
        btn.style.width = `${String(originalWidth)}px`;
        btn.innerHTML = ICONS.SPINNER;
        btn.classList.add('checking');
        btn.disabled = true;

        try {
            const isStoredMask =
                input.dataset['storedMasked'] === 'true' &&
                input.dataset['storedRevealed'] !== 'true';
            const isDirtyReplacement = input.dataset['keyDirty'] === 'true';
            const key = input.value.trim();
            const shouldValidateTypedKey =
                (isDirtyReplacement && key !== '') || (!isStoredMask && key !== '');
            const shouldValidateStoredKey = !isDirtyReplacement && isStoredMask && key !== '';

            let isValid = false;
            if (shouldValidateTypedKey) {
                isValid = await this._validateKey(appId, key);
            } else if (shouldValidateStoredKey) {
                isValid = Boolean(await this._settingsService?.validateStoredApiKey('openrouter'));
            }

            if (isValid) {
                if (shouldValidateTypedKey && key !== '') {
                    await this._settingsService?.saveSecureKey('openrouter', key);
                    this._applyStoredKeyMask(input, key.length);
                }
                this._updateKeyButtonState(btn, 'success', ICONS.CHECK);
                this._showToast(t('ui.settings.key_valid', 'Key is valid'), 'success');
            } else {
                this._updateKeyButtonState(btn, 'error', ICONS.X);
                this._showToast(
                    t('ui.settings.key_invalid_check', 'Key is invalid or missing'),
                    'error',
                );
            }
        } catch (error: unknown) {
            tracer.error('[AISettingsRenderer] Key check failed:', error);
            this._updateKeyButtonState(btn, 'error', ICONS.X);
            this._showToast(t('ui.settings.key_check_error', 'Key check error'), 'error');
        } finally {
            // Enforcement of 3s cooldown before re-enabling
            this._checkTimeout = setTimeout(() => {
                this._checkTimeout = null;
                if (!document.body.contains(btn)) return; // Don't update if removed from DOM

                btn.disabled = false;
                btn.style.width = '';
                btn.classList.remove('success', 'error', 'checking');
                btn.innerHTML = originalHtml;
            }, 3000);
        }
    }

    private _applyStoredKeyMask(
        input: HTMLInputElement | HTMLTextAreaElement,
        length?: number,
    ): void {
        input.dataset['storedMasked'] = 'true';
        delete input.dataset['storedRevealed'];
        delete input.dataset['keyDirty'];
        input.classList.remove('is-masked');
        input.value = this._buildStoredKeyMask(length);
        input.placeholder = this._getTranslator()(
            'ui.settings.stored_key_placeholder',
            'Stored locally. Type to replace.',
        );
    }

    private _clearStoredKeyMask(input: HTMLInputElement | HTMLTextAreaElement): void {
        delete input.dataset['storedMasked'];
        delete input.dataset['storedRevealed'];
        input.value = '';
        input.classList.add('is-masked');
        input.placeholder = this._getTranslator()(
            'ui.settings.enter_key_placeholder',
            'Enter your API key here',
        );
    }

    private _buildStoredKeyMask(length?: number): string {
        const count = typeof length === 'number' && length > 0 ? length : 16;
        return '•'.repeat(count);
    }

    /**
     * Performs a network probe to validate credentials via Rust backend.
     */
    private async _validateKey(_appId: string, key: string): Promise<boolean> {
        if (!this._tauri) return false;

        try {
            return await this._tauri.invoke<boolean>('validate_api_key', {
                provider: 'openrouter',
                key,
            });
        } catch (error) {
            tracer.error('[AISettingsRenderer] Key validation failed:', error);
            return false;
        }
    }

    /**
     * Synchronizes button visual state with validation results.
     */
    private _updateKeyButtonState(
        btn: HTMLElement,
        state: 'success' | 'error',
        icon: string,
    ): void {
        btn.classList.remove('success', 'error', 'checking');
        btn.classList.add(state);
        btn.innerHTML = icon;
    }

    /**
     * Resolves and persists model selection transitions.
     *
     * @param appId - Provider ID
     * @param modelKey - Selected model ID
     * @sideeffect Updates local storage and refreshes stats DOM segments
     */
    public selectModel(appId: string, modelKey: string): void {
        this._aiSettings?.setSelectedAIModel(appId, modelKey);

        const grid =
            this._activeContainer?.querySelector('.ai-models-grid') ??
            document.querySelector('.ai-models-grid');
        grid?.querySelectorAll('.ai-model-card').forEach((card) => {
            const cardKey = (card as HTMLElement).dataset['modelKey'];
            card.classList.toggle('selected', cardKey === modelKey);
        });

        const modelData = getModelData(appId, modelKey);
        const hasReasoning = modelData?.capabilities?.reasoning === true;
        const thinkingSection = document.getElementById(`${appId}-thinking-section`);
        if (thinkingSection) {
            thinkingSection.style.display = hasReasoning ? 'block' : 'none';
        }

        const statsArea = document.getElementById(`${appId}-model-stats`);
        if (statsArea !== null) {
            const t = this._getTranslator();
            const statsHtml = `
                <div class="ai-content-panel">
                    <div class="settings-card-header-center">
                        <h3>📊 <span data-i18n="ui.settings.model_stats">${t('ui.settings.model_stats', 'Model Stats')}</span></h3>
                    </div>
                    ${this.renderModelStats(appId, modelKey)}
                </div>
            `;
            statsArea.innerHTML = DOMPurify.sanitize(statsHtml, PURIFY_CONFIG);

            const globalContext = getGlobalWin();
            if (typeof globalContext.applyTranslations === 'function') {
                globalContext.applyTranslations();
            }
        }
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
        const globalContext = getGlobalWin();
        const t = globalContext.t;
        return (t as TranslateFunc | undefined) ?? ((_key: string, fallback: string) => fallback);
    }

    /**
     * Emits a toast notification to the global UI.
     */
    private _showToast(message: string, type: string): void {
        const globalContext = getGlobalWin();
        if (typeof globalContext.showToast === 'function') {
            (globalContext.showToast as (m: string, t: string) => void)(message, type);
        }
    }

    private _cleanupRenderScope(): void {
        if (this._renderAbortController !== null) {
            this._renderAbortController.abort();
            this._renderAbortController = null;
        }

        if (this._checkTimeout !== null) {
            clearTimeout(this._checkTimeout);
            this._checkTimeout = null;
        }
    }
}

// Singleton instantiation
export const aiSettingsRenderer = new AISettingsRenderer();
