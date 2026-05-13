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
    setStatus: (text: string) => void;
    update: (chunk: string) => void;
    replace: (chunk: string) => void;
    cancel: () => void;
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
    fileHandler: Pick<ChatFileHandler, 'hasFiles' | 'processForSend'>;
    service: ChatService;
    getHistory: () => IChatMessage[];
    pushUserMessage: (content: IChatMessage['content']) => void;
    createStreamingHandle: (typingId: string) => StreamingMessageHandle;
    createImageHandle: () => ImageGenerationHandle;
    translate: (key: string, fallback: string) => string;
    showTyping: (typingId: string) => void;
    registerReplaceChunk: (
        listenerId: string,
        imageHandleRef: () => ImageGenerationHandle | null,
        streamingHandleRef: () => StreamingMessageHandle | null,
    ) => void;
    clearInput: () => void;
    addContextTokens: (count: number) => void;
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
    cancelTextGeneration: () => Promise<boolean>;
    isImageProvider: (providerId: string | null) => boolean;
    lockUi: (input: HTMLTextAreaElement | null) => {
        input: HTMLTextAreaElement | null;
        sendBtn: HTMLButtonElement | null;
        voiceBtn: HTMLButtonElement | null;
        attachBtn: HTMLButtonElement | null;
        contextBtn: HTMLButtonElement | null;
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
    private readonly _activeStreamingStates = new Map<
        string,
        { listenerId: string; typingId: string }
    >();
    private _isDestroyed = false;
    private _cancelRequested = false;

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

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;

        for (const state of this._activeStreamingStates.values()) {
            this._options.cleanupStreamingState(state.listenerId, state.typingId);
        }
        this._activeStreamingStates.clear();
        this._options.stopImagePreviewPolling();
        this._options.setSending(false);
    }

    public async cancelActiveSend(): Promise<void> {
        if (!this._options.isSending() && this._activeStreamingStates.size === 0) {
            return;
        }

        this._cancelRequested = true;
        await this._options.cancelTextGeneration();
    }

    public validateInput(text: string): boolean {
        return text !== '' || this._options.fileHandler.hasFiles();
    }

    public resolveSelectedModuleId(prompt?: string): string | null {
        return this._autoStartHelper.resolveSelectedModuleId(prompt);
    }

    public async sendChat(input: HTMLTextAreaElement | null): Promise<boolean> {
        if (this._isDestroyed || this._options.isSending()) return false;

        const text = input?.value.trim() ?? '';

        const uiElements = this._options.lockUi(input);
        const typingId = `typing-${String(Date.now())}`;
        const listenerId = `chat-stream-${String(Date.now())}`;
        const activeProviderId = this._options.aiBridge.getState().activeProviderId;
        const isImageProvider = this._options.isImageProvider(activeProviderId);

        this._cancelRequested = false;
        this._options.setSending(true);
        this._activeStreamingStates.set(listenerId, { listenerId, typingId });

        let streamingHandle: StreamingMessageHandle | null = null;
        let imageHandle: ImageGenerationHandle | null = null;

        try {
            const sendPlan = await this._sendFlow.prepare(text);
            if (this._wasDestroyed()) return false;

            this._options.clearInput();
            this._options.addContextTokens(sendPlan.tokenCount);
            this._options.appendUserMessage(text, sendPlan.attachments, sendPlan.tokenCount);
            this._options.pushUserMessage(sendPlan.userContent);

            const ensureStreamingHandle = (): StreamingMessageHandle => {
                streamingHandle ??= this._options.createStreamingHandle(typingId);
                return streamingHandle;
            };

            if (isImageProvider) {
                imageHandle = this._options.createImageHandle();
                this._options.startImagePreviewPolling(imageHandle);
            } else {
                const handle = ensureStreamingHandle();
                handle.setStatus(this._options.translate('ui.chat.thinking', 'Thinking...'));

                this._options.aiBridge.onChunk(listenerId, (chunk) => {
                    if (String(chunk).trim() === '') {
                        return;
                    }

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

            this._cleanupStreamingState(listenerId, typingId);
            if (this._wasDestroyed()) return false;
            if (this._isCancelRequested()) {
                this._cancelStreamingHandle(streamingHandle);
                imageHandle?.cancel();
                return false;
            }

            await this._options.handleResponse(response, streamingHandle, imageHandle);
            return true;
        } catch (error: unknown) {
            this._cleanupStreamingState(listenerId, typingId);
            if (this._isCancelRequested()) {
                this._cancelStreamingHandle(streamingHandle);
                imageHandle?.cancel();
                return false;
            }
            if (!this._wasDestroyed()) {
                this._options.handleError(error);
            } else {
                this._cancelStreamingHandle(streamingHandle);
                imageHandle?.cancel();
            }
            return false;
        } finally {
            if (imageHandle !== null) {
                this._options.stopImagePreviewPolling();
            }
            if (!this._wasDestroyed()) {
                this._options.unlockUi(uiElements);
            }
            this._options.setSending(false);
        }
    }

    private _wasDestroyed(): boolean {
        return this._isDestroyed;
    }

    private _isCancelRequested(): boolean {
        return this._cancelRequested;
    }

    private _cleanupStreamingState(listenerId: string, typingId: string): void {
        if (!this._activeStreamingStates.delete(listenerId)) {
            return;
        }

        this._options.cleanupStreamingState(listenerId, typingId);
    }

    private _cancelStreamingHandle(handle: StreamingMessageHandle | null): void {
        handle?.cancel();
    }

    public async tryAutoStartAi(prompt?: string): Promise<boolean> {
        return await this._autoStartHelper.startSelectedModule(prompt);
    }
}
