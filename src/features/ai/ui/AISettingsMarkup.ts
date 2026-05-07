import DOMPurify from 'dompurify';

import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';
import type { IAIModelData } from '../types/aiTypes';
import type { AISettingsViewPolicy } from './AISettingsViewPolicy';

type TranslateFunc = (key: string, fallback: string) => string;

interface IAIModelPricing {
    input?: number;
    output?: number;
    currency?: string;
}

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

export function renderThinkingSection(
    appId: string,
    savedModel: string,
    models: IAIModelData[],
    translate: TranslateFunc,
    supportsThinking: boolean,
    savedLevel: ThinkingLevel | null | undefined,
    forceVisibility = false,
): string {
    if (!supportsThinking) return '';

    const isOff = savedLevel === 'off';
    const isLow = savedLevel === 'low';
    const isMedium = savedLevel === 'medium';
    const isHigh = savedLevel === 'high';

    const selectedModelData = models.find((model) => model.id === savedModel);
    const hasReasoning = selectedModelData?.capabilities?.reasoning === true || forceVisibility;

    return `
        <section id="${appId}-thinking-section" class="thinking-level-section ${hasReasoning ? '' : 'is-hidden'}" aria-labelledby="${appId}-thinking-title">
            <div class="ai-content-panel">
                <div class="settings-card-header-center">
                    <h3 id="${appId}-thinking-title" class="thinking-level-title">🧠 <span data-i18n="ui.settings.gemini.thinking">${translate('ui.settings.gemini.thinking', 'Thinking Level')}</span></h3>
                </div>
                <div id="${appId}-thinking-grid" class="thinking-grid four-col" role="radiogroup" aria-label="Thinking Level">
                    <div class="thinking-option-card ${isHigh ? 'selected' : ''}" role="radio" aria-checked="${String(isHigh)}" tabindex="0" data-value="high">
                        <div class="thinking-option-title" data-i18n="ui.settings.thinking.high">${translate('ui.settings.thinking.high', 'High')}</div>
                    </div>
                    <div class="thinking-option-card ${isMedium ? 'selected' : ''}" role="radio" aria-checked="${String(isMedium)}" tabindex="0" data-value="medium">
                        <div class="thinking-option-title" data-i18n="ui.settings.thinking.medium">${translate('ui.settings.thinking.medium', 'Medium')}</div>
                    </div>
                    <div class="thinking-option-card ${isLow ? 'selected' : ''}" role="radio" aria-checked="${String(isLow)}" tabindex="0" data-value="low">
                        <div class="thinking-option-title" data-i18n="ui.settings.thinking.low">${translate('ui.settings.thinking.low', 'Low')}</div>
                    </div>
                    <div class="thinking-option-card ${isOff ? 'selected' : ''}" role="radio" aria-checked="${String(isOff)}" tabindex="0" data-value="off">
                        <div class="thinking-option-title" data-i18n="ui.settings.thinking.off">${translate('ui.settings.thinking.off', 'Off')}</div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

export function renderInternetAccessSection(
    appId: string,
    translate: TranslateFunc,
    isEnabled: boolean,
): string {
    const title = translate('ui.settings.internet_access', 'Allow AI Internet Access');

    return `
        <section id="${appId}-internet-section" class="ai-web-section" aria-labelledby="${appId}-internet-title">
            <div class="ai-content-panel">
                <div class="settings-card-header-center">
                    <h3 id="${appId}-internet-title">🌐 <span data-i18n="ui.settings.internet_access">${title}</span></h3>
                </div>
                <div id="${appId}-internet-grid" class="thinking-grid" role="radiogroup" aria-label="${title}">
                    <div class="thinking-option-card internet-access-card ${isEnabled ? 'selected' : ''}" role="radio" aria-checked="${String(isEnabled)}" tabindex="0" data-value="on">
                        <div class="thinking-option-title" data-i18n="ui.common.on">${translate('ui.common.on', 'On')}</div>
                    </div>
                    <div class="thinking-option-card internet-access-card ${!isEnabled ? 'selected' : ''}" role="radio" aria-checked="${String(!isEnabled)}" tabindex="0" data-value="off">
                        <div class="thinking-option-title" data-i18n="ui.common.off">${translate('ui.common.off', 'Off')}</div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

export function renderModelCard(
    key: string,
    model: IAIModelData,
    isSelected: boolean,
    translate: TranslateFunc,
    viewPolicy: AISettingsViewPolicy,
): string {
    const pricingHtml = renderPricing(model.pricing, translate);
    const contextHtml = renderContextWindow(model.contextWindow, translate, viewPolicy);
    const removeButton =
        model.isCustom === true
            ? `
            <button
                type="button"
                class="ai-model-card-remove ai-model-card-action"
                data-model-remove="${DOMPurify.sanitize(key, PURIFY_CONFIG)}"
                aria-label="${translate('ui.settings.custom_model_remove', 'Remove custom model')}"
                title="${translate('ui.settings.custom_model_remove', 'Remove custom model')}"
            >
                ${translate('ui.settings.custom_model_remove_button', 'Delete')}
            </button>
        `
            : '';

    return `
        <div class="ai-model-card ${isSelected ? 'selected' : ''} ${model.isCustom === true ? 'ai-model-card--custom' : ''}" 
            role="option" 
            aria-selected="${String(isSelected)}" 
            tabindex="0"
            data-model-key="${key}">
            <div class="ai-model-card-copy">
                <div class="model-name">${DOMPurify.sanitize(model.name, PURIFY_CONFIG)}</div>
                <div class="model-desc" data-i18n="${model.descKey ?? ''}">${DOMPurify.sanitize(translate(model.descKey ?? '', model.desc), PURIFY_CONFIG)}</div>
                <div class="model-pricing">${pricingHtml}${contextHtml}</div>
            </div>
            ${removeButton}
        </div>
    `;
}

export function renderCustomModelComposer(appId: string, translate: TranslateFunc): string {
    return `
        <div class="ai-model-card ai-model-card--composer" role="presentation">
            <div class="model-name" data-i18n="ui.settings.custom_model_add">
                ${translate('ui.settings.custom_model_add', 'Add Model')}
            </div>
            <div class="model-desc">
                ${translate('ui.settings.custom_model_id', 'Model ID')}
            </div>
            <div class="model-pricing ai-custom-model-composer-body">
                <div class="ai-key-input-row ai-custom-model-input-row">
                    <input
                        id="${appId}-custom-model-id-input"
                        class="ai-custom-model-input"
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        placeholder="openai/gpt-5.4-nano"
                    />
                </div>
                <button
                    id="${appId}-custom-model-save-btn"
                    class="ai-check-btn ai-custom-model-save-btn"
                    type="button"
                    data-i18n="ui.settings.custom_model_add"
                >
                    ${translate('ui.settings.custom_model_add', 'Add Model')}
                </button>
            </div>
        </div>
    `;
}

export function renderModelStats(modelData: IAIModelData | null, translate: TranslateFunc): string {
    const stats = modelData?.stats;

    if (stats) {
        return `
            <div class="ai-stats-grid">
                <div class="stat-item">
                    <div class="stat-header">
                        <span class="stat-icon-wrapper">⚡</span>
                        <div class="stat-label" data-i18n="ui.gpt.stats.speed">${translate('ui.gpt.stats.speed', 'Speed')}</div>
                    </div>
                    <div class="stat-stars">${renderStars(stats.speed)}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-header">
                        <span class="stat-icon-wrapper">🧠</span>
                        <div class="stat-label" data-i18n="ui.gpt.stats.logic">${translate('ui.gpt.stats.logic', 'Logic')}</div>
                    </div>
                    <div class="stat-stars">${renderStars(stats.logic)}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-header">
                        <span class="stat-icon-wrapper">🎨</span>
                        <div class="stat-label" data-i18n="ui.gpt.stats.creative">${translate('ui.gpt.stats.creative', 'Creative')}</div>
                    </div>
                    <div class="stat-stars">${renderStars(stats.creative)}</div>
                </div>
            </div>
        `;
    }

    return `<div class="model-desc">${translate('ui.settings.stats_unavailable', 'Stats unavailable')}</div>`;
}

function renderPricing(pricing: unknown, translate: TranslateFunc): string {
    if (pricing === null || pricing === undefined) return '';

    if (typeof pricing === 'object') {
        return renderNewPricing(pricing as IAIModelPricing, translate);
    }

    return '';
}

function renderContextWindow(
    contextWindow: number | null | undefined,
    translate: TranslateFunc,
    viewPolicy: AISettingsViewPolicy,
): string {
    if (contextWindow === null || contextWindow === undefined || !Number.isFinite(contextWindow)) {
        return '';
    }

    return `
        <div class="price-row context-row">
            <span class="price-tag context-tag">${translate('ui.settings.context_short', 'Ctx')}: ${DOMPurify.sanitize(viewPolicy.formatCompactContext(contextWindow), PURIFY_CONFIG)}</span>
        </div>
    `;
}

function renderNewPricing(pricing: IAIModelPricing, translate: TranslateFunc): string {
    let html = '';
    const currency = pricing.currency ?? '$';
    const displayCurrency = currency === 'USD' ? '$' : currency;
    const separator = displayCurrency.length > 1 ? ' ' : '';

    const inputCost = pricing.input ?? 0;
    const outputCost = pricing.output ?? 0;
    const isFree = inputCost === 0 && outputCost === 0;

    if (isFree) {
        html += `
            <div class="price-row">
                <span class="price-tag free">${translate('ui.settings.free', 'Free')}</span>
            </div>
        `;
    } else {
        const inPrice =
            pricing.input === undefined
                ? null
                : `${displayCurrency}${separator}${String(pricing.input)}`;

        const outPrice =
            pricing.output === undefined
                ? null
                : `${displayCurrency}${separator}${String(pricing.output)}`;

        if (inPrice !== null && outPrice !== null) {
            html += `
            <div class="price-row">
                <span class="price-tag">${translate('ui.settings.price_input', 'Input')}: ${inPrice}</span>
                <span class="price-tag">${translate('ui.settings.price_output', 'Output')}: ${outPrice}</span>
            </div>
        `;
        }
    }

    return html;
}

function renderStars(count: number): string {
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
