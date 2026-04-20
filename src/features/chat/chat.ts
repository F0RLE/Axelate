/**
 * @module chat/chat
 * @description Main controller for the Chat module.
 * Composes VoiceController and FilePickerController for SRP compliance.
 */

import { ChatService } from './services/ChatService';
import type { ChatUI } from './ui/ChatUI';
import type { IChatMessage, IChatResponse } from './types/chatTypes';
import { ChatFileHandler } from './services/ChatFileHandler';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { SoundService } from '@/shared/services/SoundService';
import { VoiceController } from './controllers/VoiceController';
import { FilePickerController } from './controllers/FilePickerController';
import type { ChatHistoryController } from './controllers/ChatHistoryController';
import type { ChatGenerationController } from './controllers/ChatGenerationController';
import type { ChatSendController } from './controllers/ChatSendController';
import type { ChatContent } from '@/features/ai/types/aiTypes';
import { ChatContentHelper } from './services/ChatContentHelper';
import { ChatInputCoordinator } from './services/ChatInputCoordinator';
import { ChatActivationCoordinator } from './services/ChatActivationCoordinator';
import { ChatUiStateHelper } from './services/ChatUiStateHelper';
import { ChatViewHelper } from './services/ChatViewHelper';
import type { ChatLifecycleHelper } from './services/ChatLifecycleHelper';
import { ChatControllerFactory } from './services/ChatControllerFactory';
import type { IBridge } from '@/shared/types/IBridge';
import { VoiceInputService } from './services/VoiceInputService';
import type { EventBus } from '@/shared/services/EventBus';
import type { IApp } from '@/shared/types/coreTypes';
import { ChatControllerState } from './services/ChatControllerState';

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

export type PendingChatRevealStore = {
    getState: () => { pending_chat_reveal?: boolean };
    updateState: (updates: { pending_chat_reveal: boolean }) => void;
};

type ChatControllerDeps = {
    showToast: (
        message: string,
        type?: 'success' | 'error' | 'warning' | 'info',
        duration?: number,
    ) => void;
    isTauriRuntime: () => boolean;
    openExternalUrl: (url: string) => Promise<void>;
    copyText: (text: string) => Promise<void>;
    getPendingChatRevealStore: () => PendingChatRevealStore | null;
    estimateTokens: (text: string, model?: string) => Promise<number>;
    hostBridge: IBridge;
    eventBus: EventBus;
    getSelectedModule: (category: 'ai_text' | 'ai_image') => Partial<IApp> | undefined;
    tracer: Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;
};

export class ChatController {
    private static readonly _maxInputHeightPx = 200;
    private static readonly _baseInputHeightPx = 42;

    private readonly _tracer: Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;
    private readonly _service: ChatService;
    private readonly _contentHelper: ChatContentHelper;
    private readonly _inputCoordinator: ChatInputCoordinator;
    private readonly _activationCoordinator: ChatActivationCoordinator;
    private readonly _uiStateHelper: ChatUiStateHelper;
    private readonly _viewHelper: ChatViewHelper;
    private readonly _lifecycleHelper: ChatLifecycleHelper;
    private readonly _factory = new ChatControllerFactory();
    private readonly _fileHandler: ChatFileHandler;
    private readonly _voiceInputService: VoiceInputService;
    private readonly _ui: ChatUI;
    private readonly _voice: VoiceController;
    private readonly _filePicker: FilePickerController;
    private readonly _historyController: ChatHistoryController;
    private readonly _generationController: ChatGenerationController;
    private readonly _sendController: ChatSendController;
    private readonly _state = new ChatControllerState();
    private readonly _boundFileInputChange = (e: Event) => this._filePicker.handleFileSelect(e);
    private readonly _boundChatInputKeydown = (e: KeyboardEvent) => {
        const isEnterKey =
            e.key === 'Enter' ||
            e.key === 'NumpadEnter' ||
            e.code === 'Enter' ||
            e.code === 'NumpadEnter';
        if (!isEnterKey || e.shiftKey || e.defaultPrevented || e.isComposing) {
            return;
        }

        e.preventDefault();
        void this.sendChat();
    };
    private readonly _boundChatInputInput = () => {
        this._scheduleAutoResizeInput();
        void this._filePicker.updateTokenCount();
    };

    constructor(
        private readonly _aiBridge: AIBridge,
        private readonly _i18n: I18nService,
        _soundService: SoundService,
        deps: ChatControllerDeps,
    ) {
        this._tracer = deps.tracer;
        this._service = new ChatService(_aiBridge, _i18n, this._tracer);
        this._fileHandler = new ChatFileHandler(this._tracer);
        this._voiceInputService = new VoiceInputService(this._tracer, () =>
            this._i18n.getCurrentLang(),
        );
        this._fileHandler.setTokenEstimator((text, model) => deps.estimateTokens(text, model));
        this._fileHandler.setBridge(deps.hostBridge);
        this._contentHelper = new ChatContentHelper(
            _i18n,
            (text, model) => deps.estimateTokens(text, model),
            this._tracer,
        );
        this._inputCoordinator = this._createInputCoordinator();
        this._ui = this._createUi(deps);
        this._uiStateHelper = this._createUiStateHelper(_aiBridge, _i18n);
        this._viewHelper = this._createViewHelper(_i18n);
        this._lifecycleHelper = this._createLifecycleHelper(deps);
        this._voice = new VoiceController(_i18n, _soundService, this._voiceInputService);
        this._filePicker = this._createFilePicker(_i18n, deps);
        this._historyController = this._createHistoryController(deps);
        this._generationController = this._createGenerationController(_aiBridge, _i18n);
        this._sendController = this._createSendController(_aiBridge, deps);
        this._activationCoordinator = this._createActivationCoordinator(_aiBridge);
    }

    private _createInputCoordinator(): ChatInputCoordinator {
        return new ChatInputCoordinator(
            () => this._scheduleAutoResizeInput(),
            async (text) => this._filePicker.updateTokenCount(text),
        );
    }

    private _createUi(deps: ChatControllerDeps): ChatUI {
        return this._factory.createUi({
            aiBridge: this._aiBridge,
            i18n: this._i18n,
            tracer: this._tracer,
            fileHandler: this._fileHandler,
            showToast: deps.showToast,
            isTauriRuntime: deps.isTauriRuntime,
            openExternalUrl: deps.openExternalUrl,
            copyText: deps.copyText,
        });
    }

    private _createUiStateHelper(aiBridge: AIBridge, i18n: I18nService): ChatUiStateHelper {
        return new ChatUiStateHelper({
            aiBridge,
            i18n,
            appendAssistantError: (message) => {
                this._ui.appendMessage('assistant', message, { error: true });
            },
            getChatInput: () => this._inputCoordinator.getInput(),
            maxInputHeightPx: ChatController._maxInputHeightPx,
            baseInputHeightPx: ChatController._baseInputHeightPx,
        });
    }

    private _createViewHelper(i18n: I18nService): ChatViewHelper {
        return new ChatViewHelper({
            i18n,
            onFileInputChange: this._boundFileInputChange,
            onChatInputKeydown: this._boundChatInputKeydown,
            onChatInputInput: this._boundChatInputInput,
        });
    }

    private _createLifecycleHelper(deps: ChatControllerDeps): ChatLifecycleHelper {
        return this._factory.createLifecycleHelper({
            fileHandler: this._fileHandler,
            eventBus: deps.eventBus,
            refreshTranslations: () => {
                this._ui.refreshTranslations();
            },
            ensureHistoryLoaded: () => this._ensureHistoryLoaded(),
            scheduleRevealLatestMessage: () => {
                this._historyController.scheduleRevealLatestMessage();
            },
            bindEvents: () => {
                this._bindEvents();
            },
            canBindEventsNow: () => this._inputCoordinator.getInput() !== null,
            areEventsBound: () => this._state.eventsBound,
            setEventsBound: (value) => {
                this._state.eventsBound = value;
            },
            randomizeGreeting: (forceIndex) => {
                this.randomizeGreeting(forceIndex);
            },
            currentGreetingIndex: () => this._state.currentGreetingIndex,
            updateAttachmentsFromFiles: (files, onRemove) => {
                this._ui.updateAttachments(files, onRemove);
            },
            updateTokenCount: () => this._filePicker.updateTokenCount(),
        });
    }

    private _createFilePicker(i18n: I18nService, deps: ChatControllerDeps): FilePickerController {
        return new FilePickerController(
            i18n,
            this._ui,
            (text, model) => deps.estimateTokens(text, model),
            () => deps.isTauriRuntime(),
            this._fileHandler,
            this._tracer,
        );
    }

    private _createHistoryController(deps: ChatControllerDeps): ChatHistoryController {
        return this._factory.createHistoryController({
            aiBridge: this._aiBridge,
            getHistory: () => this._state.history,
            setHistory: (history) => {
                this._state.history = history;
            },
            revealLatestMessage: () => {
                this._ui.revealLatestMessage();
            },
            restoreInputText: (text) => {
                this._inputCoordinator.restore(text);
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
            isDestroyed: () => this._state.isDestroyed,
            getPendingChatRevealStore: () => deps.getPendingChatRevealStore(),
            tracer: this._tracer,
        });
    }

    private _createGenerationController(
        aiBridge: AIBridge,
        i18n: I18nService,
    ): ChatGenerationController {
        return this._factory.createGenerationController({
            aiBridge,
            i18n,
            removeTyping: (typingId) => {
                this._ui.removeTyping(typingId);
            },
            appendAssistantMessage: (text, options = {}) => {
                this._ui.appendMessage('assistant', text, options);
            },
            pushAssistantMessage: (content, thoughtSignature) => {
                this._pushAssistantMessage(content, thoughtSignature);
            },
            extractText: (data) => this._contentHelper.extractText(data),
            buildGeneratedImageContent: (images, text) =>
                this._buildGeneratedImageContent(images, text),
            estimateReplyTokens: async (text) => await this._estimateReplyTokens(text),
            getFriendlyErrorMessage: (errorMsg, model) =>
                this._getFriendlyErrorMessage(errorMsg, model),
            handleError: (errorMsg, model) => {
                this._handleError(errorMsg, model);
            },
            isDestroyed: () => this._state.isDestroyed,
            isSending: () => this._state.isSending,
            tracer: this._tracer,
        });
    }

    private _createSendController(
        aiBridge: AIBridge,
        deps: ChatControllerDeps,
    ): ChatSendController {
        return this._factory.createSendController({
            aiBridge,
            fileHandler: this._fileHandler,
            service: this._service,
            getHistory: () => this._state.history,
            pushUserMessage: (content) => {
                this._state.pushHistoryMessage({ role: 'user', content });
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
                this._inputCoordinator.clear();
            },
            updateTokenCount: (count) => {
                this._ui.updateTokenCount(count);
            },
            appendUserMessage: (text, attachments, tokens) => {
                this._ui.appendMessage('user', text, { attachments, tokens });
            },
            getSelectedModule: (category) => deps.getSelectedModule(category),
            handleResponse: async (response, streamingHandle, imageHandle) =>
                await this._generationController.handleChatResponse(
                    response,
                    streamingHandle,
                    imageHandle,
                ),
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
                this._inputCoordinator.restore(text);
            },
            isImageProvider: (providerId) => this._generationController.isImageProvider(providerId),
            lockUi: (input) => this._lockUI(input),
            unlockUi: (els) => {
                this._unlockUI(els);
            },
            handleError: (error) => {
                this._handleError(error);
            },
            isSending: () => this._state.isSending,
            setSending: (value) => {
                this._state.isSending = value;
            },
            tracer: this._tracer,
        });
    }

    private _createActivationCoordinator(aiBridge: AIBridge): ChatActivationCoordinator {
        return new ChatActivationCoordinator({
            aiBridge,
            uiStateHelper: this._uiStateHelper,
            tryAutoStartAi: async () => await this._sendController.tryAutoStartAi(),
            tracer: this._tracer,
        });
    }

    // --- Lifecycle ---

    public init(): void {
        if (this._state.isInitialized) return;
        this._state.isInitialized = true;
        this._state.isDestroyed = false;

        this._tracer.info('[Chat] Initializing TS Controller...');
        void this._ui.init().catch((err: unknown) => {
            this._tracer.error(`[Chat] UI init failed: ${String(err)}`);
        });
        this._ui.setEditMessageHandler(async (text) => {
            await this._editLastTurn(text);
        });
        this._lifecycleHelper.start();
    }

    public destroy(): void {
        if (this._state.isDestroyed) return;
        this._state.isDestroyed = true;
        this._state.isInitialized = false;
        this._lifecycleHelper.stop();
        this._viewHelper.unbindEvents();
        this._stopImagePreviewPolling();
        this._uiStateHelper.dispose();
        this._sendController.destroy();
        this._historyController.destroy();
        this._voice.stop();

        this._ui.destroy();
    }

    // --- Public Actions ---

    public async pickChatFiles(): Promise<void> {
        await this._filePicker.pick();
    }

    public toggleVoiceInput(): void {
        this._voice.toggle((text) => {
            this._inputCoordinator.appendVoiceText(text);
        });
    }

    public stopVoiceRecording(): void {
        this._voice.stop();
    }

    public clearChat(): void {
        this._activationCoordinator.clearInactiveAiErrorTimeout();
        this._generationController.stopImagePreviewPolling();
        this._state.clearHistory();
        this._fileHandler.clear();
        this._ui.clear();
        this._ui.updateTokenCount(0);
        this._scheduleAutoResizeInput();
        void this._aiBridge.clearHistory().catch((e: unknown) => {
            this._tracer.error('[Chat] Failed to clear persisted history:', e);
        });
    }

    // --- Send Message ---

    public async sendChat(): Promise<void> {
        const input = this._inputCoordinator.getInput();
        const text = input?.value.trim() ?? '';
        if (!this._sendController.validateInput(text)) {
            this._ui.showToast(
                this._i18n.t('ui.chat.input_required', 'Enter a message or attach a file'),
                'error',
            );
            return;
        }

        const isActive = await this._activationCoordinator.ensureActive(input);
        if (!isActive) return;

        await this._sendController.sendChat(input);
    }

    // --- Greeting ---

    public randomizeGreeting(forceIndex?: number): void {
        this._state.currentGreetingIndex = this._viewHelper.randomizeGreeting(
            this._state.currentGreetingIndex,
            forceIndex,
        );
    }

    // --- Private Helpers ---

    private _bindEvents(): void {
        this._viewHelper.bindEvents();
        this._scheduleAutoResizeInput();
    }

    private async _ensureHistoryLoaded(): Promise<void> {
        await this._historyController.ensureHistoryLoaded();
    }

    private async _editLastTurn(text: string): Promise<void> {
        await this._historyController.editLastTurn(this._state.isSending, text);
    }

    public async _loadHistory(): Promise<void> {
        await this._historyController.loadHistory();
    }

    private _stopImagePreviewPolling(): void {
        this._generationController.stopImagePreviewPolling();
    }

    public async _checkAIActive(input: HTMLTextAreaElement | null): Promise<boolean> {
        return await this._activationCoordinator.ensureActive(input);
    }

    public _clearInactiveAiErrorTimeout(): void {
        this._activationCoordinator.clearInactiveAiErrorTimeout();
    }

    public async _tryAutoStartAI(): Promise<boolean> {
        return await this._sendController.tryAutoStartAi();
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
        this._state.pushHistoryMessage(assistantMessage);
    }

    private _buildGeneratedImageContent(
        images: Array<{ mime: string; data_base64: string }>,
        text: string,
    ): ChatContent {
        return this._contentHelper.buildGeneratedImageContent(images, text);
    }

    private _getFriendlyErrorMessage(errorMsg: unknown, model?: string): string {
        return this._contentHelper.getFriendlyErrorMessage(errorMsg, model);
    }

    private _handleError(errorMsg: unknown = 'Unknown Error', _model?: string): void {
        const msgStr = this._contentHelper.extractText(errorMsg) || 'Unknown Error';

        this._ui.appendMessage('assistant', msgStr, { error: true });
    }

    private async _estimateReplyTokens(text: string): Promise<number> {
        return this._contentHelper.estimateReplyTokens(text);
    }

    private _lockUI(input: HTMLTextAreaElement | null) {
        return this._uiStateHelper.lockUi(input);
    }

    private _unlockUI(els: {
        input: HTMLTextAreaElement | null;
        sendBtn: HTMLButtonElement | null;
        voiceBtn: HTMLButtonElement | null;
        attachBtn: HTMLButtonElement | null;
    }) {
        this._uiStateHelper.unlockUi(els);
    }

    private _scheduleAutoResizeInput(): void {
        this._uiStateHelper.scheduleAutoResizeInput();
    }

    public _autoResizeInput(): void {
        this._uiStateHelper.autoResizeInput();
    }

    public get _chatHistory(): IChatMessage[] {
        return this._state.history;
    }

    public set _chatHistory(history: IChatMessage[]) {
        this._state.history = history;
    }
}
