/**
 * @module chat/chat
 * @description Main controller for the Chat module.
 * Composes VoiceController and FilePickerController for SRP compliance.
 */

import { ChatService } from './services/ChatService';
import { ChatUI } from './ui/ChatUI';
import type { IChatMessage, IChatResponse } from './types/chatTypes';
import { chatFileHandler } from './services/ChatFileHandler';
import { getTokenCount } from './utils/chatUtils';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { SoundService } from '@/shared/services/SoundService';
import { eventBus } from '@/shared/services/EventBus';
import { VoiceController } from './controllers/VoiceController';
import { FilePickerController } from './controllers/FilePickerController';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { createMultimodalContent } from '@/features/ai/utils/chatRequestUtils';
import type { ChatContent, ChatContentPart } from '@/features/ai/types/aiTypes';

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

export class ChatController {
    private static readonly _historyRetryDelayMs = 300;
    private static readonly _chatRevealFollowUpDelayMs = 120;
    private static readonly _maxInputHeightPx = 200;
    private static readonly _baseInputHeightPx = 42;

    private readonly _service: ChatService;
    private readonly _ui: ChatUI;
    private readonly _voice: VoiceController;
    private readonly _filePicker: FilePickerController;
    private _chatHistory: IChatMessage[] = [];
    private _currentGreetingIndex = 1;
    private _isSending = false;
    private _historyLoaded = false;
    private _historyLoadInFlight: Promise<void> | null = null;
    private _historyRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    private _inactiveAiErrorTimeout: ReturnType<typeof setTimeout> | null = null;
    private _revealLatestMessageTimeout: ReturnType<typeof setTimeout> | null = null;
    private _revealLatestMessageFrame: number | null = null;
    private _imagePreviewPollTimer: ReturnType<typeof setInterval> | null = null;
    private _imagePreviewPollInFlight = false;
    private _lastImagePreviewUpdatedAtMs = 0;
    private _eventsBound = false;
    private _isInitialized = false;
    private _isDestroyed = false;
    private _pageChangeUnsub: (() => void) | null = null;
    private _translationsLoadedUnsub: (() => void) | null = null;
    private _resizeAnimationFrame: number | null = null;
    private readonly _boundFileInputChange = (e: Event) => this._filePicker.handleFileSelect(e);
    private readonly _boundChatInputKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void this.sendChat();
        }
    };
    private readonly _boundChatInputInput = () => {
        this._scheduleAutoResizeInput();
        void this._filePicker.updateTokenCount();
    };

    constructor(
        private readonly _aiBridge: AIBridge,
        private readonly _i18n: I18nService,
        _soundService: SoundService,
    ) {
        this._service = new ChatService(_aiBridge, _i18n);
        this._ui = new ChatUI();
        this._voice = new VoiceController(_i18n, _soundService);
        this._filePicker = new FilePickerController(_i18n, this._ui);
    }

    // --- Lifecycle ---

    public init(): void {
        if (this._isInitialized) return;
        this._isInitialized = true;
        this._isDestroyed = false;

        tracer.info('[Chat] Initializing TS Controller...');
        void this._ui.init().catch((err: unknown) => {
            tracer.error(`[Chat] UI init failed: ${String(err)}`);
        });
        this._ui.setEditMessageHandler(async (text) => {
            await this._editLastTurn(text);
        });

        chatFileHandler.setUpdateCallback((files, onRemove) => {
            this._ui.updateAttachments(files, onRemove);
            void this._filePicker.updateTokenCount();
        });

        if (chatFileHandler.hasFiles()) {
            this._ui.updateAttachments(chatFileHandler.getFiles(), (idx) => {
                chatFileHandler.removeFile(idx);
            });
        }

        void this._ensureHistoryLoaded();

        this._pageChangeUnsub = eventBus.on('page:change', (data) => {
            if (data.pageId === 'chat') {
                // Bind DOM events the first time the chat page is actually shown
                if (!this._eventsBound) {
                    this._bindEvents();
                    this._eventsBound = true;
                }
                this.randomizeGreeting();
                this._ui.refreshTranslations();
                void this._ensureHistoryLoaded();
                this._scheduleRevealLatestMessage();
            }
        });

        this._translationsLoadedUnsub = eventBus.on('i18n:translations:loaded', () => {
            this.randomizeGreeting(this._currentGreetingIndex);
            this._ui.refreshTranslations();
        });
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;
        this._pageChangeUnsub?.();
        this._pageChangeUnsub = null;
        this._translationsLoadedUnsub?.();
        this._translationsLoadedUnsub = null;
        this._eventsBound = false;

        const fileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;
        fileInput?.removeEventListener('change', this._boundFileInputChange);

        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        chatInput?.removeEventListener('keydown', this._boundChatInputKeydown);
        chatInput?.removeEventListener('input', this._boundChatInputInput);
        if (this._resizeAnimationFrame !== null) {
            globalThis.cancelAnimationFrame(this._resizeAnimationFrame);
            this._resizeAnimationFrame = null;
        }
        if (this._historyRetryTimeout !== null) {
            globalThis.clearTimeout(this._historyRetryTimeout);
            this._historyRetryTimeout = null;
        }
        this._stopImagePreviewPolling();
        this._clearInactiveAiErrorTimeout();
        this._clearRevealLatestMessageTimeout();
        if (this._revealLatestMessageFrame !== null) {
            globalThis.cancelAnimationFrame(this._revealLatestMessageFrame);
            this._revealLatestMessageFrame = null;
        }
        this._voice.stop();
        chatFileHandler.clearUpdateCallback();

        this._ui.destroy();
    }

    // --- Public Actions ---

    public async pickChatFiles(): Promise<void> {
        await this._filePicker.pick();
    }

    public toggleVoiceInput(): void {
        this._voice.toggle((text) => {
            const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
            if (chatInput) {
                chatInput.value += (chatInput.value ? ' ' : '') + text;
                this._scheduleAutoResizeInput();
                void this._filePicker.updateTokenCount(chatInput.value);
            }
        });
    }

    public stopVoiceRecording(): void {
        this._voice.stop();
    }

    public clearChat(): void {
        this._clearInactiveAiErrorTimeout();
        this._stopImagePreviewPolling();
        this._chatHistory = [];
        chatFileHandler.clear();
        this._ui.clear();
        this._ui.updateTokenCount(0);
        this._scheduleAutoResizeInput();
        void this._aiBridge.clearHistory().catch((e: unknown) => {
            tracer.error('[Chat] Failed to clear persisted history:', e);
        });
    }

    // --- Send Message ---

    public async sendChat(): Promise<void> {
        if (this._isSending) return;

        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const text = (input ? input.value : '').trim();

        if (!this._validateInput(text)) return;

        const isActive = await this._checkAIActive(input);
        if (!isActive) return;

        const uiElements = this._lockUI(input);
        const typingId = `typing-${String(Date.now())}`;
        const listenerId = `chat-stream-${String(Date.now())}`;
        const activeProviderId = this._aiBridge.getState().activeProviderId;
        const isImageProvider = this._isImageProvider(activeProviderId);

        this._isSending = true;

        try {
            const tokenCount = await chatFileHandler.getTotalTokenEstimate(text);
            const { attachments, combinedText } = await chatFileHandler.processForSend(text);
            const historyHead = this._chatHistory.slice(-40);

            if (input) {
                input.value = '';
                this._scheduleAutoResizeInput();
            }
            this._ui.updateTokenCount(0);
            this._ui.appendMessage('user', text, { attachments: attachments, tokens: tokenCount });
            this._chatHistory.push({
                role: 'user',
                content: createMultimodalContent(combinedText, attachments),
            });

            let streamingHandle: StreamingMessageHandle | null = null;
            let imageHandle: ImageGenerationHandle | null = null;

            const ensureStreamingHandle = (): StreamingMessageHandle => {
                if (streamingHandle === null) {
                    this._ui.removeTyping(typingId);
                    streamingHandle = this._ui.createStreamingMessage('assistant');
                }
                return streamingHandle;
            };

            const queueRegenerate = async (): Promise<void> => {
                this._restoreInputText(text);
                await this.sendChat();
            };

            const cancelGeneration = async (): Promise<void> => {
                this._stopImagePreviewPolling();
                await this._aiBridge.cancelImageGeneration();
                imageHandle?.cancel();
            };

            if (isImageProvider) {
                imageHandle = this._ui.createImageGenerationMessage({
                    onCancel: cancelGeneration,
                    onRegenerate: queueRegenerate,
                });
                this._startImagePreviewPolling(imageHandle);
            } else {
                this._ui.showTyping(typingId);
                this._aiBridge.onChunk(listenerId, (chunk) => {
                    ensureStreamingHandle().update(chunk);
                });
            }

            this._aiBridge.onReplaceChunk(listenerId, (chunk) => {
                if (imageHandle !== null) {
                    imageHandle.setStatus(chunk.trim());
                    return;
                }
                ensureStreamingHandle().replace(chunk);
            });

            const response = await this._service.sendMessage(
                combinedText,
                historyHead,
                attachments,
            );

            this._cleanupStreamingState(listenerId, typingId);
            await this._handleChatResponse(response, streamingHandle, imageHandle);
        } catch (e: unknown) {
            this._cleanupStreamingState(listenerId, typingId);
            this._handleError(e);
        } finally {
            this._unlockUI(uiElements);
            this._isSending = false;
        }
    }

    // --- Greeting ---

    public randomizeGreeting(forceIndex?: number): void {
        const el = document.getElementById('chat-header-question');
        if (el) {
            if (typeof forceIndex === 'number') {
                this._currentGreetingIndex = forceIndex;
            } else {
                const array = new Uint32Array(1);
                crypto.getRandomValues(array);
                this._currentGreetingIndex = ((array[0] ?? 0) % 50) + 1;
            }

            const translation = this._i18n.t(
                `ui.chat.greeting.${String(this._currentGreetingIndex)}`,
                '',
            );

            if (
                translation === '' ||
                translation === `ui.chat.greeting.${String(this._currentGreetingIndex)}`
            ) {
                const fallbackGreeting = this._i18n.t(
                    'ui.chat.greeting.default',
                    'How can I help you today?',
                );
                if (el.textContent === '' || el.textContent === fallbackGreeting) {
                    el.textContent = fallbackGreeting;
                }
                return;
            }

            el.textContent = translation;
        }
    }

    // --- Private Helpers ---

    private _bindEvents(): void {
        const fileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;
        if (fileInput) {
            fileInput.addEventListener('change', this._boundFileInputChange);
        }

        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (chatInput) {
            chatInput.addEventListener('keydown', this._boundChatInputKeydown);
            chatInput.addEventListener('input', this._boundChatInputInput);
            this._scheduleAutoResizeInput();
        }
    }

    private async _ensureHistoryLoaded(): Promise<void> {
        if (this._historyLoaded) return;
        if (this._historyLoadInFlight !== null) {
            await this._historyLoadInFlight;
            return;
        }

        if (this._aiBridge.getSessionId() === 'default') {
            this._historyRetryTimeout ??= globalThis.setTimeout(() => {
                this._historyRetryTimeout = null;
                void this._ensureHistoryLoaded();
            }, ChatController._historyRetryDelayMs);
            return;
        }

        if (this._historyRetryTimeout !== null) {
            globalThis.clearTimeout(this._historyRetryTimeout);
            this._historyRetryTimeout = null;
        }

        this._historyLoadInFlight = this._loadHistory();
        try {
            await this._historyLoadInFlight;
        } finally {
            this._historyLoadInFlight = null;
        }
    }

    private async _editLastTurn(text: string): Promise<void> {
        if (this._isSending) return;

        try {
            const removedText = await this._aiBridge.rewindLastTurn();
            const nextText = removedText ?? text;

            this._rewindLocalHistory();
            this._ui.renderHistory(this._chatHistory);
            this._restoreInputText(nextText);
        } catch (error: unknown) {
            tracer.error('[Chat] Failed to rewind last turn:', error);
            this._ui.showToast(
                this._i18n.t('ui.chat.edit_last_turn_failed', 'Failed to edit last turn'),
                'error',
            );
        }
    }

    private _rewindLocalHistory(): void {
        while (this._chatHistory.length > 0) {
            const lastMessage = this._chatHistory.at(-1);
            if (lastMessage?.role === 'user') {
                break;
            }
            this._chatHistory.pop();
        }

        const lastMessage = this._chatHistory.at(-1);
        if (lastMessage?.role === 'user') {
            this._chatHistory.pop();
        }
    }

    private _restoreInputText(text: string): void {
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (!(chatInput instanceof HTMLTextAreaElement)) return;

        chatInput.value = text;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        chatInput.focus();
        chatInput.setSelectionRange(text.length, text.length);
        this._scheduleAutoResizeInput();
    }

    private async _loadHistory(): Promise<void> {
        try {
            const history = await this._aiBridge.getHistory();
            this._historyLoaded = true;
            if (Array.isArray(history) && history.length > 0) {
                tracer.info(
                    `[ChatController] Restoring ${String(history.length)} messages from persistence`,
                );

                this._chatHistory = history
                    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
                    .map((msg) => {
                        const historyMessage: IChatMessage = {
                            role: msg.role as 'user' | 'assistant',
                            content: msg.content,
                        };
                        if (msg.thought_signature !== undefined) {
                            historyMessage.thought_signature = msg.thought_signature;
                        }
                        return historyMessage;
                    });

                this._chatHistory.forEach((msg) => {
                    this._ui.appendMessage(msg.role, this._extractRenderableText(msg.content), {
                        tokens: 0,
                        skipAnimation: true,
                        ...this._buildHistoryRenderOptions(msg.content),
                    });
                });
            }

            if (this._consumePendingChatReveal()) {
                this._scheduleRevealLatestMessage();
            }
        } catch (error: unknown) {
            tracer.error('[ChatController] Failed to restore persisted history:', error);
        }
    }

    private _scheduleRevealLatestMessage(): void {
        this._clearRevealLatestMessageTimeout();
        if (this._revealLatestMessageFrame !== null) {
            globalThis.cancelAnimationFrame(this._revealLatestMessageFrame);
        }
        this._revealLatestMessageFrame = globalThis.requestAnimationFrame(() => {
            this._revealLatestMessageFrame = null;
            if (this._isDestroyed) return;
            this._ui.revealLatestMessage();
        });
        this._revealLatestMessageTimeout = globalThis.setTimeout(() => {
            this._revealLatestMessageTimeout = null;
            if (this._isDestroyed) return;
            this._ui.revealLatestMessage();
        }, ChatController._chatRevealFollowUpDelayMs);
    }

    private _cleanupStreamingState(listenerId: string, typingId: string): void {
        this._aiBridge.removeChunkListener(listenerId);
        this._aiBridge.removeReplaceChunkListener(listenerId);
        this._stopImagePreviewPolling();
        this._ui.removeTyping(typingId);
    }

    private _isImageProvider(providerId: string | null): boolean {
        return (
            providerId === 'sdcpp' || providerId === 'stable-diffusion' || providerId === 'comfyui'
        );
    }

    private _startImagePreviewPolling(handle: ImageGenerationHandle): void {
        this._stopImagePreviewPolling();
        this._lastImagePreviewUpdatedAtMs = 0;
        void this._pollImagePreview(handle);
        this._imagePreviewPollTimer = globalThis.setInterval(() => {
            void this._pollImagePreview(handle);
        }, 850);
    }

    private _stopImagePreviewPolling(): void {
        if (this._imagePreviewPollTimer !== null) {
            globalThis.clearInterval(this._imagePreviewPollTimer);
            this._imagePreviewPollTimer = null;
        }
        this._imagePreviewPollInFlight = false;
        this._lastImagePreviewUpdatedAtMs = 0;
    }

    private async _pollImagePreview(handle: ImageGenerationHandle): Promise<void> {
        if (this._imagePreviewPollInFlight || this._isDestroyed || !this._isSending) {
            return;
        }

        this._imagePreviewPollInFlight = true;

        try {
            const preview = await this._aiBridge.getImageGenerationPreview();
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

    private _consumePendingChatReveal(): boolean {
        type PendingUiState = {
            getState: () => { pending_chat_reveal?: boolean };
            updateState: (updates: { pending_chat_reveal: boolean }) => void;
        };
        const win = getGlobalWin() as unknown as Window & {
            uiState?: {
                getState?: PendingUiState['getState'];
                updateState?: PendingUiState['updateState'];
            };
        };

        const uiState = win.uiState as PendingUiState | undefined;
        const pendingState = uiState?.getState();
        const shouldReveal = pendingState?.pending_chat_reveal === true;
        if (shouldReveal) {
            uiState?.updateState({ pending_chat_reveal: false });
        }
        return shouldReveal;
    }

    private _validateInput(text: string): boolean {
        if (!text && !chatFileHandler.hasFiles()) {
            this._ui.showToast(
                this._i18n.t('ui.chat.input_required', 'Enter a message or attach a file'),
                'error',
            );
            return false;
        }
        return true;
    }

    private async _tryAutoStartAI(): Promise<boolean> {
        const textModule = uiState.getSelectedModule('ai_text');
        const imageModule = uiState.getSelectedModule('ai_image');

        // Prefer text module for chat naturally, but allow image module if active
        const selectedModule =
            textModule?.id !== undefined && textModule.id !== '' ? textModule : imageModule;

        if (selectedModule?.id === undefined || selectedModule.id === '') return false;

        tracer.info(`[Chat] Auto-starting selected module: ${selectedModule.id}`);
        const btn = document.getElementById('chat-actions-send');
        if (btn) {
            btn.classList.add('loading');
            btn.setAttribute('disabled', 'true');
        }

        const started = await this._aiBridge.startProvider(selectedModule.id);

        if (btn) {
            btn.classList.remove('loading');
            btn.removeAttribute('disabled');
        }

        return started;
    }

    private async _checkAIActive(input: HTMLTextAreaElement | null): Promise<boolean> {
        if (this._aiBridge.isActive()) {
            this._clearInactiveAiErrorTimeout();
            return true;
        }

        const started = await this._tryAutoStartAI();
        if (started) {
            this._clearInactiveAiErrorTimeout();
            return true;
        }

        this._clearInactiveAiErrorTimeout();
        this._inactiveAiErrorTimeout = globalThis.setTimeout(() => {
            this._inactiveAiErrorTimeout = null;
            if (this._aiBridge.isActive()) {
                return;
            }
            this._ui.appendMessage(
                'assistant',
                this._i18n.t(
                    'ui.ai.no_provider',
                    'No AI module running. Please select and launch a module first.',
                ),
                { error: true },
            );
        }, 500);
        input?.focus();
        return false;
    }

    private _clearInactiveAiErrorTimeout(): void {
        if (this._inactiveAiErrorTimeout !== null) {
            globalThis.clearTimeout(this._inactiveAiErrorTimeout);
            this._inactiveAiErrorTimeout = null;
        }
    }

    private _clearRevealLatestMessageTimeout(): void {
        if (this._revealLatestMessageTimeout !== null) {
            globalThis.clearTimeout(this._revealLatestMessageTimeout);
            this._revealLatestMessageTimeout = null;
        }
    }

    private async _handleChatResponse(
        response: IChatResponse,
        streamingHandle?: {
            update: (chunk: string) => void;
            finalize: (text: string, stats?: Record<string, unknown>) => void;
            discard: () => void;
        } | null,
        imageHandle?: ImageGenerationHandle | null,
    ): Promise<void> {
        if (!response.ok) {
            this._handleFailedChatResponse(response, imageHandle);
            return;
        }

        await this._handleSuccessfulChatResponse(response, streamingHandle, imageHandle);
    }

    private async _handleSuccessfulChatResponse(
        response: IChatResponse,
        streamingHandle?: {
            update: (chunk: string) => void;
            finalize: (text: string, stats?: Record<string, unknown>) => void;
            discard: () => void;
        } | null,
        imageHandle?: ImageGenerationHandle | null,
    ): Promise<void> {
        const rawReply = response.message ?? response.reply?.text ?? '';
        const replyText = this._safeExtractText(rawReply);
        const generatedImages = response.reply?.images ?? [];

        if (generatedImages.length > 0) {
            this._handleGeneratedImages(response, replyText, generatedImages, imageHandle);
            return;
        }

        if (replyText !== '') {
            await this._handleTextReply(response, replyText, streamingHandle);
            return;
        }

        if (streamingHandle) {
            streamingHandle.discard();
            return;
        }

        if (imageHandle !== null && imageHandle !== undefined) {
            imageHandle.discard();
        }
    }

    private _handleGeneratedImages(
        response: IChatResponse,
        replyText: string,
        generatedImages: { mime: string; data_base64: string }[],
        imageHandle?: ImageGenerationHandle | null,
    ): void {
        const caption = replyText || this._i18n.t('ui.chat.image_ready', 'Generated image');

        if (imageHandle !== null && imageHandle !== undefined) {
            imageHandle.finalize({ text: caption, images: generatedImages });
        } else {
            this._ui.appendMessage('assistant', caption, { images: generatedImages });
        }

        this._pushAssistantMessage(
            this._buildGeneratedImageContent(generatedImages, replyText),
            response.thought_signature,
        );
    }

    private async _handleTextReply(
        response: IChatResponse,
        replyText: string,
        streamingHandle?: {
            update: (chunk: string) => void;
            finalize: (text: string, stats?: Record<string, unknown>) => void;
            discard: () => void;
        } | null,
    ): Promise<void> {
        const tokens = await this._estimateReplyTokens(replyText);

        if (streamingHandle) {
            streamingHandle.finalize(replyText, { tokens });
        } else {
            this._ui.appendMessage('assistant', replyText, { tokens });
        }

        this._pushAssistantMessage(replyText, response.thought_signature);
    }

    private _pushAssistantMessage(content: IChatMessage['content'], thoughtSignature?: string): void {
        const assistantMessage: IChatMessage = {
            role: 'assistant',
            content,
        };
        if (thoughtSignature !== undefined) {
            assistantMessage.thought_signature = thoughtSignature;
        }
        this._chatHistory.push(assistantMessage);
    }

    private _handleFailedChatResponse(
        response: IChatResponse,
        imageHandle?: ImageGenerationHandle | null,
    ): void {
        const friendlyMsg = this._getFriendlyErrorMessage(response.error ?? '', response.model);
        if (imageHandle !== null && imageHandle !== undefined) {
            imageHandle.fail(friendlyMsg);
            return;
        }

        this._handleError(friendlyMsg, response.model);
    }

    private _extractFromObject(obj: Record<string, unknown>): string {
        if ('message' in obj && typeof obj['message'] === 'string') return obj['message'];
        if ('error' in obj && typeof obj['error'] === 'string') return obj['error'];
        if ('text' in obj && typeof obj['text'] === 'string') return obj['text'];

        try {
            return JSON.stringify(obj, null, 2);
        } catch {
            return this._i18n.t(
                'ui.chat.complex_object_fallback',
                '[Complex object: cannot display]',
            );
        }
    }

    private _safeExtractText(data: unknown): string {
        if (Array.isArray(data)) {
            return this._extractTextFromParts(data);
        }
        if (typeof data === 'string') return data;
        if (data instanceof Error) return data.message;

        if (typeof data === 'object' && data !== null) {
            return this._extractFromObject(data as Record<string, unknown>);
        }

        return typeof data === 'number' || typeof data === 'boolean' ? String(data) : '';
    }

    private _extractRenderableText(content: ChatContent): string {
        const extracted = this._safeExtractText(content);
        if (extracted !== '') {
            return extracted;
        }

        if (this._buildHistoryRenderOptions(content).images !== undefined) {
            return this._i18n.t('ui.chat.image_ready', 'Generated image');
        }

        return '';
    }

    private _buildGeneratedImageContent(
        images: Array<{ mime: string; data_base64: string }>,
        text: string,
    ): ChatContent {
        const parts: ChatContentPart[] = images.map((image) => ({
            type: 'image_url',
            image_url: {
                url: `data:${image.mime};base64,${image.data_base64}`,
            },
        }));

        if (text.trim() !== '') {
            parts.push({
                type: 'text',
                text,
            });
        }

        return parts;
    }

    private _buildHistoryRenderOptions(content: ChatContent): {
        images?: Array<{ mime: string; data_base64: string }>;
    } {
        if (!Array.isArray(content)) {
            return {};
        }

        const images = content
            .map((part) => this._extractImagePart(part))
            .filter((image): image is { mime: string; data_base64: string } => image !== null);

        return images.length > 0 ? { images } : {};
    }

    private _extractTextFromParts(parts: unknown[]): string {
        const textParts = parts
            .map((part) => this._extractTextPart(part))
            .filter((part): part is string => part !== '');

        return textParts.join('\n').trim();
    }

    private _extractTextPart(part: unknown): string {
        if (typeof part !== 'object' || part === null) {
            return '';
        }

        const contentPart = part as Partial<ChatContentPart>;
        if (contentPart.type === 'text' && typeof contentPart.text === 'string') {
            return contentPart.text;
        }

        return '';
    }

    private _extractImagePart(part: unknown): { mime: string; data_base64: string } | null {
        if (typeof part !== 'object' || part === null) {
            return null;
        }

        const contentPart = part as Partial<ChatContentPart>;
        if (contentPart.type !== 'image_url') {
            return null;
        }

        const url = contentPart.image_url?.url;
        if (typeof url !== 'string' || !url.startsWith('data:')) {
            return null;
        }

        const match = /^data:([^;]+);base64,(.+)$/u.exec(url);
        if (match === null) {
            return null;
        }

        return {
            mime: match[1] ?? 'application/octet-stream',
            data_base64: match[2] ?? '',
        };
    }

    private _getFriendlyErrorMessage(errorMsg: unknown, model?: string): string {
        const msgStr = this._safeExtractText(errorMsg) || 'Unknown Error';
        const msg = msgStr.toLowerCase();
        const modelName = model ?? 'Gemini';

        if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
            return this._i18n
                .t('ui.gemini.error.unavailable', `Error 503: Service Unavailable (${modelName})`)
                .replace('{model}', modelName);
        }

        if (msg.includes('429') || msg.includes('quota') || msg.includes('limit reached')) {
            return this._i18n
                .t('ui.gemini.error.quota', `Error 429: Quota Exceeded (${modelName})`)
                .replace('{model}', modelName);
        }

        if (msg.includes('402') || msg.includes('payment required') || msg.includes('credits')) {
            return this._i18n
                .t(
                    'ui.chat.error.payment_required',
                    `Error 402: Payment Required. Please check your balance at [OpenRouter](https://openrouter.ai/settings/credits).`,
                )
                .replace('{model}', modelName);
        }

        if (
            msg.includes('not enough memory to start the local model') ||
            (msg.includes('reduce context size') && msg.includes('gpu layers'))
        ) {
            return this._i18n.t(
                'ui.chat.error.local_model_memory',
                'Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model.',
            );
        }

        if (
            msg.includes('not enough system memory to start the local model') ||
            msg.includes('close other apps')
        ) {
            return this._i18n.t(
                'ui.chat.error.local_model_system_memory',
                'Not enough system memory to start the local model. Close other apps or use a smaller model.',
            );
        }

        if (
            msg.includes('cudamalloc failed') ||
            msg.includes('ggml_backend_cuda_buffer_type_alloc_buffer') ||
            msg.includes('alloc_tensor_range: failed to allocate cuda0 buffer') ||
            msg.includes('unet alloc runtime params backend buffer failed') ||
            (msg.includes('out of memory') &&
                (msg.includes('stable-diffusion.cpp') || msg.includes('ggml')))
        ) {
            return this._i18n.t(
                'ui.chat.error.image_vram',
                'Not enough GPU memory to generate the image. Lower image size, steps, or batch size, or use a smaller model.',
            );
        }

        if (msg.includes('403') || msg.includes('permission_denied') || msg.includes('api key')) {
            return this._i18n
                .t('ui.gemini.error.auth', `Error 403: Invalid API Key (${modelName})`)
                .replace('{model}', modelName);
        }

        if (msg.includes('quota'))
            return this._i18n.t('ui.chat.error.quota', 'Quota limit reached');
        if (msg.includes('auth') || msg.includes('api key'))
            return this._i18n.t('ui.chat.error.auth', 'Invalid API Key');
        if (msg.includes('server error') || msg.includes('500'))
            return this._i18n.t('ui.chat.error.server', 'Server error. Please try again later.');

        return msgStr;
    }

    private _handleError(errorMsg: unknown = 'Unknown Error', _model?: string): void {
        const msgStr = this._safeExtractText(errorMsg) || 'Unknown Error';

        this._ui.appendMessage('assistant', msgStr, { error: true });
    }

    private async _estimateReplyTokens(text: string): Promise<number> {
        try {
            return await getTokenCount(text);
        } catch (error: unknown) {
            tracer.error('[Chat] Failed to estimate reply tokens, using fallback:', error);
            return Math.max(1, Math.ceil(text.trim().length / 4));
        }
    }

    private _lockUI(input: HTMLTextAreaElement | null) {
        const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
        const voiceBtn = document.getElementById('chat-voice-btn') as HTMLButtonElement | null;
        const attachBtn = document.getElementById('chat-attach-btn') as HTMLButtonElement | null;

        if (input) {
            input.disabled = true;
        }
        if (sendBtn) sendBtn.disabled = true;
        if (voiceBtn) voiceBtn.disabled = true;
        if (attachBtn) attachBtn.disabled = true;

        return { input, sendBtn, voiceBtn, attachBtn };
    }

    private _unlockUI(els: {
        input: HTMLTextAreaElement | null;
        sendBtn: HTMLButtonElement | null;
        voiceBtn: HTMLButtonElement | null;
        attachBtn: HTMLButtonElement | null;
    }) {
        if (els.input && document.body.contains(els.input)) {
            els.input.disabled = false;
            els.input.focus();
        }
        if (els.sendBtn) els.sendBtn.disabled = false;
        if (els.voiceBtn) els.voiceBtn.disabled = false;
        if (els.attachBtn) els.attachBtn.disabled = false;
    }

    private _scheduleAutoResizeInput(): void {
        if (this._resizeAnimationFrame !== null) {
            globalThis.cancelAnimationFrame(this._resizeAnimationFrame);
        }
        this._resizeAnimationFrame = globalThis.requestAnimationFrame(() => {
            this._resizeAnimationFrame = null;
            this._autoResizeInput();
        });
    }

    private _autoResizeInput(): void {
        const el = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (el) {
            el.style.height = 'auto';
            const targetHeight = Math.max(el.scrollHeight, ChatController._baseInputHeightPx);
            const isOverflowing = targetHeight > ChatController._maxInputHeightPx;
            const newHeight = Math.min(targetHeight, ChatController._maxInputHeightPx);
            const nextHeight = `${String(newHeight)}px`;
            el.style.height = nextHeight;
            el.style.overflowY = isOverflowing ? 'auto' : 'hidden';
        }
    }
}
