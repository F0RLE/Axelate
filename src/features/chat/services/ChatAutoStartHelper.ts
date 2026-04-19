import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IApp } from '@/shared/types/coreTypes';

type ChatAutoStartLogger = Pick<LoggerService, 'info'>;

type ChatAutoStartHelperDeps = {
    aiBridge: Pick<AIBridge, 'startProvider'>;
    getSelectedModule: (category: 'ai_text' | 'ai_image') => Partial<IApp> | undefined;
    tracer: ChatAutoStartLogger;
};

export class ChatAutoStartHelper {
    public constructor(private readonly _deps: ChatAutoStartHelperDeps) {}

    public resolveSelectedModuleId(): string | null {
        const textModuleId = this._getModuleId('ai_text');
        if (textModuleId !== null) {
            return textModuleId;
        }

        return this._getModuleId('ai_image');
    }

    public async startSelectedModule(): Promise<boolean> {
        const moduleId = this.resolveSelectedModuleId();
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
