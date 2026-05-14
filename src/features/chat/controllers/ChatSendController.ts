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
    aiBridge: AIBridge & {
        prepareImagePrompt?: (
            text: string,
        ) => Promise<{ ok: boolean; text?: string; error?: string }>;
    };
    fileHandler: Pick<ChatFileHandler, 'hasFiles' | 'processForSend'>;
    service: ChatService;
    getHistory: () => IChatMessage[];
    estimateTokens: (text: string) => Promise<number>;
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
    isForceImageGeneration: () => boolean;
    clearForceImageGeneration: () => void;
    handleResponse: (
        response: Awaited<ReturnType<ChatService['sendMessage']>>,
        streamingHandle: StreamingMessageHandle | null,
        imageHandle: ImageGenerationHandle | null,
    ) => Promise<void>;
    cleanupStreamingState: (listenerId: string, typingId: string) => void;
    stopImagePreviewPolling: () => void;
    startImagePreviewPolling: (handle: ImageGenerationHandle) => void;
    cancelTextGeneration: (providerId: string | null) => Promise<boolean>;
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

const IMAGE_PROMPT_REWRITE_TEMPLATE = [
    'You are preparing a prompt for Stable Diffusion.',
    'Task: translate the user request into English, preserve the exact subject and intent, and lightly enhance it with useful visual details.',
    'Rules:',
    '- Remove command words like generate, draw, create, please, сгенерируй, нарисуй, сделай.',
    '- Do not invent extra people, objects, actions, identities, or locations that the user did not ask for.',
    '- You may add concise visual quality details: composition, lighting, camera, mood, texture, style, and render quality.',
    '- Keep it as one prompt, 12-45 words.',
    '- Return only the final prompt text. No quotes, no markdown, no explanation.',
    '',
    'User request: {{prompt}}',
].join('\n');

export class ChatSendController {
    private readonly _autoStartHelper: ChatAutoStartHelper;
    private readonly _sendFlow: ChatSendFlow;
    private readonly _activeStreamingStates = new Map<
        string,
        { listenerId: string; typingId: string }
    >();
    private _isDestroyed = false;
    private _cancelRequested = false;
    private _activeProviderId: string | null = null;
    private _sendSequence = 0;

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
            estimateTokens: _options.estimateTokens,
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
        try {
            await this._options.cancelTextGeneration(this._activeProviderId);
        } catch (error: unknown) {
            this._options.tracer.info(`Chat cancellation request failed: ${String(error)}`);
        }
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
        if (!this.validateInput(text)) {
            return false;
        }

        const uiElements = this._options.lockUi(input);
        const sendId = this._createSendId();
        const typingId = `typing-${sendId}`;
        const listenerId = `chat-stream-${sendId}`;
        let activeProviderId = this._options.aiBridge.getState().activeProviderId;
        let isImageProvider =
            this._options.isForceImageGeneration() ||
            this._options.isImageProvider(activeProviderId);

        this._cancelRequested = false;
        this._activeProviderId = activeProviderId;
        this._options.setSending(true);
        this._activeStreamingStates.set(listenerId, { listenerId, typingId });

        let streamingHandle: StreamingMessageHandle | null = null;
        let imageHandle: ImageGenerationHandle | null = null;
        let shouldStopImageEngine = false;

        try {
            const sendPlan = await this._sendFlow.prepare(text);
            if (this._wasDestroyed()) return false;

            let imagePrompt = sendPlan.combinedText;
            if (isImageProvider) {
                const preparedPrompt = await this._prepareImagePromptWithTextProvider(
                    sendPlan.combinedText,
                );
                if (this._wasDestroyed()) return false;
                imagePrompt = preparedPrompt;

                const imageProviderId = this._getSelectedModuleId('ai_image');
                if (
                    imageProviderId !== null &&
                    this._options.aiBridge.getState().activeProviderId !== imageProviderId
                ) {
                    const started = await this._options.aiBridge.startProvider(imageProviderId);
                    if (!started) {
                        throw new Error(
                            this._options.translate(
                                'ui.ai.provider_activation_failed',
                                'Provider activation failed',
                            ),
                        );
                    }
                }

                activeProviderId = this._options.aiBridge.getState().activeProviderId;
                this._activeProviderId = activeProviderId;
                isImageProvider = this._options.isImageProvider(activeProviderId);
            }

            this._options.clearInput();
            this._options.addContextTokens(sendPlan.tokenCount);
            this._options.appendUserMessage(text, sendPlan.attachments, sendPlan.tokenCount);
            this._options.pushUserMessage(sendPlan.userContent);

            const ensureStreamingHandle = (): StreamingMessageHandle => {
                streamingHandle ??= this._options.createStreamingHandle(typingId);
                return streamingHandle;
            };

            if (isImageProvider) {
                shouldStopImageEngine =
                    activeProviderId !== null &&
                    this._isSelectedLocalImageProvider(activeProviderId);
                imageHandle = this._options.createImageHandle();
                this._options.startImagePreviewPolling(imageHandle);
            } else {
                let hasRenderedTextChunk = false;
                const handle = ensureStreamingHandle();
                handle.setStatus(this._options.translate('ui.chat.thinking', 'Thinking...'));

                this._options.aiBridge.onChunk(listenerId, (chunk) => {
                    if (!hasRenderedTextChunk && String(chunk).trim() === '') {
                        return;
                    }

                    hasRenderedTextChunk = true;
                    ensureStreamingHandle().update(chunk);
                });
            }

            this._options.registerReplaceChunk(
                listenerId,
                () => imageHandle,
                () => streamingHandle,
            );

            const response = await this._options.service.sendMessage(
                imagePrompt,
                sendPlan.historyHead,
                sendPlan.attachments,
                isImageProvider ? { originalPrompt: sendPlan.combinedText } : {},
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
            if (shouldStopImageEngine) {
                await this._stopImageEngineAfterCompletion();
            }
            if (!this._wasDestroyed()) {
                this._options.unlockUi(uiElements);
            }
            this._options.setSending(false);
            this._activeProviderId = null;
            this._options.clearForceImageGeneration();
        }
    }

    private async _prepareImagePromptWithTextProvider(prompt: string): Promise<string> {
        const textProviderId = this._getSelectedModuleId('ai_text');
        const imageProviderId = this._getSelectedModuleId('ai_image');
        if (
            textProviderId === null ||
            imageProviderId === null ||
            textProviderId === imageProviderId ||
            prompt.trim() === ''
        ) {
            return prompt;
        }

        const currentProviderId = this._options.aiBridge.getState().activeProviderId;
        if (currentProviderId !== textProviderId) {
            const started = await this._options.aiBridge.startProvider(textProviderId);
            if (!started) {
                return prompt;
            }
        }

        const response =
            typeof this._options.aiBridge.prepareImagePrompt === 'function'
                ? await this._options.aiBridge.prepareImagePrompt(
                      this._buildImagePromptRewriteRequest(prompt),
                  )
                : { ok: false };
        if (!response.ok) {
            return prompt;
        }

        const prepared = this._extractPreparedPrompt(response);
        return prepared === '' ? prompt : this._stripPromptEnvelope(prepared);
    }

    private _extractPreparedPrompt(response: { ok: boolean; text?: string }): string {
        return (response.text ?? '').trim();
    }

    private _buildImagePromptRewriteRequest(prompt: string): string {
        return IMAGE_PROMPT_REWRITE_TEMPLATE.replace('{{prompt}}', prompt);
    }

    private _stripPromptEnvelope(prompt: string): string {
        return prompt
            .replace(/^```(?:text|markdown)?\s*/iu, '')
            .replace(/```\s*$/u, '')
            .replace(/^["'`]+|["'`]+$/gu, '')
            .trim();
    }

    private _getSelectedModuleId(category: 'ai_text' | 'ai_image'): string | null {
        const module = this._options.getSelectedModule(category);
        const id = module?.id;
        return typeof id === 'string' && id.trim() !== '' ? id : null;
    }

    private _isSelectedLocalImageProvider(providerId: string): boolean {
        const module = this._options.getSelectedModule('ai_image');
        return module?.id === providerId && module.type !== 'api';
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

    private _createSendId(): string {
        this._sendSequence += 1;
        return `${Date.now().toString(36)}-${this._sendSequence.toString(36)}`;
    }

    public async tryAutoStartAi(prompt?: string): Promise<boolean> {
        return await this._autoStartHelper.startSelectedModule(prompt);
    }

    private async _stopImageEngineAfterCompletion(): Promise<void> {
        try {
            await this._options.aiBridge.stopEngineSlot('image');
        } catch {
            /* stopping the local image engine must not replace the generation result */
        }
    }
}
