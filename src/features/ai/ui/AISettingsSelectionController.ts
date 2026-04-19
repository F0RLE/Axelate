import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { IAIModelData } from '../types/aiTypes';
import { getModelDataFromModels } from '../utils/catalogHelpers';
import { renderModelStats } from './AISettingsMarkup';
import type { AISettingsContentRenderer } from './AISettingsContentRenderer';

type TranslateFunc = (key: string, fallback: string) => string;

type AISettingsSelectionRenderState = {
    appId: string;
    container: HTMLElement;
    models: IAIModelData[];
};

type AISettingsSelectionSyncOptions = {
    appId: string;
    modelKey: string;
    aiSettings: AISettingsService | null;
    translate: TranslateFunc;
    i18nUI: I18nUI | null;
    contentRenderer: AISettingsContentRenderer;
};

export class AISettingsSelectionController {
    private _activeState: AISettingsSelectionRenderState | null = null;
    private readonly _modelsByProvider = new Map<string, IAIModelData[]>();

    public reset(): void {
        this._activeState = null;
        this._modelsByProvider.clear();
    }

    public registerRender(state: AISettingsSelectionRenderState): void {
        this._activeState = state;
        this._modelsByProvider.set(state.appId, state.models);
    }

    public queryActiveElement<T extends Element>(selector: string): T | null {
        return this._activeState?.container.querySelector<T>(selector) ?? null;
    }

    public getSavedModel(
        appId: string,
        aiSettings: AISettingsService | null,
        fallbackModelId: string,
    ): string {
        return aiSettings?.getSelectedAIModel(appId) ?? fallbackModelId;
    }

    public getThinkingLevel(
        appId: string,
        aiSettings: AISettingsService | null,
    ): ThinkingLevel | null | undefined {
        return aiSettings?.getThinkingLevel(appId);
    }

    public getInternetAccessEnabled(appId: string, aiSettings: AISettingsService | null): boolean {
        return aiSettings?.getInternetAccessEnabled(appId) ?? true;
    }

    public renderModelStats(appId: string, modelKey: string, translate: TranslateFunc): string {
        const modelData = this.getModelData(appId, modelKey);
        return renderModelStats(modelData, translate);
    }

    public syncSelection(options: AISettingsSelectionSyncOptions): void {
        options.aiSettings?.setSelectedAIModel(options.appId, options.modelKey);

        const modelData = this.getModelData(options.appId, options.modelKey);
        const hasReasoning = modelData?.capabilities?.reasoning === true;
        const statsMarkup = this._buildStatsMarkup(
            options.appId,
            options.modelKey,
            options.translate,
        );

        options.contentRenderer.syncSelectedModelView(
            this._activeState?.container ?? null,
            options.appId,
            options.modelKey,
            hasReasoning,
            statsMarkup,
            options.i18nUI,
        );
    }

    private _buildStatsMarkup(
        appId: string,
        modelKey: string,
        translate: TranslateFunc,
    ): string {
        return `
            <div class="ai-content-panel">
                <div class="settings-card-header-center">
                    <h3>📊 <span data-i18n="ui.settings.model_stats">${translate('ui.settings.model_stats', 'Model Stats')}</span></h3>
                </div>
                ${this.renderModelStats(appId, modelKey, translate)}
            </div>
        `;
    }

    private getModelData(appId: string, modelKey: string): IAIModelData | null {
        return getModelDataFromModels(this._modelsByProvider.get(appId) ?? [], modelKey);
    }
}
