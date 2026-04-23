import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ChatFileHandler } from '../services/ChatFileHandler';
import type { ChatService } from '../services/ChatService';
import type { IChatMessage, IChatAttachment } from '../types/chatTypes';
import type { IApp } from '@/shared/types/coreTypes';
import { ChatAutoStartHelper } from '../services/ChatAutoStartHelper';
import { ChatSendFlow } from '../services/ChatSendFlow';

type ChatSendLogger = Pick<LoggerService, 'info'>;

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
    fileHandler: Pick<ChatFileHandler, 'hasFiles' | 'getTotalTokenEstimate' | 'processForSend'>;
    service: ChatService;
    getHistory: () => IChatMessage[];
    pushUserMessage: (content: IChatMessage['content']) => void;
    createStreamingHandle: (typingId: string) => StreamingMessageHandle;
    createImageHandle: (text: string, onRegenerate: () => Promise<void>) => ImageGenerationHandle;
    showTyping: (typingId: string) => void;
    registerReplaceChunk: (
        listenerId: string,
        imageHandleRef: () => ImageGenerationHandle | null,
        streamingHandleRef: () => StreamingMessageHandle | null,
    ) => void;
    clearInput: () => void;
    updateTokenCount: (count: number) => void;
    appendUserMessage: (text: string, attachments: IChatAttachment[], tokens: number) => void;
    getSelectedModule: (category: 'ai_text' | 'ai_image') => Partial<IApp> | undefined;
    getPreferredAiCategory: () => 'ai_text' | 'ai_image';
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
    tracer: ChatSendLogger;
};

type UiLock = ReturnType<ChatSendControllerOptions['lockUi']>;

export class ChatSendController {
    private readonly _autoStartHelper: ChatAutoStartHelper;
    private readonly _sendFlow: ChatSendFlow;

    constructor(private readonly _options: ChatSendControllerOptions) {
        this._autoStartHelper = new ChatAutoStartHelper({
            aiBridge: _options.aiBridge,
            getSelectedModule: _options.getSelectedModule,
            getPreferredAiCategory: _options.getPreferredAiCategory,
            tracer: _options.tracer,
        });
        this._sendFlow = new ChatSendFlow({
            fileHandler: _options.fileHandler,
            getHistory: _options.getHistory,
        });
    }

    public destroy(): void {}

    public validateInput(text: string): boolean {
        return text !== '' || this._options.fileHandler.hasFiles();
    }

    public resolveSelectedModuleId(): string | null {
        return this._autoStartHelper.resolveSelectedModuleId();
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
            const sendPlan = await this._sendFlow.prepare(text);

            this._options.clearInput();
            this._options.updateTokenCount(0);
            this._options.appendUserMessage(text, sendPlan.attachments, sendPlan.tokenCount);
            this._options.pushUserMessage(sendPlan.userContent);

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
                streamingHandle = ensureStreamingHandle();
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
                sendPlan.combinedText,
                sendPlan.historyHead,
                sendPlan.attachments,
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
        return await this._autoStartHelper.startSelectedModule();
    }
}
