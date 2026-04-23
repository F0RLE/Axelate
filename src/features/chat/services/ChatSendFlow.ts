import { createMultimodalContent } from '@/features/ai/utils/chatRequestUtils';

import type { ChatFileHandler } from './ChatFileHandler';
import type { IChatAttachment, IChatMessage } from '../types/chatTypes';

type ChatSendFlowDeps = {
    fileHandler: Pick<ChatFileHandler, 'getTotalTokenEstimate' | 'processForSend'>;
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
        const tokenCount = await this._deps.fileHandler.getTotalTokenEstimate(text);
        const { attachments, combinedText } = await this._deps.fileHandler.processForSend(text);
        const historyHead = this._deps.getHistory().slice(-40);

        return {
            tokenCount,
            attachments,
            combinedText,
            historyHead,
            userContent: createMultimodalContent(combinedText, attachments),
        };
    }
}
