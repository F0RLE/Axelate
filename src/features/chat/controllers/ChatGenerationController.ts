import type { AIBridge } from '@/features/ai/services/AIBridge';
import { AIBridgeProviderPolicy } from '@/features/ai/services/AIBridgeProviderPolicy';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IChatMessage, IChatResponse } from '../types/chatTypes';

type ChatGenerationLogger = Pick<LoggerService, 'debug'>;

type StreamingMessageHandle = {
    setStatus: (text: string) => void;
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
    appendAssistantMessage: (text: string, options?: Record<string, unknown>) => void;
    pushAssistantMessage: (content: IChatMessage['content'], thoughtSignature?: string) => void;
    extractText: (data: unknown) => string;
    buildGeneratedImageContent: (
        images: Array<{ mime: string; data_base64: string }>,
        text: string,
    ) => IChatMessage['content'];
    estimateReplyTokens: (text: string) => Promise<number>;
    addContextTokens: (tokens: number) => void;
    getFriendlyErrorMessage: (errorMsg: unknown, model?: string) => string;
    handleError: (errorMsg: unknown, model?: string) => void;
    isDestroyed: () => boolean;
    isSending: () => boolean;
    tracer: ChatGenerationLogger;
};

export class ChatGenerationController {
    private static readonly _IMAGE_PREVIEW_POLL_INTERVAL_MS = 850;
    private static readonly _IMAGE_PROGRESS_HEARTBEAT_INTERVAL_MS = 1000;
    private _imagePreviewPollTimer: ReturnType<typeof setTimeout> | null = null;
    private _imageProgressHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    private _imagePreviewPollInFlight = false;
    private _lastImagePreviewUpdatedAtMs = 0;
    private _imageGenerationStartedAtMs = 0;
    private _lastConcreteImageProgressAtMs = 0;
    private readonly _providerPolicy = new AIBridgeProviderPolicy();

    constructor(private readonly _options: ChatGenerationControllerOptions) {}

    public cleanupStreamingState(listenerId: string, typingId: string): void {
        this._options.aiBridge.removeChunkListener(listenerId);
        this._options.aiBridge.removeReplaceChunkListener(listenerId);
        this.stopImagePreviewPolling();
        this._options.removeTyping(typingId);
    }

    public isImageProvider(providerId: string | null): boolean {
        return providerId !== null && this._providerPolicy.isImageProvider(providerId);
    }

    public startImagePreviewPolling(handle: ImageGenerationHandle): void {
        this.stopImagePreviewPolling();
        this._lastImagePreviewUpdatedAtMs = 0;
        this._imageGenerationStartedAtMs = Date.now();
        this._lastConcreteImageProgressAtMs = 0;
        this._scheduleNextImageProgressHeartbeat(handle, 0);
        this._scheduleNextImagePreviewPoll(handle, 0);
    }

    public stopImagePreviewPolling(): void {
        if (this._imagePreviewPollTimer !== null) {
            globalThis.clearTimeout(this._imagePreviewPollTimer);
            this._imagePreviewPollTimer = null;
        }
        if (this._imageProgressHeartbeatTimer !== null) {
            globalThis.clearTimeout(this._imageProgressHeartbeatTimer);
            this._imageProgressHeartbeatTimer = null;
        }
        this._imagePreviewPollInFlight = false;
        this._lastImagePreviewUpdatedAtMs = 0;
        this._imageGenerationStartedAtMs = 0;
        this._lastConcreteImageProgressAtMs = 0;
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
            if (preview === null) {
                return;
            }

            if (typeof preview.progress === 'number' && Number.isFinite(preview.progress)) {
                const percent = Math.max(0, Math.min(100, Math.round(preview.progress * 100)));
                const step =
                    typeof preview.step === 'number' &&
                    Number.isFinite(preview.step) &&
                    typeof preview.total === 'number' &&
                    Number.isFinite(preview.total) &&
                    preview.total > 0
                        ? ` step=${String(Math.max(0, Math.round(preview.step)))} total=${String(Math.max(1, Math.round(preview.total)))}`
                        : '';
                const speed =
                    typeof preview.speed === 'string' && preview.speed.trim() !== ''
                        ? ` speed=${preview.speed.trim()}`
                        : '';
                const eta =
                    typeof preview.eta_relative === 'number' &&
                    Number.isFinite(preview.eta_relative)
                        ? ` eta=${String(Math.max(0, Math.round(preview.eta_relative)))}s`
                        : '';
                this._lastConcreteImageProgressAtMs = Date.now();
                handle.setStatus(
                    `image status=running percent=${String(percent)}${step}${speed}${eta}`,
                );
            }

            if (
                preview.data_url.trim() === '' ||
                preview.updated_at_ms <= this._lastImagePreviewUpdatedAtMs
            ) {
                return;
            }

            this._lastImagePreviewUpdatedAtMs = preview.updated_at_ms;
            handle.setPreview(preview.data_url);
        } catch (error: unknown) {
            this._options.tracer.debug('[Chat] Preview polling skipped:', error);
        } finally {
            this._imagePreviewPollInFlight = false;
            if (!this._options.isDestroyed() && this._options.isSending()) {
                this._scheduleNextImagePreviewPoll(
                    handle,
                    ChatGenerationController._IMAGE_PREVIEW_POLL_INTERVAL_MS,
                );
            }
        }
    }

    private _scheduleNextImagePreviewPoll(handle: ImageGenerationHandle, delayMs: number): void {
        if (this._options.isDestroyed() || !this._options.isSending()) {
            return;
        }

        if (this._imagePreviewPollTimer !== null) {
            globalThis.clearTimeout(this._imagePreviewPollTimer);
        }

        this._imagePreviewPollTimer = globalThis.setTimeout(() => {
            this._imagePreviewPollTimer = null;
            void this.pollImagePreview(handle);
        }, delayMs);
    }

    private _scheduleNextImageProgressHeartbeat(
        handle: ImageGenerationHandle,
        delayMs: number,
    ): void {
        if (this._options.isDestroyed() || !this._options.isSending()) {
            return;
        }

        if (this._imageProgressHeartbeatTimer !== null) {
            globalThis.clearTimeout(this._imageProgressHeartbeatTimer);
        }

        this._imageProgressHeartbeatTimer = globalThis.setTimeout(() => {
            this._imageProgressHeartbeatTimer = null;
            this._emitImageProgressHeartbeat(handle);
        }, delayMs);
    }

    private _emitImageProgressHeartbeat(handle: ImageGenerationHandle): void {
        if (this._options.isDestroyed() || !this._options.isSending()) {
            return;
        }

        const now = Date.now();
        const elapsedSeconds =
            this._imageGenerationStartedAtMs === 0
                ? 0
                : Math.max(0, Math.round((now - this._imageGenerationStartedAtMs) / 1000));
        const hasFreshConcreteProgress =
            this._lastConcreteImageProgressAtMs !== 0 &&
            now - this._lastConcreteImageProgressAtMs <
                ChatGenerationController._IMAGE_PROGRESS_HEARTBEAT_INTERVAL_MS * 2;

        if (!hasFreshConcreteProgress) {
            handle.setStatus(`image status=running elapsed=${String(elapsedSeconds)}s`);
        }

        this._scheduleNextImageProgressHeartbeat(
            handle,
            ChatGenerationController._IMAGE_PROGRESS_HEARTBEAT_INTERVAL_MS,
        );
    }

    public async handleChatResponse(
        response: IChatResponse,
        streamingHandle?: StreamingMessageHandle | null,
        imageHandle?: ImageGenerationHandle | null,
    ): Promise<void> {
        if (!response.ok) {
            this.handleFailedChatResponse(response, streamingHandle, imageHandle);
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
        const replyText = this._options.extractText(rawReply);
        const generatedImages = response.reply?.images ?? [];

        if (generatedImages.length > 0) {
            await this.handleGeneratedImages(response, replyText, generatedImages, imageHandle);
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

    private async handleGeneratedImages(
        response: IChatResponse,
        replyText: string,
        generatedImages: { mime: string; data_base64: string }[],
        imageHandle?: ImageGenerationHandle | null,
    ): Promise<void> {
        const captionTokens =
            replyText.trim() === '' ? 0 : await this._options.estimateReplyTokens(replyText);
        this._options.addContextTokens(captionTokens + generatedImages.length * 258);

        if (imageHandle !== null && imageHandle !== undefined) {
            imageHandle.finalize({ text: replyText, images: generatedImages });
        } else {
            this._options.appendAssistantMessage(replyText, { images: generatedImages });
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
        const tokens = await this._resolveBackendCompletionTokens(response, replyText);
        if (tokens > 0) {
            this._options.addContextTokens(tokens);
        }

        if (streamingHandle) {
            streamingHandle.finalize(replyText, { tokens });
        } else {
            this._options.appendAssistantMessage(replyText, { tokens });
        }

        this._options.pushAssistantMessage(replyText, response.thought_signature);
    }

    private async _resolveBackendCompletionTokens(
        response: IChatResponse,
        replyText: string,
    ): Promise<number> {
        const completionTokens = response.usage?.completion_tokens;
        if (typeof completionTokens !== 'number' || !Number.isFinite(completionTokens)) {
            try {
                const estimatedTokens = await this._options.estimateReplyTokens(replyText);
                if (!Number.isFinite(estimatedTokens)) {
                    return 0;
                }
                return Math.max(0, Math.trunc(estimatedTokens));
            } catch {
                return 0;
            }
        }

        return Math.max(0, Math.trunc(completionTokens));
    }

    private handleFailedChatResponse(
        response: IChatResponse,
        streamingHandle?: StreamingMessageHandle | null,
        imageHandle?: ImageGenerationHandle | null,
    ): void {
        const friendlyMsg = this._options.getFriendlyErrorMessage(
            response.error ?? '',
            response.model,
        );
        if (imageHandle !== null && imageHandle !== undefined) {
            imageHandle.fail(friendlyMsg);
            return;
        }

        streamingHandle?.discard();
        this._options.handleError(friendlyMsg, response.model);
    }
}
