import { createMultimodalContent } from '@/features/ai/utils/chatRequestUtils';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { chatFileHandler } from '../services/ChatFileHandler';
import type { ChatService } from '../services/ChatService';
import type { IChatMessage, IChatAttachment } from '../types/chatTypes';

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

type ChatSendControllerOptions = {
    aiBridge: AIBridge;
    service: ChatService;
    getHistory: () => IChatMessage[];
    pushUserMessage: (content: IChatMessage['content']) => void;
    createStreamingHandle: (typingId: string) => StreamingMessageHandle;
    createImageHandle: (
        text: string,
        onRegenerate: () => Promise<void>,
    ) => ImageGenerationHandle;
    showTyping: (typingId: string) => void;
    registerReplaceChunk: (
        listenerId: string,
        imageHandleRef: () => ImageGenerationHandle | null,
        streamingHandleRef: () => StreamingMessageHandle | null,
    ) => void;
    clearInput: () => void;
    updateTokenCount: (count: number) => void;
    appendUserMessage: (text: string, attachments: IChatAttachment[], tokens: number) => void;
    handleResponse: (
        response: Awaited<ReturnType<ChatService['sendMessage']>>,
        streamingHandle: StreamingMessageHandle | null,
        imageHandle: ImageGenerationHandle | null,
    ) => Promise<void>;
    cleanupStreamingState: (listenerId: string, typingId: string) => void;
    stopImagePreviewPolling: () => void;
    startImagePreviewPolling: (handle: ImageGenerationHandle) => void;
    restoreInputText: (text: string) => void;
    isImageProvider: (providerId: string | null) => boolean;
    lockUi: (input: HTMLTextAreaElement | null) => {
        input: HTMLTextAreaElement | null;
        sendBtn: HTMLButtonElement | null;
        voiceBtn: HTMLButtonElement | null;
        attachBtn: HTMLButtonElement | null;
    };
    unlockUi: (els: UiLock) => void;
    handleError: (error: unknown) => void;
    isSending: () => boolean;
    setSending: (value: boolean) => void;
};

type UiLock = ReturnType<ChatSendControllerOptions['lockUi']>;

export class ChatSendController {
    constructor(private readonly _options: ChatSendControllerOptions) {}

    public destroy(): void {}

    public validateInput(text: string): boolean {
        if (!text && !chatFileHandler.hasFiles()) {
            return false;
        }
        return true;
    }

    public async sendChat(input: HTMLTextAreaElement | null): Promise<boolean> {
        if (this._options.isSending()) return false;

        const text = input?.value.trim() ?? '';

        const uiElements = this._options.lockUi(input);
        const typingId = `typing-${String(Date.now())}`;
        const listenerId = `chat-stream-${String(Date.now())}`;
        const activeProviderId = this._options.aiBridge.getState().activeProviderId;
        const isImageProvider = this._options.isImageProvider(activeProviderId);

        this._options.setSending(true);

        try {
            const tokenCount = await chatFileHandler.getTotalTokenEstimate(text);
            const { attachments, combinedText } = await chatFileHandler.processForSend(text);
            const historyHead = this._options.getHistory().slice(-40);

            this._options.clearInput();
            this._options.updateTokenCount(0);
            this._options.appendUserMessage(text, attachments, tokenCount);
            this._options.pushUserMessage(createMultimodalContent(combinedText, attachments));

            let streamingHandle: StreamingMessageHandle | null = null;
            let imageHandle: ImageGenerationHandle | null = null;

            const ensureStreamingHandle = (): StreamingMessageHandle => {
                streamingHandle ??= this._options.createStreamingHandle(typingId);
                return streamingHandle;
            };

            const queueRegenerate = async (): Promise<void> => {
                this._options.restoreInputText(text);
                await this.sendChat(input);
            };

            if (isImageProvider) {
                imageHandle = this._options.createImageHandle(text, queueRegenerate);
                this._options.startImagePreviewPolling(imageHandle);
            } else {
                this._options.showTyping(typingId);
                this._options.aiBridge.onChunk(listenerId, (chunk) => {
                    ensureStreamingHandle().update(chunk);
                });
            }

            this._options.registerReplaceChunk(
                listenerId,
                () => imageHandle,
                () => streamingHandle ?? ensureStreamingHandle(),
            );

            const response = await this._options.service.sendMessage(
                combinedText,
                historyHead,
                attachments,
            );

            this._options.cleanupStreamingState(listenerId, typingId);
            await this._options.handleResponse(response, streamingHandle, imageHandle);
            return true;
        } catch (error: unknown) {
            this._options.cleanupStreamingState(listenerId, typingId);
            this._options.handleError(error);
            return false;
        } finally {
            this._options.unlockUi(uiElements);
            this._options.setSending(false);
        }
    }

    public async tryAutoStartAi(): Promise<boolean> {
        const textModule = uiState.getSelectedModule('ai_text');
        const imageModule = uiState.getSelectedModule('ai_image');
        const selectedModule =
            textModule?.id !== undefined && textModule.id !== '' ? textModule : imageModule;

        if (selectedModule?.id === undefined || selectedModule.id === '') return false;

        tracer.info(`[Chat] Auto-starting selected module: ${selectedModule.id}`);
        const btn = document.getElementById('chat-actions-send');
        if (btn) {
            btn.classList.add('loading');
            btn.setAttribute('disabled', 'true');
        }

        const started = await this._options.aiBridge.startProvider(selectedModule.id);

        if (btn) {
            btn.classList.remove('loading');
            btn.removeAttribute('disabled');
        }

        return started;
    }
}
