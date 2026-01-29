/**
 * @module ai/ui/AISettingsRenderer
 * @description Handles rendering of AI provider settings UI with secure DOM patterns.
 * Implements interactive model selection and API key management.
 *
 * @example
 * ```typescript
 * import { aiSettingsRenderer } from './AISettingsRenderer';
 * aiSettingsRenderer.init(settingsService);
 * await aiSettingsRenderer.render(container, app);
 * ```
 */

import DOMPurify from 'dompurify';

import { IApp } from '../../core/types/coreTypes';
import { SettingsService } from '../../settings/services/SettingsService';
import type { IAIModelData } from '../types/aiTypes';
import { sortModelsByPower, getProviderData, getModelData } from '../utils/catalogHelpers';

// ============================================================================
// Constants
// ============================================================================

const CACHE_KEYS = {
    SELECTED_MODEL: (appId: string) => `ai_${appId}_selected_model`,
    GPU_LAYERS: 'ai_local_gpu_layers',
    THREADS: 'ai_local_threads',
    CONTEXT_SIZE: 'ai_local_context_size',
    THINKING_LEVEL: (appId: string) => `ai_${appId}_thinking_level`,
} as const;

const ICONS = {
    VISIBLE:
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
    HIDDEN: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
    CHECK: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    X: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    SPINNER:
        '<svg style="animation: spin 1s linear infinite; width: 18px; height: 18px;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>',
};

// ============================================================================
// Types
// ============================================================================

type TranslateFunc = (key: string, fallback: string) => string;

interface IAISettingsGlobal {
    t?: TranslateFunc;
    showToast?: (message: string, type: string) => void;
    applyTranslations?: () => void;
}

/**
 * @class AISettingsRenderer
 * @description Manages the lifecycle and rendering of AI-specific settings modules.
 * Implements the Singleton pattern as defined in Axelate Standards Section 16.1.
 */
class AISettingsRenderer {
    private readonly _unsubscribers: (() => void)[] = [];
    private _initialized = false;
    private _settingsService: SettingsService | null = null;

    constructor() {
        // Registration on globalThis for access from HTML/legacy code (Section 16.3)
        (globalThis as unknown as Record<string, unknown>).aiSettingsRenderer = this;
    }

    /**
     * Idempotent initialization of the service.
     * Required by Section 16.2 of Axelate Standards.
     *
     * @param settingsService - Global settings infrastructure service
     */
    public init(settingsService: SettingsService): void {
        if (this._initialized) {
            console.warn('[AISettingsRenderer] Already initialized');
            return;
        }

        this._settingsService = settingsService;
        this._initialized = true;
        console.debug('[AISettingsRenderer] Initialized');
    }

    /**
     * Renders unified API and model settings for any AI provider.
     *
     * @param container - Target DOM element for ingestion
     * @param app - Catalog application record
     * @sideeffect Modifies the DOM by injecting sanitized HTML
     */
    public async render(container: HTMLElement, app: IApp): Promise<void> {
        if (!this._initialized) {
            console.error('[AISettingsRenderer] Not initialized. Call init() first.');
            return;
        }

        const appId = app.id;
        const providerData = app.api_provider_data || {};
        const models = providerData.models || {};
        const sortedModels = sortModelsByPower(models as Record<string, IAIModelData>);

        const defaultModelId = sortedModels.length > 0 ? sortedModels[0][0] : '';
        const savedModel = localStorage.getItem(CACHE_KEYS.SELECTED_MODEL(appId)) || defaultModelId;
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
                        <h3 id="${appId}-title">${app.name || 'Module'} Settings</h3>
                         <div class="model-desc" data-i18n="ui.settings.no_settings">No additional settings required for this module.</div>
                    </div>
                </div>
            </div>`;
        } else {
            rawHtml = `
            <div class="ai-module-config universal-api-theme" data-provider-id="${appId}">
                <!-- Unified API & Models Settings -->
                <div class="ai-settings-content">
                    <section class="ai-key-section centered" aria-labelledby="${appId}-api-title">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3 id="${appId}-api-title">🔑 <span data-i18n="ui.settings.api_key_label">${t('ui.settings.api_key_label', 'API Key')}</span></h3>
                            </div>
                            <div class="ai-key-input-row">
                                <input type="password" id="${appId}-api-key-input" value="" placeholder="${t('ui.settings.enter_key_placeholder', 'Enter your API key here...')}" data-i18n-placeholder="ui.settings.enter_key_placeholder">
                                <button id="${appId}-key-toggle-btn" class="ai-icon-btn" aria-label="Toggle password visibility" data-i18n-aria-label="ui.settings.toggle_visibility">${ICONS.HIDDEN}</button>
                                <button id="${appId}-key-check-btn" class="ai-check-btn" data-i18n="ui.gpt.key_check_btn">${t('ui.gpt.key_check_btn', 'Check')}</button>
                            </div>
                            <div class="encryption-note">🔒 <span data-i18n="ui.settings.keys_encrypted">${t('ui.settings.keys_encrypted', 'Keys are securely encrypted locally.')}</span></div>
                        </div>
                    </section>

                    <div class="ai-divider"></div>

                    <!-- MODELS SECTION (CENTERED HEADER) -->
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
                                  const savedLevel = localStorage.getItem(
                                      CACHE_KEYS.THINKING_LEVEL(appId),
                                  );
                                  // Positive assertions to satisfy Section 35.1 and strict lints
                                  const isLow = savedLevel === 'low';
                                  const isHigh = savedLevel === 'high' || savedLevel === null;

                                  return `
                        <section class="thinking-level-section" aria-labelledby="${appId}-thinking-title">
                            <div class="ai-content-panel">
                                <div class="settings-card-header-center">
                                    <h3 id="${appId}-thinking-title" class="thinking-level-title">🧠 <span data-i18n="ui.settings.gemini.thinking">${t('ui.settings.gemini.thinking', 'Thinking Level')}</span></h3>
                                    <div class="thinking-level-desc" data-i18n="ui.settings.gemini.thinking_desc">${t('ui.settings.gemini.thinking_desc', 'Control reasoning depth')}</div>
                                </div>
                                <div id="${appId}-thinking-grid" class="thinking-grid" role="radiogroup" aria-label="Thinking Level">
                                    <div class="thinking-option-card ${isHigh ? 'selected' : ''}" 
                                        role="radio" 
                                        aria-checked="${isHigh}" 
                                        tabindex="0"
                                        data-value="high">
                                        <div class="thinking-option-title" data-i18n="ui.settings.thinking.high">${t('ui.settings.thinking.high', 'High')}</div>
                                        <div class="thinking-option-subtitle" data-i18n="ui.settings.thinking.high_desc">${t('ui.settings.thinking.high_desc', 'Maximum Reasoning')}</div>
                                    </div>
                                    <div class="thinking-option-card ${isLow ? 'selected' : ''}" 
                                        role="radio" 
                                        aria-checked="${isLow}" 
                                        tabindex="0"
                                        data-value="low">
                                        <div class="thinking-option-title" data-i18n="ui.settings.thinking.low">${t('ui.settings.thinking.low', 'Low')}</div>
                                        <div class="thinking-option-subtitle" data-i18n="ui.settings.thinking.low_desc">${t('ui.settings.thinking.low_desc', 'Fast & Balanced')}</div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        `;
                              })()
                            : ''
                    }

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

        container.innerHTML = DOMPurify.sanitize(rawHtml);
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
        const pricingHtml = (model.pricing || [])
            .map(
                (price) => `
            <div class="price-row">
                <span>${price.tier}</span>
                <span>${price.note || price.in + ' / ' + price.out}</span>
            </div>
        `,
            )
            .join('');

        return `
            <div class="ai-model-card ${isSelected ? 'selected' : ''}" 
                role="option" 
                aria-selected="${isSelected}" 
                tabindex="0"
                data-model-key="${key}">
                <div class="model-name">${DOMPurify.sanitize(model.name)}</div>
                <div class="model-desc" data-i18n="${model.descKey}">${DOMPurify.sanitize(t(model.descKey || '', model.desc))}</div>
                <div class="model-pricing">${pricingHtml}</div>
            </div>
        `;
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

        if (!stats)
            return `<div class="model-desc">${t('ui.settings.stats_unavailable', 'Stats unavailable')}</div>`;

        const thinkingLevel = localStorage.getItem(CACHE_KEYS.THINKING_LEVEL(appId)) || 'high';

        const adjustedLogic =
            thinkingLevel === 'high' ? Math.min(10, (stats.logic || 0) + 2) : stats.logic || 0;

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
        if (input && savedKey) input.value = savedKey;

        const addListener = (element: Element | null, type: string, fn: EventListener) => {
            if (element) {
                element.addEventListener(type, fn);
                this._unsubscribers.push(() => element.removeEventListener(type, fn));
            }
        };

        addListener(input, 'input', (event) => {
            this._settingsService?.saveSecureKey(appId, (event.target as HTMLInputElement).value);
        });

        addListener(container.querySelector(`#${appId}-key-toggle-btn`), 'click', () => {
            this.toggleKeyVisibility(appId);
        });

        addListener(container.querySelector(`#${appId}-key-check-btn`), 'click', () => {
            this.checkKey(appId);
        });

        const handleModelSelection = (event: Event) => {
            const card = (event.target as Element).closest<HTMLElement>(
                '.ai-model-card[data-model-key]',
            );
            if (!card) return;

            const keyEvent = event as KeyboardEvent;
            if (event.type === 'keydown' && keyEvent.key !== 'Enter' && keyEvent.key !== ' ')
                return;

            if (card.dataset.modelKey) {
                event.preventDefault();
                this.selectModel(appId, card.dataset.modelKey);
            }
        };

        container.addEventListener('click', handleModelSelection);
        container.addEventListener('keydown', handleModelSelection);
        this._unsubscribers.push(() => {
            container.removeEventListener('click', handleModelSelection);
            container.removeEventListener('keydown', handleModelSelection);
        });

        const thinkingGrid = container.querySelector(`#${appId}-thinking-grid`);
        if (thinkingGrid) {
            const buttons = Array.from(
                thinkingGrid.querySelectorAll<HTMLElement>('.thinking-option-card'),
            );

            const updateThinking = (target: HTMLElement) => {
                const val = target.dataset.value || 'high';
                localStorage.setItem(CACHE_KEYS.THINKING_LEVEL(appId), val);

                buttons.forEach((b) => {
                    b.classList.remove('selected');
                    b.setAttribute('aria-checked', 'false');
                });
                target.classList.add('selected');
                target.setAttribute('aria-checked', 'true');

                const savedModel = localStorage.getItem(CACHE_KEYS.SELECTED_MODEL(appId)) || '';
                if (savedModel) {
                    this.selectModel(appId, savedModel);
                }
            };

            buttons.forEach((btn) => {
                btn.addEventListener('click', (event) =>
                    updateThinking(event.currentTarget as HTMLElement),
                );
                btn.addEventListener('keydown', (event) => {
                    const keyEvent = event;
                    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                        event.preventDefault();
                        updateThinking(event.currentTarget as HTMLElement);
                    }
                });
            });
        }

        const globalContext = globalThis as unknown as IAISettingsGlobal;
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
    public toggleKeyVisibility(appId: string): void {
        const input = document.getElementById(`${appId}-api-key-input`) as HTMLInputElement | null;
        const btn = document.getElementById(`${appId}-key-toggle-btn`);

        if (input && btn) {
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
        const btn = document.getElementById(`${appId}-key-check-btn`);
        if (!input || !btn) return;

        const t = this._getTranslator();
        const key = input.value.trim();

        if (!key) {
            this._showToast(t('ui.settings.key_invalid', 'Invalid Key'), 'error');
            return;
        }

        const originalHtml = btn.innerHTML;
        const originalWidth = btn.offsetWidth;
        btn.style.width = originalWidth + 'px';
        btn.innerHTML = ICONS.SPINNER;
        btn.style.pointerEvents = 'none';

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
            console.error('[AISettingsRenderer] Key check failed:', error);
            this._updateKeyButtonState(btn, 'error', ICONS.X);
            this._showToast(t('ui.settings.key_check_error', 'Key check error'), 'error');
        } finally {
            setTimeout(() => {
                if (btn) {
                    btn.style.pointerEvents = 'auto';
                    btn.style.width = '';
                    btn.style.borderColor = 'var(--border-color)';
                    btn.style.color = 'var(--text-secondary)';
                    btn.innerHTML = originalHtml;
                }
            }, 3000);
        }
    }

    /**
     * Performs a network probe to validate credentials.
     */
    private async _validateKey(appId: string, key: string): Promise<boolean> {
        const providerData = getProviderData(appId);

        if (appId === 'gemini') {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
            );
            return res.ok;
        }

        const baseUrl = providerData?.baseUrl || 'https://api.openai.com/v1';
        const url = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
        return res.ok;
    }

    /**
     * Synchronizes button visual state with validation results.
     */
    private _updateKeyButtonState(
        btn: HTMLElement,
        state: 'success' | 'error',
        icon: string,
    ): void {
        const color = state === 'success' ? 'var(--success)' : 'var(--error)';
        btn.style.borderColor = color;
        btn.style.color = color;
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
        localStorage.setItem(CACHE_KEYS.SELECTED_MODEL(appId), modelKey);

        const grid = document.querySelector('.ai-models-grid');
        grid?.querySelectorAll('.ai-model-card').forEach((card) => {
            const cardKey = (card as HTMLElement).dataset.modelKey;
            card.classList.toggle('selected', cardKey === modelKey);
        });

        const statsArea = document.getElementById(`${appId}-model-stats`);
        if (statsArea) {
            const t = this._getTranslator();
            const rawHtml = `
                <div class="ai-content-panel">
                    <div class="settings-card-header-center">
                        <h3>📊 <span data-i18n="ui.settings.model_stats">${t('ui.settings.model_stats', 'Model Stats')}</span></h3>
                    </div>
                    ${this.renderModelStats(appId, modelKey)}
                </div>
            `;
            statsArea.innerHTML = DOMPurify.sanitize(rawHtml);

            const globalContext = globalThis as unknown as IAISettingsGlobal;
            if (typeof globalContext.applyTranslations === 'function') {
                globalContext.applyTranslations();
            }
        }
    }

    /**
     * Resets internal state and deactivates observers.
     * MANDATORY cleanup method required by Section 4.3.
     */
    public destroy(): void {
        this._unsubscribers.forEach((fn) => fn());
        this._unsubscribers.length = 0;
        this._initialized = false;
    }

    /**
     * Resolves the translation service from the global context.
     */
    private _getTranslator(): TranslateFunc {
        const globalContext = globalThis as unknown as IAISettingsGlobal;
        const t = globalContext.t;
        return t || ((_key: string, fallback: string) => fallback);
    }

    /**
     * Emits a toast notification to the global UI.
     */
    private _showToast(message: string, type: string): void {
        const globalContext = globalThis as unknown as IAISettingsGlobal;
        if (typeof globalContext.showToast === 'function') {
            globalContext.showToast(message, type);
        }
    }
}

// Singleton instantiation
export const aiSettingsRenderer = new AISettingsRenderer();
