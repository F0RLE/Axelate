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
import { ChatHistoryController } from './controllers/ChatHistoryController';
import { ChatGenerationController } from './controllers/ChatGenerationController';
import { ChatSendController } from './controllers/ChatSendController';
import type { ChatContent, ChatContentPart } from '@/features/ai/types/aiTypes';

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

type ErrorRule = {
    patterns: string[];
    key: string;
    fallback: string;
};

export class ChatController {
    private static readonly _maxInputHeightPx = 200;
    private static readonly _baseInputHeightPx = 42;
    private static readonly _defaultProviderName = 'OpenRouter';
    private static readonly _errorRules: ErrorRule[] = [
        {
            patterns: ['503', 'unavailable', 'overloaded'],
            key: 'ui.chat.error.server',
            fallback:
                'Error: OpenRouter service is temporarily unavailable. Please try again later.',
        },
        {
            patterns: ['429', 'quota', 'limit reached'],
            key: 'ui.chat.error.quota',
            fallback:
                'Error: OpenRouter quota or rate limit reached. Check your balance and limits.',
        },
        {
            patterns: ['402', 'payment required', 'credits'],
            key: 'ui.chat.error.payment_required',
            fallback:
                'Error 402: Payment Required. Please check your balance at [OpenRouter](https://openrouter.ai/settings/credits).',
        },
        {
            patterns: ['403', 'permission_denied', 'api key'],
            key: 'ui.chat.error.auth',
            fallback: 'Error: Invalid OpenRouter API key. Please check the key in settings.',
        },
    ];
    private static readonly _localModelMemoryRule: ErrorRule = {
        patterns: [
            'not enough memory to start the local model',
            'reduce context size',
            'gpu layers',
        ],
        key: 'ui.chat.error.local_model_memory',
        fallback:
            'Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model.',
    };
    private static readonly _localModelSystemMemoryRule: ErrorRule = {
        patterns: ['not enough system memory to start the local model', 'close other apps'],
        key: 'ui.chat.error.local_model_system_memory',
        fallback:
            'Not enough system memory to start the local model. Close other apps or use a smaller model.',
    };
    private static readonly _imageVramRule: ErrorRule = {
        patterns: [
            'cudamalloc failed',
            'ggml_backend_cuda_buffer_type_alloc_buffer',
            'alloc_tensor_range: failed to allocate cuda0 buffer',
            'unet alloc runtime params backend buffer failed',
        ],
        key: 'ui.chat.error.image_vram',
        fallback:
            'Not enough GPU memory to generate the image. Lower image size, steps, or batch size, or use a smaller model.',
    };

    private readonly _service: ChatService;
    private readonly _ui: ChatUI;
    private readonly _voice: VoiceController;
    private readonly _filePicker: FilePickerController;
    private readonly _historyController: ChatHistoryController;
    private readonly _generationController: ChatGenerationController;
    private readonly _sendController: ChatSendController;
    private _chatHistory: IChatMessage[] = [];
    private _currentGreetingIndex = 1;
    private _isSending = false;
    private _inactiveAiErrorTimeout: ReturnType<typeof setTimeout> | null = null;
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
        this._historyController = new ChatHistoryController({
            aiBridge: _aiBridge,
            getHistory: () => this._chatHistory,
            setHistory: (history) => {
                this._chatHistory = history;
            },
            appendHistoryMessage: (role, text, options) => {
                this._ui.appendMessage(role, text, options);
            },
            revealLatestMessage: () => {
                this._ui.revealLatestMessage();
            },
            extractRenderableText: (content) => this._extractRenderableText(content),
            buildHistoryRenderOptions: (content) => this._buildHistoryRenderOptions(content),
            restoreInputText: (text) => {
                this._restoreInputText(text);
            },
            renderHistory: (history) => {
                this._ui.renderHistory(history);
            },
            showEditError: () => {
                this._ui.showToast(
                    this._i18n.t('ui.chat.edit_last_turn_failed', 'Failed to edit last turn'),
                    'error',
                );
            },
            isDestroyed: () => this._isDestroyed,
        });
        this._generationController = new ChatGenerationController({
            aiBridge: _aiBridge,
            i18n: _i18n,
            removeTyping: (typingId) => {
                this._ui.removeTyping(typingId);
            },
            appendAssistantMessage: (text, options = {}) => {
                this._ui.appendMessage('assistant', text, options);
            },
            pushAssistantMessage: (content, thoughtSignature) => {
                this._pushAssistantMessage(content, thoughtSignature);
            },
            buildGeneratedImageContent: (images, text) =>
                this._buildGeneratedImageContent(images, text),
            estimateReplyTokens: async (text) => this._estimateReplyTokens(text),
            getFriendlyErrorMessage: (errorMsg, model) =>
                this._getFriendlyErrorMessage(errorMsg, model),
            handleError: (errorMsg, model) => {
                this._handleError(errorMsg, model);
            },
            isDestroyed: () => this._isDestroyed,
            isSending: () => this._isSending,
        });
        this._sendController = new ChatSendController({
            aiBridge: _aiBridge,
            service: this._service,
            getHistory: () => this._chatHistory,
            pushUserMessage: (content) => {
                this._chatHistory.push({ role: 'user', content });
            },
            createStreamingHandle: (typingId) => {
                this._ui.removeTyping(typingId);
                return this._ui.createStreamingMessage('assistant');
            },
            createImageHandle: (_text, onRegenerate) =>
                this._ui.createImageGenerationMessage({
                    onCancel: async () => {
                        this._generationController.stopImagePreviewPolling();
                        await this._aiBridge.cancelImageGeneration();
                    },
                    onRegenerate,
                }),
            showTyping: (typingId) => {
                this._ui.showTyping(typingId);
            },
            registerReplaceChunk: (listenerId, imageHandleRef, streamingHandleRef) => {
                this._aiBridge.onReplaceChunk(listenerId, (chunk) => {
                    const imageHandle = imageHandleRef();
                    if (imageHandle !== null) {
                        imageHandle.setStatus(chunk.trim());
                        return;
                    }
                    streamingHandleRef()?.replace(chunk);
                });
            },
            clearInput: () => {
                const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
                if (input) {
                    input.value = '';
                    this._scheduleAutoResizeInput();
                }
            },
            updateTokenCount: (count) => {
                this._ui.updateTokenCount(count);
            },
            appendUserMessage: (text, attachments, tokens) => {
                this._ui.appendMessage('user', text, { attachments, tokens });
            },
            handleResponse: async (response, streamingHandle, imageHandle) =>
                this._generationController.handleChatResponse(response, streamingHandle, imageHandle),
            cleanupStreamingState: (listenerId, typingId) => {
                this._generationController.cleanupStreamingState(listenerId, typingId);
            },
            stopImagePreviewPolling: () => {
                this._generationController.stopImagePreviewPolling();
            },
            startImagePreviewPolling: (handle) => {
                this._generationController.startImagePreviewPolling(handle);
            },
            restoreInputText: (text) => {
                this._restoreInputText(text);
            },
            isImageProvider: (providerId) => this._generationController.isImageProvider(providerId),
            lockUi: (input) => this._lockUI(input),
            unlockUi: (els) => {
                this._unlockUI(els);
            },
            handleError: (error) => {
                this._handleError(error);
            },
            isSending: () => this._isSending,
            setSending: (value) => {
                this._isSending = value;
            },
        });
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
                this._historyController.scheduleRevealLatestMessage();
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
        this._stopImagePreviewPolling();
        this._clearInactiveAiErrorTimeout();
        this._sendController.destroy();
        this._historyController.destroy();
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
        this._generationController.stopImagePreviewPolling();
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
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const text = input?.value.trim() ?? '';
        if (!this._sendController.validateInput(text)) {
            this._ui.showToast(
                this._i18n.t('ui.chat.input_required', 'Enter a message or attach a file'),
                'error',
            );
            return;
        }

        const isActive = await this._checkAIActive(input);
        if (!isActive) return;

        await this._sendController.sendChat(input);
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
        await this._historyController.ensureHistoryLoaded();
    }

    private async _editLastTurn(text: string): Promise<void> {
        await this._historyController.editLastTurn(this._isSending, text);
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

    public async _loadHistory(): Promise<void> {
        await this._historyController.loadHistory();
    }

    private _stopImagePreviewPolling(): void {
        this._generationController.stopImagePreviewPolling();
    }

    private async _tryAutoStartAI(): Promise<boolean> {
        return this._sendController.tryAutoStartAi();
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

    public async _handleChatResponse(
        response: IChatResponse,
        streamingHandle?: {
            update: (chunk: string) => void;
            replace: (chunk: string) => void;
            finalize: (text: string, stats?: Record<string, unknown>) => void;
            discard: () => void;
        } | null,
        imageHandle?: ImageGenerationHandle | null,
    ): Promise<void> {
        await this._generationController.handleChatResponse(response, streamingHandle, imageHandle);
    }

    private _pushAssistantMessage(
        content: IChatMessage['content'],
        thoughtSignature?: string,
    ): void {
        const assistantMessage: IChatMessage = {
            role: 'assistant',
            content,
        };
        if (thoughtSignature !== undefined) {
            assistantMessage.thought_signature = thoughtSignature;
        }
        this._chatHistory.push(assistantMessage);
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
        const modelName = model ?? ChatController._defaultProviderName;

        if (this._matchesAll(msg, ['reduce context size', 'gpu layers'])) {
            return this._localizeError(ChatController._localModelMemoryRule);
        }

        if (this._matchesRule(msg, ChatController._localModelMemoryRule)) {
            return this._localizeError(ChatController._localModelMemoryRule);
        }

        if (this._matchesRule(msg, ChatController._localModelSystemMemoryRule)) {
            return this._localizeError(ChatController._localModelSystemMemoryRule);
        }

        if (
            this._matchesRule(msg, ChatController._imageVramRule) ||
            this._matchesAll(msg, ['out of memory', 'stable-diffusion.cpp']) ||
            this._matchesAll(msg, ['out of memory', 'ggml'])
        ) {
            return this._localizeError(ChatController._imageVramRule);
        }

        const matchedRule = ChatController._errorRules.find((rule) => this._matchesRule(msg, rule));
        if (matchedRule !== undefined) {
            return this._localizeError(matchedRule, modelName);
        }

        const authRule =
            ChatController._errorRules.find((rule) => rule.key === 'ui.chat.error.auth') ??
            ChatController._errorRules.at(-1);
        if (msg.includes('auth') && authRule !== undefined) {
            return this._localizeError(
                authRule,
                modelName,
            );
        }

        const serverRule =
            ChatController._errorRules.find((rule) => rule.key === 'ui.chat.error.server') ??
            ChatController._errorRules[0];
        if ((msg.includes('server error') || msg.includes('500')) && serverRule !== undefined) {
            return this._localizeError(
                serverRule,
                modelName,
            );
        }

        return msgStr;
    }

    private _matchesRule(message: string, rule: ErrorRule): boolean {
        return rule.patterns.some((pattern) => message.includes(pattern));
    }

    private _matchesAll(message: string, patterns: string[]): boolean {
        return patterns.every((pattern) => message.includes(pattern));
    }

    private _localizeError(rule: ErrorRule, modelName?: string): string {
        const localized = this._i18n.t(rule.key, rule.fallback);
        if (modelName === undefined) {
            return localized;
        }

        return localized.replace('{model}', modelName);
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
