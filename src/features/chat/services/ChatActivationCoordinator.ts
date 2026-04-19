import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ChatUiStateHelper } from './ChatUiStateHelper';

type ChatActivationCoordinatorDeps = {
    aiBridge: AIBridge;
    uiStateHelper: ChatUiStateHelper;
    tryAutoStartAi: () => Promise<boolean>;
    tracer: Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;
};

export class ChatActivationCoordinator {
    public constructor(private readonly _deps: ChatActivationCoordinatorDeps) {}

    public clearInactiveAiErrorTimeout(): void {
        this._deps.uiStateHelper.clearInactiveAiErrorTimeout();
    }

    public async ensureActive(input: HTMLTextAreaElement | null): Promise<boolean> {
        if (this._deps.aiBridge.isActive()) {
            this.clearInactiveAiErrorTimeout();
            return true;
        }

        const started = await this._deps.tryAutoStartAi();
        if (started) {
            this.clearInactiveAiErrorTimeout();
            return true;
        }

        this._deps.uiStateHelper.scheduleInactiveAiError(input);
        return false;
    }
}
