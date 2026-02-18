/**
 * @module ai/ui/AISettingsRenderer
 * @description Handles rendering of AI provider settings UI with secure DOM patterns.
 * Implements interactive model selection and API key management.
 */

import DOMPurify from 'dompurify';

import type { IApp } from '@/shared/types/coreTypes';
import { type SettingsService } from '@/features/settings/services/SettingsService';
import { type StateService, type ThinkingLevel } from '@/shared/services/StateService';
import type { IAIModelData } from '../types/aiTypes';
import { getModelData, sortModelsByPower } from '../utils/catalogHelpers';
import type { TGlobalWin } from '@/shared/types/global_bridge_types';
import { logger } from '@/infrastructure/logging/LoggerService';
import { BaseComponent } from '@/shared/ui/BaseComponent';
import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';

const ICONS = {
    VISIBLE:
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    HIDDEN: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',
    CHECK: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    X: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    SPINNER:
        '<svg class="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" style="opacity: 0.2;"></circle><path d="M4 12a8 8 0 0 1 8-8" style="opacity: 0.8;"></path></svg>',
} as const;

// ============================================================================
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
    private _stateService: StateService | null = null;
    private _tauri: TauriProvider | null = null;
    private _checkTimeout: ReturnType<typeof setTimeout> | null = null;

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
        stateService: StateService,
        tauri: TauriProvider,
    ): Promise<void> {
        this._settingsService = settingsService;
        this._stateService = stateService;
        this._tauri = tauri;
        return super.init();
    }

    protected onInit(): void | Promise<void> {
        logger.debug('[AISettingsRenderer] Initialized');
    }

    protected onDestroy(): void {
        this._settingsService = null;
        this._stateService = null;
        this._tauri = null;

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
            logger.error('[AISettingsRenderer] Not initialized. Call init() first.');
            return;
        }

        const appId = app.id;
        const providerData = app.apiProviderData ?? {};
        const models = providerData['models'] as Record<string, IAIModelData> | undefined;
        const sortedModels = sortModelsByPower(models ?? {});

        const firstModel = sortedModels.length > 0 ? sortedModels[0] : undefined;
        const defaultModelId = firstModel ? firstModel[0] : '';
        const savedModel = this._stateService?.getSelectedAIModel(appId) ?? defaultModelId;
        const t = this._getTranslator();

        const isCleanApp =
            ['axelate', 'axelate-platform', 'axelate-localai'].includes(appId) ||
            appId.includes('telegram');

        let rawHtml = '';

        if (isCleanApp) {
            rawHtml = `
            <div class="ai-module-config universal-api-theme" data-provider-id="${appId}">
                <div class="ai-content-panel">
                    <div class="settings-card-header-center">
                        <h3 id="${appId}-title">${app.name ?? 'Module'} Settings</h3>
                         <div class="model-desc" data-i18n="ui.settings.no_settings">No additional settings required for this module.</div>
                    </div>
                </div>
            </div>`;
        } else {
            rawHtml = `
            <div class="ai-module-config universal-api-theme" data-provider-id="${appId}">
                <!-- Unified API & Models Settings -->
                <div class="ai-settings-content">
                    <!-- 1. API KEY SECTION (CLEAN) -->
                    <section class="ai-key-section centered" aria-labelledby="${appId}-api-title">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3 id="${appId}-api-title">🔑 <span data-i18n="ui.settings.api_key_label">${t('ui.settings.api_key_label', 'API Key')}</span></h3>
                            </div>
                            <div class="ai-key-input-row">
                                <input type="password" id="${appId}-api-key-input" value="" placeholder="${t('ui.settings.enter_key_placeholder', 'Enter your API key here')}" data-i18n-placeholder="ui.settings.enter_key_placeholder">
                                <button id="${appId}-key-toggle-btn" class="ai-icon-btn" aria-label="Toggle password visibility" data-i18n-aria-label="ui.settings.toggle_visibility">${ICONS.HIDDEN}</button>
                                <button id="${appId}-key-check-btn" class="ai-check-btn" data-i18n="ui.gpt.key_check_btn">${t('ui.gpt.key_check_btn', 'Check')}</button>
                            </div>
                            <div class="encryption-note">🔒 <span data-i18n="ui.settings.keys_encrypted">${t('ui.settings.keys_encrypted', 'Keys are securely encrypted locally.')}</span></div>
                        </div>
                    </section>

                    <!-- 2. MODELS SECTION (WINDOW) -->
                    <section class="ai-models-section" aria-labelledby="${appId}-models-title">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3 id="${appId}-models-title">🤖 <span data-i18n="ui.settings.select_model">${t('ui.settings.select_model', 'Select Model')}</span></h3>
                            </div>
                            <div class="ai-models-grid" role="listbox" aria-label="Available Models">
                                ${sortedModels.map(([key, model]) => this._renderModelCard(key, model, savedModel === key, t)).join('')}
                            </div>
                        </div>
                    </section>

                    ${
                        appId === 'gemini' || appId === 'claude' || appId === 'gpt'
                            ? (() => {
                                  const savedLevel = this._stateService?.getThinkingLevel(appId);
                                  const isLow = savedLevel === 'low';
                                  const isMedium = savedLevel === 'medium';
                                  const isHigh = savedLevel === 'high' || savedLevel === undefined;

                                  return `
                        <!-- 3. THINKING LEVEL SECTION (WINDOW) -->
                        <section class="thinking-level-section" aria-labelledby="${appId}-thinking-title">
                            <div class="ai-content-panel">
                                <div class="settings-card-header-center">
                                    <h3 id="${appId}-thinking-title" class="thinking-level-title">🧠 <span data-i18n="ui.settings.gemini.thinking">${t('ui.settings.gemini.thinking', 'Thinking Level')}</span></h3>
                                    <div class="thinking-level-desc" data-i18n="ui.settings.gemini.thinking_desc">${t('ui.settings.gemini.thinking_desc', 'Control reasoning depth')}</div>
                                </div>
                                <div id="${appId}-thinking-grid" class="thinking-grid three-col" role="radiogroup" aria-label="Thinking Level">
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
                              })()
                            : ''
                    }

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
        }

        container.innerHTML = DOMPurify.sanitize(rawHtml, {
            USE_PROFILES: { html: true, svg: true },
            ADD_TAGS: ['svg', 'path', 'circle', 'polyline', 'line', 'g'],
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
            ],
        });
        await this._bindEvents(container, appId);
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

        return `
            <div class="ai-model-card ${isSelected ? 'selected' : ''}" 
                role="option" 
                aria-selected="${String(isSelected)}" 
                tabindex="0"
                data-model-key="${key}">
                <div class="model-name">${DOMPurify.sanitize(model.name, { USE_PROFILES: { html: true, svg: true } })}</div>
                <div class="model-desc" data-i18n="${model.descKey ?? ''}">${DOMPurify.sanitize(t(model.descKey ?? '', model.desc), { USE_PROFILES: { html: true, svg: true } })}</div>
                <div class="model-pricing">${pricingHtml}</div>
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
            const thinkingLevel = this._stateService?.getThinkingLevel(appId) ?? 'high';

            let adjustedLogic = stats.logic || 0;
            if (thinkingLevel === 'high') {
                adjustedLogic = Math.min(10, adjustedLogic + 2);
            } else if (thinkingLevel === 'medium') {
                adjustedLogic = Math.min(10, adjustedLogic + 1);
            }

            return `
                <div class="ai-stats-grid">
                    <div>
                        <div class="stat-label" data-i18n="ui.gpt.stats.speed">${t('ui.gpt.stats.speed', 'Speed')}</div>
                        <div>${this._renderStars(stats.speed)}</div>
                    </div>
                    <div>
                        <div class="stat-label" data-i18n="ui.gpt.stats.logic">${t('ui.gpt.stats.logic', 'Logic')}</div>
                        <div>${this._renderStars(adjustedLogic)}</div>
                    </div>
                    <div>
                        <div class="stat-label" data-i18n="ui.gpt.stats.creative">${t('ui.gpt.stats.creative', 'Creative')}</div>
                        <div>${this._renderStars(stats.creative)}</div>
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
            let color = 'rgba(255,255,255,0.1)';

            if (count >= thresholdFull) {
                color = '#FFD700';
            } else if (count >= thresholdHalf) {
                className += ' half';
                color = 'transparent';
            }

            const styleAttr = className.includes('half') ? '' : `style="color: ${color};"`;
            starsHtml += `<span class="${className}" ${styleAttr}>★</span>`;
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

        const input = container.querySelector<HTMLInputElement>(`#${appId}-api-key-input`);

        const savedKey = await this._settingsService.getSecureKey(appId);
        if (input !== null && (savedKey ?? '') !== '') input.value = savedKey ?? '';

        const addListener = (element: Element | null, type: string, fn: EventListener): void => {
            if (element !== null && this._abortController !== null) {
                element.addEventListener(type, fn, { signal: this._abortController.signal });
            }
        };

        addListener(input, 'input', (event) => {
            if (this._settingsService) {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this._settingsService.saveSecureKey(
                    appId,
                    (event.target as HTMLInputElement).value,
                );
            }
        });

        addListener(container.querySelector(`#${appId}-key-toggle-btn`), 'click', () => {
            this.toggleKeyVisibility(appId);
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
            signal: this._abortController?.signal as AbortSignal,
        });
        container.addEventListener('keydown', handleModelSelection, {
            signal: this._abortController?.signal as AbortSignal,
        });

        const thinkingGrid = container.querySelector(`#${appId}-thinking-grid`);
        if (thinkingGrid !== null) {
            const buttons = Array.from(
                thinkingGrid.querySelectorAll<HTMLElement>('.thinking-option-card'),
            );

            const updateThinking = (target: HTMLElement) => {
                const val = (target.dataset['value'] ?? 'high') as ThinkingLevel;
                this._stateService?.setThinkingLevel(appId, val);

                buttons.forEach((b) => {
                    b.classList.remove('selected');
                    b.setAttribute('aria-checked', 'false');
                });
                target.classList.add('selected');
                target.setAttribute('aria-checked', 'true');

                target.setAttribute('aria-checked', 'true');

                const savedModel = this._stateService?.getSelectedAIModel(appId) ?? '';
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
                    { signal: this._abortController?.signal as AbortSignal },
                );
                btn.addEventListener(
                    'keydown',
                    (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            updateThinking(event.currentTarget as HTMLElement);
                        }
                    },
                    { signal: this._abortController?.signal as AbortSignal },
                );
            });
        }

        const globalContext = globalThis as TGlobalWin;
        if (typeof globalContext.applyTranslations === 'function') {
            (globalContext.applyTranslations as () => void)();
        }
    }

    /**
     * Toggles API key field visibility.
     *
     * @param appId - Unique provider identifier
     * @sideeffect Modifies input type and innerHTML
     */
    public toggleKeyVisibility(appId: string): void {
        const input = document.getElementById(`${appId}-api-key-input`) as HTMLInputElement | null;
        const btn = document.getElementById(`${appId}-key-toggle-btn`);

        if (input !== null && btn !== null) {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.innerHTML = isPassword ? ICONS.VISIBLE : ICONS.HIDDEN;
        }
    }

    /**
     * Evaluates API key validity against provider infrastructure.
     *
     * @param appId - AI Provider ID
     * @sideeffect Updates button DOM state and displays toast notifications
     */
    public async checkKey(appId: string): Promise<void> {
        const input = document.getElementById(`${appId}-api-key-input`) as HTMLInputElement | null;
        const btn = document.getElementById(`${appId}-key-check-btn`) as HTMLButtonElement | null;
        if (input === null || btn === null) return;

        // Rate limiting check
        if (btn.disabled || btn.classList.contains('checking')) return;

        const t = this._getTranslator();
        const key = input.value.trim();

        if (!key) {
            this._showToast(t('ui.settings.key_invalid', 'Invalid Key'), 'error');
            return;
        }

        const originalHtml = btn.innerHTML;
        const originalWidth = btn.offsetWidth;
        btn.style.width = `${String(originalWidth)}px`;
        btn.innerHTML = ICONS.SPINNER;
        btn.classList.add('checking');
        btn.disabled = true;

        try {
            const isValid = await this._validateKey(appId, key);
            if (isValid) {
                this._updateKeyButtonState(btn, 'success', ICONS.CHECK);
                this._showToast(t('ui.settings.key_valid', 'Key is valid'), 'success');
            } else {
                this._updateKeyButtonState(btn, 'error', ICONS.X);
                this._showToast(t('ui.settings.key_invalid_check', 'Key is invalid'), 'error');
            }
        } catch (error: unknown) {
            logger.error('[AISettingsRenderer] Key check failed:', error);
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

    /**
     * Performs a network probe to validate credentials via Rust backend.
     */
    private async _validateKey(appId: string, key: string): Promise<boolean> {
        if (!this._tauri) return false;

        try {
            const provider = appId === 'gemini' ? 'gemini' : 'openai';
            return await this._tauri.invoke<boolean>('validate_api_key', { provider, key });
        } catch (error) {
            logger.error('[AISettingsRenderer] Key validation failed:', error);
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
        this._stateService?.setSelectedAIModel(appId, modelKey);

        const grid = document.querySelector('.ai-models-grid');
        grid?.querySelectorAll('.ai-model-card').forEach((card) => {
            const cardKey = (card as HTMLElement).dataset['modelKey'];
            card.classList.toggle('selected', cardKey === modelKey);
        });

        const statsArea = document.getElementById(`${appId}-model-stats`);
        if (statsArea !== null) {
            const t = this._getTranslator();
            const rawHtml = `
                <div class="ai-content-panel">
                    <div class="settings-card-header-center">
                        <h3>📊 <span data-i18n="ui.settings.model_stats">${t('ui.settings.model_stats', 'Model Stats')}</span></h3>
                    </div>
                    ${this.renderModelStats(appId, modelKey)}
                </div>
            `;
            statsArea.innerHTML = DOMPurify.sanitize(rawHtml, {
                USE_PROFILES: { html: true, svg: true },
                ADD_TAGS: ['svg', 'path', 'circle', 'polyline', 'line', 'g'],
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
                ],
            });

            const globalContext = globalThis as TGlobalWin;
            if (typeof globalContext.applyTranslations === 'function') {
                (globalContext.applyTranslations as () => void)();
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
        const globalContext = globalThis as TGlobalWin;
        const t = globalContext.t;
        return (t as TranslateFunc | undefined) ?? ((_key: string, fallback: string) => fallback);
    }

    /**
     * Emits a toast notification to the global UI.
     */
    private _showToast(message: string, type: string): void {
        const globalContext = globalThis as TGlobalWin;
        if (typeof globalContext.showToast === 'function') {
            (globalContext.showToast as (m: string, t: string) => void)(message, type);
        }
    }
}

// Singleton instantiation
export const aiSettingsRenderer = new AISettingsRenderer();
