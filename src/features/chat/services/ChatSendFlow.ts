import { createMultimodalContent } from '@/features/ai/utils/chatRequestUtils';

import type { ChatFileHandler } from './ChatFileHandler';
import type { IChatAttachment, IChatMessage } from '../types/chatTypes';

type ChatSendFlowDeps = {
    fileHandler: Pick<ChatFileHandler, 'processForSend'>;
    getHistory: () => IChatMessage[];
    estimateTokens: (text: string) => Promise<number>;
};

export type PreparedChatSend = {
    tokenCount: number;
    attachments: IChatAttachment[];
    combinedText: string;
    historyHead: IChatMessage[];
    userContent: IChatMessage['content'];
};

export class ChatSendFlow {
    public constructor(private readonly _deps: ChatSendFlowDeps) {}

    public async prepare(text: string): Promise<PreparedChatSend> {
        const { attachments, combinedText } = await this._deps.fileHandler.processForSend(text);
        const historyHead = this._deps.getHistory().slice(-40);
        const imageTokens = attachments.reduce((total, attachment) => {
            if (!attachment.type.startsWith('image/')) {
                return total;
            }
            const tokens = attachment.tokens;
            return total + (typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0);
        }, 0);
        const textTokens = await this._resolveTextTokens(combinedText);

        return {
            tokenCount: textTokens + imageTokens,
            attachments,
            combinedText,
            historyHead,
            userContent: createMultimodalContent(combinedText, attachments),
        };
    }

    private async _resolveTextTokens(text: string): Promise<number> {
        const trimmed = text.trim();
        if (trimmed === '') {
            return 0;
        }

        try {
            const tokens = await this._deps.estimateTokens(trimmed);
            return Number.isFinite(tokens) ? Math.max(0, Math.trunc(tokens)) : 0;
        } catch {
            return 0;
        }
    }
}
