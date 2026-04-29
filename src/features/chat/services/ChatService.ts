import type { IChatAttachment, IChatMessage, IChatResponse } from '../types/chatTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IAIBridge } from '@/features/ai/types/IAIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';

type ChatServiceLogger = Pick<LoggerService, 'error'>;
export type ChatSendOptions = {
    originalPrompt?: string;
};

function parseGeneratedImages(
    images: string[] | undefined,
): Array<{ mime: string; data_base64: string }> | undefined {
    if (!Array.isArray(images) || images.length === 0) {
        return undefined;
    }

    const parsed = images
        .map((image) => {
            const match = /^data:([^;]+);base64,(.+)$/u.exec(image);
            if (match === null) {
                return null;
            }

            return {
                mime: match[1] ?? 'image/png',
                data_base64: match[2] ?? '',
            };
        })
        .filter(
            (
                image,
            ): image is {
                mime: string;
                data_base64: string;
            } => image !== null && image.data_base64 !== '',
        );

    return parsed.length > 0 ? parsed : undefined;
}

export class ChatService {
    constructor(
        private readonly _aiBridge: IAIBridge,
        private readonly _i18n: I18nService,
        private readonly _tracer: ChatServiceLogger,
    ) {}

    /**
     * Sends a message through AIBridge to the active AI provider.
     */
    public async sendMessage(
        text: string,
        history: IChatMessage[],
        attachments: IChatAttachment[],
        options: ChatSendOptions = {},
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
            const response = await this._aiBridge.sendMessage(
                text,
                'chat',
                attachments,
                history,
                options,
            );

            if (!response.ok) {
                const result: IChatResponse = {
                    ok: false,
                    error: response.error ?? 'Unknown bridge error',
                };
                if (response.model !== undefined) {
                    result.model = response.model;
                }
                return result;
            }

            const result: IChatResponse = {
                ok: true,
                message: response.text ?? '',
            };
            const generatedImages = parseGeneratedImages(response.images);
            if (generatedImages !== undefined) {
                result.reply = {
                    text: response.text ?? '',
                    type: 'markdown',
                    images: generatedImages,
                };
            }
            if (response.thought_signature !== undefined) {
                result.thought_signature = response.thought_signature;
            }
            if (response.model !== undefined) {
                result.model = response.model;
            }
            if (response.usage !== undefined) {
                result.usage = response.usage;
            }
            return result;
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : 'Unknown error';
            this._tracer.error('[ChatService] Error:', e);
            return { ok: false, error: errorMsg };
        }
    }
}
