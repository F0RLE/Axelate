import DOMPurify from 'dompurify';

import type { IApp } from '@/shared/types/coreTypes';
import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { IAIModelData } from '../types/aiTypes';
import type { AISettingsViewPolicy } from './AISettingsViewPolicy';
import {
    renderInternetAccessSection,
    renderModelCard,
    renderCustomModelComposer,
    renderThinkingSection,
} from './AISettingsMarkup';

type TranslateFunc = (key: string, fallback: string) => string;

type AISettingsRenderContext = {
    app: IApp;
    appId: string;
    models: IAIModelData[];
    savedModel: string;
    showModelStats: boolean;
    showCustomModelComposer: boolean;
    translate: TranslateFunc;
    viewPolicy: AISettingsViewPolicy;
    supportsInternetAccess: boolean;
    supportsThinking: boolean;
    thinkingLevel: ThinkingLevel | null | undefined;
    internetAccessEnabled: boolean;
    renderModelStats: (appId: string, modelKey: string) => string;
};

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

export class AISettingsContentRenderer {
    public render(container: HTMLElement, context: AISettingsRenderContext): void {
        container.innerHTML = DOMPurify.sanitize(this._buildMarkup(context), PURIFY_CONFIG);
    }

    public syncSelectedModelView(
        container: HTMLElement | null,
        appId: string,
        modelKey: string,
        hasReasoning: boolean,
        statsMarkup: string,
        i18nUI: I18nUI | null,
    ): void {
        const grid = container?.querySelector<HTMLElement>('.ai-models-grid');
        grid?.querySelectorAll('.ai-model-card').forEach((card) => {
            const cardKey = (card as HTMLElement).dataset['modelKey'];
            card.classList.toggle('selected', cardKey === modelKey);
        });

        const thinkingSection = container?.querySelector<HTMLElement>(`#${appId}-thinking-section`);
        if (thinkingSection !== null && thinkingSection !== undefined) {
            thinkingSection.classList.toggle('is-hidden', !hasReasoning);
        }

        const statsArea = container?.querySelector<HTMLElement>(`#${appId}-model-stats`);
        if (statsArea !== null && statsArea !== undefined) {
            statsArea.innerHTML = DOMPurify.sanitize(statsMarkup, PURIFY_CONFIG);
            i18nUI?.applyTranslations(statsArea);
        }
    }

    private _buildMarkup(context: AISettingsRenderContext): string {
        if (context.viewPolicy.isCleanApp(context.appId)) {
            return this._buildCleanAppMarkup(context);
        }

        return this._buildProviderMarkup(context);
    }

    private _buildCleanAppMarkup(context: AISettingsRenderContext): string {
        return `
            <div class="ai-module-config universal-api-theme" data-provider-id="${context.appId}">
                <div class="ai-content-panel">
                    <div class="settings-card-header-center">
                        <h3 id="${context.appId}-title">${context.app.name ?? 'Module'} Settings</h3>
                        <div class="model-desc" data-i18n="ui.settings.no_settings">No additional settings required for this module.</div>
                    </div>
                </div>
            </div>
        `;
    }

    private _buildProviderMarkup(context: AISettingsRenderContext): string {
        const { appId, models, savedModel, translate, viewPolicy } = context;

        return `
            <div class="ai-module-config universal-api-theme" data-provider-id="${appId}">
                <div class="ai-settings-content">
                    <section class="ai-key-section centered" aria-labelledby="${appId}-api-title">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3 id="${appId}-api-title">🔑 
                                    <a href="#" id="${appId}-api-link" class="api-key-link" title="Manage your OpenRouter API Keys">
                                        <span data-i18n="ui.settings.api_key_label">${translate('ui.settings.api_key_label', 'OpenRouter API Key')}</span>
                                    </a>
                                </h3>
                            </div>
                            <div class="ai-key-input-row">
                                <input id="${appId}-api-key-input" class="ai-key-editor is-masked" type="text" placeholder="${translate('ui.settings.enter_key_placeholder', 'Enter your API key here')}" data-i18n-placeholder="ui.settings.enter_key_placeholder" spellcheck="false" autocomplete="off" />
                                <button id="${appId}-key-toggle-btn" class="ai-icon-btn" aria-label="Toggle password visibility" data-i18n-aria-label="ui.settings.toggle_visibility"></button>
                                <button id="${appId}-key-check-btn" class="ai-check-btn" data-i18n="ui.gpt.key_check_btn">${translate('ui.gpt.key_check_btn', 'Check')}</button>
                            </div>
                            <div class="encryption-note">🔒 <span data-i18n="ui.settings.keys_encrypted">${translate('ui.settings.keys_encrypted', 'Shared OpenRouter key is securely encrypted locally.')}</span></div>
                        </div>
                    </section>

                    <section class="ai-models-section" aria-labelledby="${appId}-models-title">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3 id="${appId}-models-title">🤖 <span data-i18n="ui.settings.select_model">${translate('ui.settings.select_model', 'Select Model')}</span></h3>
                            </div>
                            <div class="ai-models-grid" role="listbox" aria-label="Available Models">
                                ${models.map((model) => renderModelCard(model.id, model, savedModel === model.id, translate, viewPolicy)).join('')}
                                ${context.showCustomModelComposer ? renderCustomModelComposer(appId, translate) : ''}
                            </div>
                        </div>
                    </section>

                    ${renderThinkingSection(
                        appId,
                        savedModel,
                        models,
                        translate,
                        context.supportsThinking,
                        context.thinkingLevel,
                        context.viewPolicy.shouldForceThinkingVisibility(appId),
                    )}
                    ${context.supportsInternetAccess ? renderInternetAccessSection(appId, translate, context.internetAccessEnabled) : ''}

                    ${
                        context.showModelStats
                            ? `
                    <section id="${appId}-model-stats" class="ai-stats-section" aria-live="polite">
                        <div class="ai-content-panel">
                            <div class="settings-card-header-center">
                                <h3>📊 <span data-i18n="ui.settings.model_stats">${translate('ui.settings.model_stats', 'Model Stats')}</span></h3>
                            </div>
                            ${context.renderModelStats(appId, savedModel)}
                        </div>
                    </section>`
                            : ''
                    }
                </div>
            </div>
        `;
    }
}
