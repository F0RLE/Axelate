import { createMultimodalContent } from '@/features/ai/utils/chatRequestUtils';

import type { ChatFileHandler } from './ChatFileHandler';
import type { IChatAttachment, IChatMessage } from '../types/chatTypes';

const estimateTextTokens = (text: string): number => {
    const normalized = text.trim();
    return normalized === '' ? 0 : Math.max(1, Math.ceil(normalized.length / 4));
};

type ChatSendFlowDeps = {
    fileHandler: Pick<ChatFileHandler, 'processForSend'>;
    getHistory: () => IChatMessage[];
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
        const attachmentTokens = attachments.reduce((total, attachment) => {
            const tokens = attachment.tokens;
            return total + (typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0);
        }, 0);
        const textTokens = estimateTextTokens(text);

        return {
            tokenCount: textTokens + attachmentTokens,
            attachments,
            combinedText,
            historyHead,
            userContent: createMultimodalContent(combinedText, attachments),
        };
    }
}
