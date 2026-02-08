/**
 * @module chat/services/ChatService
 * @description Service for sending messages through AIBridge
 */

import type { IChatAttachment, IChatMessage, IChatResponse } from '../types/chatTypes';
import type { TGlobalWin } from '../../core/types/global_bridge_types';
import { logger } from '../../core/services/LoggerService';

export class ChatService {
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
        const win = globalThis as TGlobalWin;
        const aiBridge = win.aiBridge;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (win.aiBridge === undefined) {
            const t = win.t;
            return {
                ok: false,
                error: t('ui.ai.bridge_not_ready', 'AI Bridge not initialized'),
            };
        }

        if (typeof aiBridge.isActive === 'function' && !(aiBridge.isActive as () => boolean)()) {
            const t = win.t;
            return {
                ok: false,
                error: t(
                    'ui.ai.no_provider',
                    'No AI module running. Please launch a module first.',
                ),
            };
        }

        try {
            // Send through AIBridge
            const response = await (
                aiBridge.sendMessage as (
                    _t: string,
                    _s: string,
                    _a: IChatAttachment[],
                ) => Promise<string>
            )(text, 'chat', _attachments);

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
