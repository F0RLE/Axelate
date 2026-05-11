import type { IChatAttachment, IChatRole } from '../types/chatTypes';
import { ChatAttachmentRenderer } from './ChatAttachmentRenderer';
import { extractErrorMessage, safeExtractText } from './ChatContentFormatter';
import { createChatImageGenerationMessage } from './ChatImageGenerationMessage';
import { ChatImageController } from './ChatImageController';
import { ChatInputContextMenu } from './ChatInputContextMenu';
import { configureChatMarkdown } from './ChatMarkdown';
import { ChatMessageInteractionController } from './ChatMessageInteractionController';
import { ChatMessageRenderer } from './ChatMessageRenderer';
import { createChatStreamingMessage } from './ChatStreamingMessage';
import { ChatTokenCountPresenter } from './ChatTokenCountPresenter';
import { refreshChatTranslations } from './ChatTranslationRefresher';
import { ChatUiDom } from './ChatUiDom';
import { ChatTypingController } from './ChatTypingController';
import { ChatUiRetryStatusListener } from './ChatUiRetryStatusListener';
import { ChatUiTimeoutManager } from './ChatUiTimeoutManager';
import { ChatViewportController } from './ChatViewportController';
import type { ChatFileHandler } from '../services/ChatFileHandler';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type ChatImagePayload = {
    mime: string;
    data_base64: string;
};

type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

type ChatUIDeps = {
    fileHandler: Pick<ChatFileHandler, 'getFileTokenEstimate'>;
    translate: ChatTranslate;
    showToast: (
        message: string,
        type?: 'success' | 'error' | 'warning' | 'info',
        duration?: number,
    ) => void;
    isTauriRuntime: () => boolean;
    openExternalUrl: (url: string) => Promise<void>;
    copyText: (text: string) => Promise<void>;
    readClipboardText: () => Promise<string | null>;
    tracer: Pick<LoggerService, 'warn' | 'error' | 'debug'>;
};

type ImageGenerationMessageHandle = {
    setStatus: (text: string) => void;
    setPreview: (dataUrl: string) => void;
    finalize: (result: { text: string; images: ChatImagePayload[] }) => void;
    fail: (message: string) => void;
    cancel: (message?: string) => void;
    discard: () => void;
};

export class ChatUI {
    private _lastTokenCount = 0;
    private _lastContextTokenCount = 0;
    private _lastContextWindow: number | undefined;
    private _lastEditableUserActionBar: HTMLElement | null = null;
    private _lastRegeneratableAssistantActionBar: HTMLElement | null = null;
    private _editMessageHandler: ((text: string) => void | Promise<void>) | null = null;
    private _regenerateMessageHandler: (() => void | Promise<void>) | null = null;
    private readonly _boundDocumentClick: (e: Event) => void;
    private _isInitialized = false;
    private _isDestroyed = false;
    private _attachmentRenderVersion = 0;
    private readonly _attachmentRenderer: ChatAttachmentRenderer;
    private readonly _imageController: ChatImageController;
    private readonly _inputContextMenu: ChatInputContextMenu;
    private readonly _messageInteractionController: ChatMessageInteractionController;
    private readonly _messageRenderer: ChatMessageRenderer;
    private readonly _typingController: ChatTypingController;
    private readonly _tokenCountPresenter: ChatTokenCountPresenter;
    private readonly _retryStatusListener: ChatUiRetryStatusListener;
    private readonly _timeoutManager = new ChatUiTimeoutManager();
    private readonly _viewportController: ChatViewportController;
    private readonly _dom = new ChatUiDom();
    private readonly _deps: ChatUIDeps;
    private readonly _translate: ChatTranslate;
    constructor(deps: ChatUIDeps) {
        this._deps = deps;
        this._translate = deps.translate;
        this._typingController = new ChatTypingController(deps.tracer, this._translate);
        this._tokenCountPresenter = new ChatTokenCountPresenter(this._translate);
        this._viewportController = new ChatViewportController();
        this._retryStatusListener = new ChatUiRetryStatusListener({
            isTauriRuntime: () => this._deps.isTauriRuntime(),
            onRetryStatus: (payload) => {
                this._handleRetryStatusEvent(payload);
            },
        });
        this._imageController = new ChatImageController({
            isDestroyed: () => this._isDestroyed,
            setManagedTimeout: (callback, delayMs) => {
                this._setManagedTimeout(callback, delayMs);
            },
            extractErrorMessage,
            showToast: (message, type) => {
                this.showToast(message, type);
            },
            translate: this._translate,
            tracer: deps.tracer,
        });
        this._inputContextMenu = new ChatInputContextMenu({
            translate: this._translate,
            copyText: (text) => deps.copyText(text),
            readClipboardText: () => deps.readClipboardText(),
            canPaste: () =>
                deps.isTauriRuntime() ||
                typeof globalThis.navigator.clipboard.readText === 'function',
            tracer: deps.tracer,
        });
        this._attachmentRenderer = new ChatAttachmentRenderer({
            fileHandler: deps.fileHandler,
            isDestroyed: () => this._isDestroyed,
            getRenderVersion: () => this._attachmentRenderVersion,
            translate: this._translate,
        });
        this._messageInteractionController = new ChatMessageInteractionController({
            imageController: this._imageController,
            isDestroyed: () => this._isDestroyed,
            setManagedTimeout: (callback, delayMs) => {
                this._setManagedTimeout(callback, delayMs);
            },
            showToast: (message, type, duration) => {
                this.showToast(message, type, duration);
            },
            copyText: (text) => deps.copyText(text),
            getEditMessageHandler: () => this._editMessageHandler,
            getRegenerateMessageHandler: () => this._regenerateMessageHandler,
            setLastEditableUserActionBar: (actionBar) => {
                this._setLastEditableUserActionBar(actionBar);
            },
            setLastRegeneratableAssistantActionBar: (actionBar) => {
                this._setLastRegeneratableAssistantActionBar(actionBar);
            },
            translate: this._translate,
            tracer: deps.tracer,
        });
        this._messageRenderer = new ChatMessageRenderer({
            onImageLoad: () => {
                this._scrollToBottom(true);
            },
            translate: this._translate,
            tracer: deps.tracer,
        });
        this._boundDocumentClick = (e: Event) => {
            if (!(e.target instanceof HTMLElement)) return;
            if (e instanceof MouseEvent && e.button !== 0) return;
            if (!e.target.closest('#chat-messages, #chat-attachments')) return;
            if (this._imageController.handleImageClick(e as MouseEvent)) return;
            void this._handleMessageClick(e as MouseEvent);
            void this._messageInteractionController.handleCopyClick(e as MouseEvent);
        };

        configureChatMarkdown(this._translate);
    }

    /**
     * Initializes the ChatUI component.
     */
    public async init(): Promise<void> {
        if (this._isInitialized || this._isDestroyed) return;
        this._isInitialized = true;
        document.addEventListener('click', this._boundDocumentClick);
        this._inputContextMenu.bind(this._dom.chatInput);
        await this._retryStatusListener.bind();
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;

        document.removeEventListener('click', this._boundDocumentClick);
        this._inputContextMenu.destroy();
        this._retryStatusListener.destroy();
        this._imageController.destroy();
        this._attachmentRenderer.revokeAttachmentObjectUrls();
        this._typingController.clearAll();
        this._timeoutManager.clearAll();
        this._lastEditableUserActionBar = null;
        this._lastRegeneratableAssistantActionBar = null;
        this._editMessageHandler = null;
        this._regenerateMessageHandler = null;
    }

    /**
     * Clears all messages and attachments from the UI.
     */
    public clear(): void {
        this._viewportController.clear(this._dom.messagesContainer, this._dom.chatContainer);
        this.updateAttachments([], () => void 0);
    }

    public setEditMessageHandler(handler: (text: string) => void | Promise<void>): void {
        this._editMessageHandler = handler;
    }

    public setRegenerateMessageHandler(handler: () => void | Promise<void>): void {
        this._regenerateMessageHandler = handler;
    }

    public renderHistory(
        messages: Array<{ role: IChatRole; content: unknown; opts?: Record<string, unknown> }>,
    ): void {
        this.clear();
        for (const message of messages) {
            this.appendMessage(message.role, message.content, {
                skipAnimation: true,
                ...(message.opts ?? {}),
            });
        }
        this.revealLatestMessage();
    }

    /**
     * Appends a new message to the chat container.
     */
    public appendMessage(
        role: IChatRole,
        content: unknown,
        opts: Record<string, unknown> = {},
    ): void {
        this._prepareContainer();

        const row = document.createElement('div');
        row.className = `chat-row ${role === 'user' ? 'user' : 'bot'}`;

        const safeContent = safeExtractText(content, this._translate);

        const bubble = this._createMessageBubble(opts);
        const actions = this._appendMessageActions(
            safeContent,
            role,
            this._getPrimaryImage(opts['images']),
        );
        const textNode = this._createMessageTextNode(safeContent, opts);
        bubble.appendChild(textNode);

        this._appendAttachments(bubble, opts['attachments'] as IChatAttachment[]);
        this._appendImages(bubble, opts['images'] as { mime: string; data_base64: string }[]);
        if (actions !== null) {
            bubble.appendChild(actions.actionBar);
            if (role === 'assistant') {
                this._scheduleBubbleImageActions(bubble, actions.actionBar);
            }
        }

        row.appendChild(bubble);
        const messagesContainer = this._dom.messagesContainer;
        if (messagesContainer !== null) {
            messagesContainer.appendChild(row);
        }
        this._scrollToBottom();
    }

    /**
     * Creates a streaming message bubble and returns a handle to update it.
     */
    public createStreamingMessage(
        role: IChatRole,
        opts: Record<string, unknown> = {},
    ): {
        textNode: HTMLElement;
        setStatus: (text: string) => void;
        update: (chunk: unknown) => void;
        replace: (text: string) => void;
        cancel: () => void;
        discard: () => void;
        finalize: (fullContent: unknown, finalOpts?: Record<string, unknown>) => void;
    } {
        this._prepareContainer();
        return createChatStreamingMessage({
            role,
            opts,
            isDestroyed: () => this._isDestroyed,
            translate: this._translate,
            scrollToBottom: (sticky) => this._scrollToBottom(sticky),
            appendRow: (row) => {
                this._dom.messagesContainer?.appendChild(row);
            },
            createMessageBubble: (bubbleOpts) => this._createMessageBubble(bubbleOpts),
            appendMessageActions: (content, actionRole, image) =>
                this._appendMessageActions(content, actionRole, image),
            appendAttachments: (bubble, attachments) =>
                this._appendAttachments(bubble, attachments),
            appendImages: (bubble, images) => this._appendImages(bubble, images),
            getPrimaryImage: (images) => this._getPrimaryImage(images),
            ensureImageActionButtons: (actionBar, image) => {
                this._imageController.ensureImageActionButtons(actionBar, image);
            },
            scheduleBubbleImageActions: (bubble, actionBar) => {
                this._scheduleBubbleImageActions(bubble, actionBar);
            },
        });
    }

    public createImageGenerationMessage(opts: {
        onCancel: () => void | Promise<void>;
    }): ImageGenerationMessageHandle {
        this._prepareContainer();
        return createChatImageGenerationMessage({
            opts,
            translate: this._translate,
            isDestroyed: () => this._isDestroyed,
            tracer: this._deps.tracer,
            scrollToBottom: (sticky) => this._scrollToBottom(sticky),
            appendRow: (row) => {
                this._dom.messagesContainer?.appendChild(row);
            },
            createMessageBubble: (bubbleOpts) => this._createMessageBubble(bubbleOpts),
            appendMessageActions: (content, role, image) =>
                this._appendMessageActions(content, role, image),
            scheduleBubbleImageActions: (bubble, actionBar) => {
                this._scheduleBubbleImageActions(bubble, actionBar);
            },
        });
    }

    private _prepareContainer(): void {
        this._viewportController.prepareContainer(
            this._dom.messagesContainer,
            this._dom.chatContainer,
        );
    }

    private _scrollToBottom(sticky = false): void {
        this._viewportController.scrollToBottom(this._dom.messagesContainer, sticky);
    }

    public revealLatestMessage(): void {
        this._scrollToBottom();
        this._setManagedTimeout(() => {
            this._scrollToBottom();
        }, 120);
    }

    /**
     * Creates a message bubble element.
     */
    private _createMessageBubble(opts: Record<string, unknown>): HTMLElement {
        return this._messageRenderer.createMessageBubble(opts);
    }

    private _appendMessageActions(
        content: string,
        role: 'user' | 'assistant',
        image: { mime: string; data_base64: string } | null,
    ): { actionBar: HTMLElement; copyBtn: HTMLElement; editBtn: HTMLElement | null } | null {
        return this._messageInteractionController.appendMessageActions(content, role, image);
    }

    private _getPrimaryImage(rawImages: unknown): { mime: string; data_base64: string } | null {
        return this._messageRenderer.getPrimaryImage(rawImages);
    }

    private _scheduleBubbleImageActions(bubble: HTMLElement, actionBar: HTMLElement): void {
        this._setManagedTimeout(() => {
            const image = this._messageRenderer.extractImageFromBubble(bubble);
            if (image !== null) {
                this._imageController.ensureImageActionButtons(actionBar, image);
            }
        }, 0);
    }

    private _setLastEditableUserActionBar(actionBar: HTMLElement): void {
        if (this._lastEditableUserActionBar instanceof HTMLElement) {
            this._lastEditableUserActionBar.classList.remove('is-last-editable');
        }
        actionBar.classList.add('is-last-editable');
        this._lastEditableUserActionBar = actionBar;
    }

    private _setLastRegeneratableAssistantActionBar(actionBar: HTMLElement): void {
        if (this._lastRegeneratableAssistantActionBar instanceof HTMLElement) {
            this._lastRegeneratableAssistantActionBar.classList.remove('is-last-regeneratable');
        }
        actionBar.classList.add('is-last-regeneratable');
        this._lastRegeneratableAssistantActionBar = actionBar;
    }

    /**
     * Creates a text node for a message, supporting i18n and Markdown.
     */
    private _createMessageTextNode(content: string, opts: Record<string, unknown>): HTMLElement {
        return this._messageRenderer.createMessageTextNode(content, opts);
    }

    /**
     * Appends attachments to a message bubble.
     */
    private _appendAttachments(bubble: HTMLElement, attachments?: IChatAttachment[]): void {
        this._attachmentRenderer.appendAttachments(bubble, attachments);
    }
    /**
     * Appends images to a message bubble.
     */
    private _appendImages(
        bubble: HTMLElement,
        images?: { mime: string; data_base64: string }[],
    ): void {
        this._messageRenderer.appendImages(bubble, images);
    }

    public updateAttachments(files: File[], onRemove: (index: number) => void): void {
        const attachmentsContainer = this._dom.attachmentsContainer;
        if (attachmentsContainer === null) return;
        this._attachmentRenderVersion += 1;
        this._attachmentRenderer.updateAttachments(attachmentsContainer, files, onRemove);
    }

    /**
     * Shows a typing indicator in the UI.
     */
    public showTyping(id: string): void {
        this._typingController.showTyping(this._dom.messagesContainer, id, (typingId) => {
            this.removeTyping(typingId);
        });
    }

    /**
     * Removes a typing indicator from the UI.
     */
    public removeTyping(id: string): void {
        this._typingController.removeTyping(id);
    }

    public showToast(
        msg: string,
        type: 'success' | 'error' | 'warning' | 'info' = 'success',
        duration = 2000,
    ): void {
        this._deps.showToast(msg, type, duration);
    }

    private _setManagedTimeout(callback: () => void, delayMs: number): void {
        this._timeoutManager.set(callback, delayMs);
    }

    private _handleRetryStatusEvent(payload: { code: string; wait_seconds: number }): void {
        const msg = this._typingController.handleRetryStatus(payload);
        if (msg === null) {
            return;
        }
        this.showToast(msg, 'warning', 3000);
        this._typingController.renderTypingStatus(msg);
    }

    /**
     * Updates the token count display.
     */
    public updateTokenCount(count: number, maxTokens?: number): void {
        this._lastTokenCount = count;
        this._lastContextWindow = maxTokens;
        const targets = this._dom.getTranslationTargets();
        const hasMessages = this._dom.chatContainer?.classList.contains('has-messages') === true;
        if (!hasMessages) {
            this._lastContextTokenCount = 0;
        }
        this._tokenCountPresenter.update(targets.tokenCount, count, null, maxTokens, hasMessages);
        this._refreshContextTokenButton();
    }

    public updateContextTokenCount(count: number, maxTokens?: number): void {
        this._lastContextTokenCount = Math.max(0, count);
        this._lastContextWindow = maxTokens;
        this._refreshContextTokenButton();
    }

    private _refreshContextTokenButton(): void {
        const targets = this._dom.getTranslationTargets();
        const hasMessages = this._dom.chatContainer?.classList.contains('has-messages') === true;
        this._tokenCountPresenter.update(
            null,
            this._lastContextTokenCount,
            targets.contextBtn,
            this._lastContextWindow,
            hasMessages,
        );
    }

    /**
     * Intercepts clicks on links to open them in the system browser.
     */
    private async _handleMessageClick(e: MouseEvent): Promise<void> {
        const target = e.target as HTMLElement;
        const link = target.closest('a');

        if (link !== null && link.href !== '') {
            e.preventDefault();
            e.stopPropagation();

            const url = link.href;
            await this._deps.openExternalUrl(url);
        }
    }

    /**
     * Refreshes all localized static strings in the Chat UI.
     */
    public refreshTranslations(): void {
        const translationTargets = this._dom.getTranslationTargets();
        refreshChatTranslations(
            translationTargets,
            this._translate,
            (translate) => {
                this._messageInteractionController.refreshTranslations(translate);
            },
            () => {
                this.updateTokenCount(this._lastTokenCount, this._lastContextWindow);
            },
        );
    }
}
