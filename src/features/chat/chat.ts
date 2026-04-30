/**
 * @module chat/chat
 * @description Main controller for the Chat module.
 * Composes VoiceController and FilePickerController for SRP compliance.
 */

import { ChatService } from './services/ChatService';
import type { ChatUI } from './ui/ChatUI';
import type { IChatMessage } from './types/chatTypes';
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

export type PendingChatRevealStore = {
    getState: () => { pending_chat_reveal?: boolean };
    updateState: (updates: { pending_chat_reveal: boolean }) => void;
};

type ChatControllerDeps = {
    showToast: (
        message: string,
        type?: 'success' | 'error' | 'warning' | 'info',
        duration?: number,
        title?: string | null,
        id?: string | null,
        onClick?: (() => void) | null,
    ) => void;
    isTauriRuntime: () => boolean;
    openExternalUrl: (url: string) => Promise<void>;
    copyText: (text: string) => Promise<void>;
    getPendingChatRevealStore: () => PendingChatRevealStore | null;
    estimateTokens: (text: string, model?: string) => Promise<number>;
    hostBridge: IBridge;
    eventBus: EventBus;
    getSelectedModule: (category: 'ai_text' | 'ai_image') => Partial<IApp> | undefined;
    getPreferredAiCategory: () => 'ai_text' | 'ai_image';
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
    private _restoredImageGenerationTimer: ReturnType<typeof setTimeout> | null = null;
    private _attachMenuAbortController: AbortController | null = null;
    private _forceImageGeneration = false;
    private _contextTokenTotal = 0;
    private _contextTokenVersion = 0;
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
    private readonly _boundViewportResize = () => {
        this._scheduleAutoResizeInput();
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
        this._voiceInputService = new VoiceInputService(this._tracer, deps.hostBridge, () =>
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
        this._voice = new VoiceController(
            _i18n,
            _soundService,
            this._voiceInputService,
            (message, type, duration, title, id, onClick) =>
                deps.showToast(message, type, duration, title, id, onClick),
            async () => {
                await deps.hostBridge.invoke('open_voice_privacy_settings');
            },
        );
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
            onViewportResize: this._boundViewportResize,
        });
    }

    private _createLifecycleHelper(deps: ChatControllerDeps): ChatLifecycleHelper {
        return this._factory.createLifecycleHelper({
            fileHandler: this._fileHandler,
            eventBus: deps.eventBus,
            refreshTranslations: () => {
                this._ui.refreshTranslations();
            },
            ensureHistoryLoaded: () => this._historyController.ensureHistoryLoaded(),
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
            () => this._aiBridge.getContextWindow(),
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
                void this._syncContextTokensFromHistory(history);
            },
            revealLatestMessage: () => {
                this._ui.revealLatestMessage();
            },
            restoreInputText: (text) => {
                this._inputCoordinator.restore(text);
            },
            renderHistory: (history) => {
                this._ui.renderHistory(
                    history.map((message) => ({
                        role: message.role,
                        content: this._contentHelper.extractRenderableText(message.content),
                        opts: this._contentHelper.buildHistoryRenderOptions(message.content),
                    })),
                );
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
                this._contentHelper.buildGeneratedImageContent(images, text),
            estimateReplyTokens: async (text) =>
                await this._contentHelper.estimateReplyTokens(text),
            addContextTokens: (tokens) => {
                this._addContextTokens(tokens);
            },
            getFriendlyErrorMessage: (errorMsg, model) =>
                this._contentHelper.getFriendlyErrorMessage(errorMsg, model),
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
            estimateTokens: async (text) => await deps.estimateTokens(text),
            pushUserMessage: (content) => {
                this._state.pushHistoryMessage({ role: 'user', content });
            },
            createStreamingHandle: (typingId) => {
                this._ui.removeTyping(typingId);
                return this._ui.createStreamingMessage('assistant');
            },
            createImageHandle: () => this._ui.createImageGenerationMessage(),
            translate: (key, fallback) => this._i18n.t(key, fallback),
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
            addContextTokens: (count) => {
                this._addContextTokens(count);
            },
            appendUserMessage: (text, attachments, tokens) => {
                this._ui.appendMessage('user', text, { attachments, tokens });
            },
            getSelectedModule: (category) => deps.getSelectedModule(category),
            getPreferredAiCategory: () => deps.getPreferredAiCategory(),
            isForceImageGeneration: () => this._forceImageGeneration,
            clearForceImageGeneration: () => {
                this._forceImageGeneration = false;
            },
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
            cancelTextGeneration: async (providerIdFromSend) => {
                const providerId =
                    providerIdFromSend ??
                    this._state.currentGenerationProviderId ??
                    this._aiBridge.getState().activeProviderId;
                if (this._generationController.isImageProvider(providerId)) {
                    this._generationController.stopImagePreviewPolling();
                    await this._aiBridge.cancelImageGeneration(providerId);
                    return true;
                }

                return await this._aiBridge.cancelTextGeneration();
            },
            isImageProvider: (providerId) => this._generationController.isImageProvider(providerId),
            lockUi: (input) => this._uiStateHelper.lockUi(input),
            unlockUi: (els) => {
                this._uiStateHelper.unlockUi(els);
            },
            handleError: (error) => {
                this._handleError(error);
            },
            isSending: () => this._state.isSending,
            setSending: (value) => {
                this._state.isSending = value;
                if (value) {
                    this._state.currentGenerationProviderId =
                        this._aiBridge.getState().activeProviderId;
                } else {
                    this._state.currentGenerationProviderId = null;
                }
            },
            tracer: this._tracer,
        });
    }

    private _createActivationCoordinator(aiBridge: AIBridge): ChatActivationCoordinator {
        return new ChatActivationCoordinator({
            aiBridge,
            uiStateHelper: this._uiStateHelper,
            getSelectedProviderId: (prompt) => this._sendController.resolveSelectedModuleId(prompt),
            tryAutoStartAi: async (prompt) => await this._sendController.tryAutoStartAi(prompt),
            tracer: this._tracer,
        });
    }

    // --- Lifecycle ---

    public init(): void {
        if (this._state.isInitialized) return;
        this._state.isInitialized = true;
        this._state.isDestroyed = false;

        this._tracer.debug('[Chat] Initializing TS Controller...');
        void this._ui.init().catch((err: unknown) => {
            this._tracer.error(`[Chat] UI init failed: ${String(err)}`);
        });
        this._ui.setEditMessageHandler(async (text) => {
            await this._historyController.editLastTurn(this._state.isSending, text);
        });
        this._ui.setRegenerateMessageHandler(async () => {
            await this.regenerateLastResponse();
        });
        this._lifecycleHelper.start();
        void this._restoreActiveImageGeneration();
    }

    public destroy(): void {
        if (this._state.isDestroyed) return;
        this._state.isDestroyed = true;
        this._state.isInitialized = false;
        this._clearRestoredImageGenerationTimer();
        this._lifecycleHelper.stop();
        this._viewHelper.unbindEvents();
        this._generationController.stopImagePreviewPolling();
        this._closeAttachMenu();
        this._uiStateHelper.dispose();
        this._sendController.destroy();
        this._historyController.destroy();
        this._voice.stop();

        this._ui.destroy();
    }

    private async _restoreActiveImageGeneration(): Promise<void> {
        if (this._state.isDestroyed || this._state.isSending) {
            return;
        }

        const previewProvider = this._aiBridge as {
            getImageGenerationPreview?: () => Promise<
                Awaited<ReturnType<AIBridge['getImageGenerationPreview']>>
            >;
        };
        if (typeof previewProvider.getImageGenerationPreview !== 'function') {
            return;
        }

        let preview: Awaited<ReturnType<AIBridge['getImageGenerationPreview']>>;
        try {
            preview = await previewProvider.getImageGenerationPreview();
        } catch (error: unknown) {
            this._tracer.error('[Chat] Failed to restore active image generation:', error);
            return;
        }
        if (preview === null) {
            return;
        }

        const imageHandle = this._ui.createImageGenerationMessage();
        imageHandle.setStatus('image status=running elapsed=0s');
        if (preview.data_url.trim() !== '') {
            imageHandle.setPreview(preview.data_url);
        }

        this._state.isSending = true;
        this._state.currentGenerationProviderId = this._aiBridge.getState().activeProviderId;
        this._generationController.startImagePreviewPolling(imageHandle);
        this._scheduleRestoredImageGenerationCheck();
    }

    private _scheduleRestoredImageGenerationCheck(): void {
        this._clearRestoredImageGenerationTimer();
        this._restoredImageGenerationTimer = globalThis.setTimeout(() => {
            this._restoredImageGenerationTimer = null;
            void this._checkRestoredImageGeneration();
        }, 1200);
    }

    private async _checkRestoredImageGeneration(): Promise<void> {
        if (this._state.isDestroyed || !this._state.isSending) {
            return;
        }

        try {
            const preview = await this._aiBridge.getImageGenerationPreview();
            if (preview !== null) {
                this._scheduleRestoredImageGenerationCheck();
                return;
            }

            this._generationController.stopImagePreviewPolling();
            this._state.isSending = false;
            this._state.currentGenerationProviderId = null;
            await this._historyController.loadHistory();
        } catch (error: unknown) {
            this._generationController.stopImagePreviewPolling();
            this._state.isSending = false;
            this._state.currentGenerationProviderId = null;
            this._tracer.error('[Chat] Restored image generation check failed:', error);
        }
    }

    private _clearRestoredImageGenerationTimer(): void {
        if (this._restoredImageGenerationTimer === null) {
            return;
        }

        globalThis.clearTimeout(this._restoredImageGenerationTimer);
        this._restoredImageGenerationTimer = null;
    }

    private _closeAttachMenu(): void {
        this._attachMenuAbortController?.abort();
        this._attachMenuAbortController = null;
        document.querySelector('.chat-attach-menu')?.remove();
    }

    // --- Public Actions ---

    public async pickChatFiles(): Promise<void> {
        await this._filePicker.pick();
    }

    public toggleAttachMenu(): void {
        const existing = document.querySelector('.chat-attach-menu');
        if (existing instanceof HTMLElement) {
            this._closeAttachMenu();
            return;
        }

        this._closeAttachMenu();

        const button = document.getElementById('chat-attach-btn');
        const compose = document.getElementById('chat-compose');
        if (!(button instanceof HTMLElement) || !(compose instanceof HTMLElement)) {
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'chat-attach-menu';
        menu.setAttribute('role', 'menu');

        const fileButton = this._createAttachMenuButton(
            'file',
            this._i18n.t('ui.chat.attach_file', 'Add file'),
            '#icon-paperclip',
        );
        const imageButton = this._createAttachMenuButton(
            'image',
            this._i18n.t('ui.chat.generate_image', 'Generate image'),
            '#icon-ai',
        );

        menu.append(fileButton, imageButton);
        compose.appendChild(menu);

        const controller = new AbortController();
        const close = (event: MouseEvent) => {
            if (event.target instanceof Node && menu.contains(event.target)) {
                return;
            }
            if (event.target instanceof Node && button.contains(event.target)) {
                return;
            }
            this._closeAttachMenu();
        };
        this._attachMenuAbortController = controller;
        document.addEventListener('mousedown', close, {
            capture: true,
            signal: controller.signal,
        });
    }

    public async pickChatFilesFromMenu(): Promise<void> {
        this._closeAttachMenu();
        await this.pickChatFiles();
    }

    public async sendImageGenerationFromMenu(): Promise<void> {
        this._closeAttachMenu();
        this._forceImageGeneration = true;
        await this.sendChat();
    }

    public toggleVoiceInput(): void {
        this._voice.toggle((text) => {
            this._inputCoordinator.appendVoiceText(text);
        });
    }

    public stopVoiceRecording(): void {
        this._voice.stop();
    }

    public async clearChat(): Promise<void> {
        this._activationCoordinator.clearInactiveAiErrorTimeout();
        this._generationController.stopImagePreviewPolling();
        this._state.clearHistory();
        this._contextTokenTotal = 0;
        this._contextTokenVersion += 1;
        this._fileHandler.clear();
        this._ui.clear();
        this._ui.updateTokenCount(0, this._aiBridge.getContextWindow());
        this._ui.updateContextTokenCount(0, this._aiBridge.getContextWindow());
        this._scheduleAutoResizeInput();
        try {
            await this._aiBridge.clearHistory();
        } catch (e: unknown) {
            this._tracer.error('[Chat] Failed to clear persisted history:', e);
        }
    }

    // --- Send Message ---

    public async sendChat(): Promise<boolean> {
        if (this._state.isSending) {
            await this._sendController.cancelActiveSend();
            this._forceImageGeneration = false;
            return false;
        }

        const input = this._inputCoordinator.getInput();
        const text = input?.value.trim() ?? '';
        if (!this._sendController.validateInput(text)) {
            this._forceImageGeneration = false;
            this._ui.showToast(
                this._i18n.t('ui.chat.input_required', 'Enter a message or attach a file'),
                'error',
            );
            return false;
        }

        const activationPrompt = this._forceImageGeneration ? `generate image ${text}` : undefined;
        const isActive = await this._activationCoordinator.ensureActive(input, activationPrompt);
        if (!isActive) {
            this._forceImageGeneration = false;
            return false;
        }

        return await this._sendController.sendChat(input);
    }

    public async regenerateLastResponse(): Promise<void> {
        if (this._state.isSending) {
            return;
        }

        if (!this._historyController.canRegenerateLastTurnFromText()) {
            this._ui.showToast(
                this._i18n.t(
                    'ui.chat.regenerate_structured_unsupported',
                    'Regeneration is available only for text-only messages',
                ),
                'error',
            );
            return;
        }

        const historySnapshot = this._historyController.getLocalHistorySnapshot();
        const text = await this._historyController.regenerateLastTurn(this._state.isSending);
        if (text === null || text.trim() === '') {
            this._historyController.restoreLocalHistorySnapshot(historySnapshot);
            this._ui.showToast(
                this._i18n.t('ui.chat.regenerate_failed', 'Failed to regenerate response'),
                'error',
            );
            return;
        }

        this._inputCoordinator.restore(text);
        let started: boolean;
        try {
            started = await this.sendChat();
        } catch (error: unknown) {
            this._historyController.restoreLocalHistorySnapshot(historySnapshot);
            this._inputCoordinator.restore(text);
            this._tracer.error('[Chat] Failed to resend regenerated turn:', error);
            throw error;
        }

        if (!started) {
            this._historyController.restoreLocalHistorySnapshot(historySnapshot);
            this._inputCoordinator.restore(text);
        }
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

    private _createAttachMenuButton(action: string, label: string, iconHref: string): HTMLElement {
        const button = document.createElement('button');
        button.className = 'chat-attach-menu-item';
        button.type = 'button';
        button.dataset['chatAttachAction'] = action;
        button.setAttribute('role', 'menuitem');

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'icon');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('focusable', 'false');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', iconHref);
        icon.appendChild(use);

        const text = document.createElement('span');
        text.textContent = label;

        button.append(icon, text);
        return button;
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

    private _handleError(errorMsg: unknown = 'Unknown Error', _model?: string): void {
        const msgStr = this._contentHelper.extractText(errorMsg) || 'Unknown Error';

        this._ui.appendMessage('assistant', msgStr, { error: true });
    }

    private _addContextTokens(tokens: number): void {
        if (!Number.isFinite(tokens) || tokens <= 0) {
            return;
        }

        this._contextTokenVersion += 1;
        this._contextTokenTotal += Math.trunc(tokens);
        this._ui.updateContextTokenCount(
            this._contextTokenTotal,
            this._aiBridge.getContextWindow(),
        );
    }

    private async _syncContextTokensFromHistory(history: IChatMessage[]): Promise<void> {
        const version = ++this._contextTokenVersion;
        let total = 0;

        for (const message of history) {
            total += await this._contentHelper.estimateContentTokens(message.content);
            if (version !== this._contextTokenVersion) {
                return;
            }
        }

        if (version !== this._contextTokenVersion) {
            return;
        }

        this._contextTokenTotal = total;
        this._ui.updateContextTokenCount(total, this._aiBridge.getContextWindow());
    }

    private _scheduleAutoResizeInput(): void {
        this._uiStateHelper.scheduleAutoResizeInput();
    }
}
