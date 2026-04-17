import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IChatMessage, IChatResponse } from '../types/chatTypes';

type StreamingMessageHandle = {
    update: (chunk: string) => void;
    replace: (chunk: string) => void;
    discard: () => void;
    finalize: (text: string, stats?: Record<string, unknown>) => void;
};

type ImageGenerationHandle = {
    setStatus: (chunk: string) => void;
    setPreview: (dataUrl: string) => void;
    finalize: (result: {
        text: string;
        images: Array<{ mime: string; data_base64: string }>;
    }) => void;
    fail: (message: string) => void;
    cancel: (message?: string) => void;
    discard: () => void;
};

type ChatGenerationControllerOptions = {
    aiBridge: AIBridge;
    i18n: I18nService;
    removeTyping: (typingId: string) => void;
    appendAssistantMessage: (
        text: string,
        options?: Record<string, unknown>,
    ) => void;
    pushAssistantMessage: (
        content: IChatMessage['content'],
        thoughtSignature?: string,
    ) => void;
    buildGeneratedImageContent: (
        images: Array<{ mime: string; data_base64: string }>,
        text: string,
    ) => IChatMessage['content'];
    estimateReplyTokens: (text: string) => Promise<number>;
    getFriendlyErrorMessage: (errorMsg: unknown, model?: string) => string;
    handleError: (errorMsg: unknown, model?: string) => void;
    isDestroyed: () => boolean;
    isSending: () => boolean;
};

export class ChatGenerationController {
    private _imagePreviewPollTimer: ReturnType<typeof setInterval> | null = null;
    private _imagePreviewPollInFlight = false;
    private _lastImagePreviewUpdatedAtMs = 0;

    constructor(private readonly _options: ChatGenerationControllerOptions) {}

    public cleanupStreamingState(listenerId: string, typingId: string): void {
        this._options.aiBridge.removeChunkListener(listenerId);
        this._options.aiBridge.removeReplaceChunkListener(listenerId);
        this.stopImagePreviewPolling();
        this._options.removeTyping(typingId);
    }

    public isImageProvider(providerId: string | null): boolean {
        return (
            providerId === 'sdcpp' || providerId === 'stable-diffusion' || providerId === 'comfyui'
        );
    }

    public startImagePreviewPolling(handle: ImageGenerationHandle): void {
        this.stopImagePreviewPolling();
        this._lastImagePreviewUpdatedAtMs = 0;
        void this.pollImagePreview(handle);
        this._imagePreviewPollTimer = globalThis.setInterval(() => {
            void this.pollImagePreview(handle);
        }, 850);
    }

    public stopImagePreviewPolling(): void {
        if (this._imagePreviewPollTimer !== null) {
            globalThis.clearInterval(this._imagePreviewPollTimer);
            this._imagePreviewPollTimer = null;
        }
        this._imagePreviewPollInFlight = false;
        this._lastImagePreviewUpdatedAtMs = 0;
    }

    public async pollImagePreview(handle: ImageGenerationHandle): Promise<void> {
        if (
            this._imagePreviewPollInFlight ||
            this._options.isDestroyed() ||
            !this._options.isSending()
        ) {
            return;
        }

        this._imagePreviewPollInFlight = true;

        try {
            const preview = await this._options.aiBridge.getImageGenerationPreview();
            if (
                preview === null ||
                preview.data_url.trim() === '' ||
                preview.updated_at_ms <= this._lastImagePreviewUpdatedAtMs
            ) {
                return;
            }

            this._lastImagePreviewUpdatedAtMs = preview.updated_at_ms;
            handle.setPreview(preview.data_url);
        } catch (error: unknown) {
            tracer.debug('[Chat] Preview polling skipped:', error);
        } finally {
            this._imagePreviewPollInFlight = false;
        }
    }

    public async handleChatResponse(
        response: IChatResponse,
        streamingHandle?: StreamingMessageHandle | null,
        imageHandle?: ImageGenerationHandle | null,
    ): Promise<void> {
        if (!response.ok) {
            this.handleFailedChatResponse(response, imageHandle);
            return;
        }

        await this.handleSuccessfulChatResponse(response, streamingHandle, imageHandle);
    }

    private async handleSuccessfulChatResponse(
        response: IChatResponse,
        streamingHandle?: StreamingMessageHandle | null,
        imageHandle?: ImageGenerationHandle | null,
    ): Promise<void> {
        const rawReply = response.message ?? response.reply?.text ?? '';
        const replyText = this.safeExtractText(rawReply);
        const generatedImages = response.reply?.images ?? [];

        if (generatedImages.length > 0) {
            this.handleGeneratedImages(response, replyText, generatedImages, imageHandle);
            return;
        }

        if (replyText !== '') {
            await this.handleTextReply(response, replyText, streamingHandle);
            return;
        }

        if (streamingHandle) {
            streamingHandle.discard();
            return;
        }

        imageHandle?.discard();
    }

    private handleGeneratedImages(
        response: IChatResponse,
        replyText: string,
        generatedImages: { mime: string; data_base64: string }[],
        imageHandle?: ImageGenerationHandle | null,
    ): void {
        const caption = replyText || this._options.i18n.t('ui.chat.image_ready', 'Generated image');

        if (imageHandle !== null && imageHandle !== undefined) {
            imageHandle.finalize({ text: caption, images: generatedImages });
        } else {
            this._options.appendAssistantMessage(caption, { images: generatedImages });
        }

        this._options.pushAssistantMessage(
            this._options.buildGeneratedImageContent(generatedImages, replyText),
            response.thought_signature,
        );
    }

    private async handleTextReply(
        response: IChatResponse,
        replyText: string,
        streamingHandle?: StreamingMessageHandle | null,
    ): Promise<void> {
        const tokens = await this._options.estimateReplyTokens(replyText);

        if (streamingHandle) {
            streamingHandle.finalize(replyText, { tokens });
        } else {
            this._options.appendAssistantMessage(replyText, { tokens });
        }

        this._options.pushAssistantMessage(replyText, response.thought_signature);
    }

    private handleFailedChatResponse(
        response: IChatResponse,
        imageHandle?: ImageGenerationHandle | null,
    ): void {
        const friendlyMsg = this._options.getFriendlyErrorMessage(response.error ?? '', response.model);
        if (imageHandle !== null && imageHandle !== undefined) {
            imageHandle.fail(friendlyMsg);
            return;
        }

        this._options.handleError(friendlyMsg, response.model);
    }

    private extractFromObject(obj: Record<string, unknown>): string {
        if ('message' in obj && typeof obj['message'] === 'string') return obj['message'];
        if ('error' in obj && typeof obj['error'] === 'string') return obj['error'];
        if ('text' in obj && typeof obj['text'] === 'string') return obj['text'];

        try {
            return JSON.stringify(obj, null, 2);
        } catch {
            return this._options.i18n.t(
                'ui.chat.complex_object_fallback',
                '[Complex object: cannot display]',
            );
        }
    }

    private safeExtractText(data: unknown): string {
        if (Array.isArray(data)) {
            return data
                .map((part) => this.extractTextPart(part))
                .filter((part): part is string => part !== '')
                .join('\n')
                .trim();
        }
        if (typeof data === 'string') return data;
        if (data instanceof Error) return data.message;

        if (typeof data === 'object' && data !== null) {
            return this.extractFromObject(data as Record<string, unknown>);
        }

        return typeof data === 'number' || typeof data === 'boolean' ? String(data) : '';
    }

    private extractTextPart(part: unknown): string {
        if (typeof part !== 'object' || part === null) {
            return '';
        }

        const contentPart = part as { type?: string; text?: string };
        if (contentPart.type === 'text' && typeof contentPart.text === 'string') {
            return contentPart.text;
        }

        return '';
    }
}
