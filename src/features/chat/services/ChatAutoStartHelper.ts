import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IApp } from '@/shared/types/coreTypes';

type ChatAutoStartLogger = Pick<LoggerService, 'info'>;

type ChatAutoStartHelperDeps = {
    aiBridge: Pick<AIBridge, 'startProvider'>;
    getSelectedModule: (category: 'ai_text' | 'ai_image') => Partial<IApp> | undefined;
    getPreferredAiCategory: () => 'ai_text' | 'ai_image';
    tracer: ChatAutoStartLogger;
};

type AiChatCategory = 'ai_text' | 'ai_image';

export class ChatAutoStartHelper {
    public constructor(private readonly _deps: ChatAutoStartHelperDeps) {}

    public resolveSelectedModuleId(prompt?: string): string | null {
        const preferredCategory = this._resolvePreferredCategory(prompt);
        const preferredModuleId = this._getModuleId(preferredCategory);
        if (preferredModuleId !== null) {
            return preferredModuleId;
        }

        const fallbackCategory = preferredCategory === 'ai_text' ? 'ai_image' : 'ai_text';
        return this._getModuleId(fallbackCategory);
    }

    public async startSelectedModule(prompt?: string): Promise<boolean> {
        const moduleId = this.resolveSelectedModuleId(prompt);
        if (moduleId === null) {
            return false;
        }

        this._deps.tracer.info(`[Chat] Auto-starting selected module: ${moduleId}`);
        const button = document.getElementById('chat-actions-send');

        try {
            this._setButtonLoading(button, true);
            return await this._deps.aiBridge.startProvider(moduleId);
        } finally {
            this._setButtonLoading(button, false);
        }
    }

    private _getModuleId(category: 'ai_text' | 'ai_image'): string | null {
        const module = this._deps.getSelectedModule(category);
        return module?.id !== undefined && module.id !== '' ? module.id : null;
    }

    private _resolvePreferredCategory(prompt?: string): AiChatCategory {
        if (prompt === undefined) {
            return this._deps.getPreferredAiCategory();
        }

        if (this._isImageGenerationPrompt(prompt)) {
            return 'ai_image';
        }

        if (this._getModuleId('ai_text') !== null) {
            return 'ai_text';
        }

        return this._deps.getPreferredAiCategory();
    }

    private _isImageGenerationPrompt(prompt?: string): boolean {
        const normalizedPrompt = prompt?.trim().toLowerCase() ?? '';
        if (normalizedPrompt === '') {
            return false;
        }

        const hasImageNoun =
            /(image|picture|photo|art|illustration|картин|изображ|фото|арт|рисунок|иллюстрац)/u.test(
                normalizedPrompt,
            );
        const hasGenerationVerb =
            /(generate|create|draw|paint|render|make|сгенерир|созда|нарис|сделай|сделать|изобраз)/u.test(
                normalizedPrompt,
            );
        const directDrawRequest =
            /(^|\s)(draw|paint|render|нарисуй|нарисовать|изобрази)(\s|$)/u.test(normalizedPrompt);

        return directDrawRequest || (hasImageNoun && hasGenerationVerb);
    }

    private _setButtonLoading(button: HTMLElement | null, loading: boolean): void {
        if (!(button instanceof HTMLElement)) {
            return;
        }

        button.classList.toggle('loading', loading);
        if (loading) {
            button.setAttribute('disabled', 'true');
            return;
        }

        button.removeAttribute('disabled');
    }
}
