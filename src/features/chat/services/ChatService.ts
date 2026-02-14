import type { IChatAttachment, IChatMessage, IChatResponse } from '../types/chatTypes';
import { logger } from '@/shared/services/LoggerService';
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
        _attachments: IChatAttachment[],
    ): Promise<IChatResponse> {
        // Validation
        if ((text === '' || text.trim() === '') && _attachments.length === 0) {
            return { ok: false, error: 'Message is empty' };
        }

        // Check if AIBridge is available and has active provider
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this._aiBridge === undefined) {
            return {
                ok: false,
                error: this._i18n.t('ui.ai.bridge_not_ready', 'AI Bridge not initialized'),
            };
        }

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
            const response = await this._aiBridge.sendMessage(text, 'chat', _attachments);

            // Handle potential error string from bridge
            if (response.startsWith('Error: ')) {
                return {
                    ok: false,
                    error: response.replace('Error: ', ''),
                };
            }

            return {
                ok: true,
                message: response,
            };
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : 'Unknown error';
            logger.error(`[ChatService] Error: ${String(e)}`);
            return { ok: false, error: errorMsg };
        }
    }
}
