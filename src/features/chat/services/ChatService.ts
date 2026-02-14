import type { IChatAttachment, IChatMessage, IChatResponse } from '../types/chatTypes';
import { logger } from '@/infrastructure/logging/LoggerService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';

export class ChatService {
    constructor(
        private readonly _aiBridge: AIBridge,
        private readonly _i18n: I18nService,
    ) {}

    /**
     * Sends a message through AIBridge to the active AI provider.
     */
    public async sendMessage(
        text: string,
        _history: IChatMessage[],
        attachments: IChatAttachment[],
    ): Promise<IChatResponse> {
        // Validation
        if ((text === '' || text.trim() === '') && attachments.length === 0) {
            return { ok: false, error: 'Message is empty' };
        }

        // AIBridge is guaranteed by constructor injection
        if (!this._aiBridge.isActive()) {
            return {
                ok: false,
                error: this._i18n.t(
                    'ui.ai.no_provider',
                    'No AI module running. Please launch a module first.',
                ),
            };
        }

        try {
            // Send through AIBridge
            const response = await this._aiBridge.sendMessage(text, 'chat', attachments);

            if (!response.ok) {
                return {
                    ok: false,
                    error: response.error ?? 'Unknown bridge error',
                };
            }

            return {
                ok: true,
                message: response.text ?? '',
            };
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : 'Unknown error';
            logger.error(`[ChatService] Error: ${String(e)}`);
            return { ok: false, error: errorMsg };
        }
    }
}
