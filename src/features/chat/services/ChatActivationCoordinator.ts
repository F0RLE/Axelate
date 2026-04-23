import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ChatUiStateHelper } from './ChatUiStateHelper';

type ChatActivationCoordinatorDeps = {
    aiBridge: AIBridge;
    uiStateHelper: ChatUiStateHelper;
    getSelectedProviderId: () => string | null;
    tryAutoStartAi: () => Promise<boolean>;
    tracer: Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;
};

export class ChatActivationCoordinator {
    public constructor(private readonly _deps: ChatActivationCoordinatorDeps) {}

    public clearInactiveAiErrorTimeout(): void {
        this._deps.uiStateHelper.clearInactiveAiErrorTimeout();
    }

    public async ensureActive(input: HTMLTextAreaElement | null): Promise<boolean> {
        const selectedProviderId = this._deps.getSelectedProviderId();
        const { activeProviderId } = this._deps.aiBridge.getState();

        if (selectedProviderId === null) {
            if (activeProviderId !== null) {
                this._deps.tracer.warn(
                    `[Chat] Dropping stale active provider without selected card: ${activeProviderId}`,
                );
                this._deps.aiBridge.stopProvider();
            }

            this._deps.uiStateHelper.scheduleInactiveAiError(input);
            return false;
        }

        if (this._deps.aiBridge.isActive() && activeProviderId === selectedProviderId) {
            this.clearInactiveAiErrorTimeout();
            return true;
        }

        if (activeProviderId !== null && activeProviderId !== selectedProviderId) {
            this._deps.tracer.info(
                `[Chat] Switching stale active provider ${activeProviderId} -> ${selectedProviderId}`,
            );
            this._deps.aiBridge.stopProvider();
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
