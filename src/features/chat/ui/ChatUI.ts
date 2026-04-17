import { marked } from 'marked';
import markedFootnote from 'marked-footnote';

import markedAlert from 'marked-alert';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// IGlobal removed

// Configure marked
marked.use(markedAlert());

// Syntax highlighting removed by user request

marked.use(markedFootnote());
marked.use({
    breaks: true,
    gfm: true,
});

import type { IChatAttachment, IChatRole } from '../types/chatTypes';
import { ChatAttachmentRenderer } from './ChatAttachmentRenderer';
import { ChatImageController } from './ChatImageController';
import { ChatMessageInteractionController } from './ChatMessageInteractionController';
import { ChatMessageRenderer } from './ChatMessageRenderer';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import DOMPurify from 'dompurify';
import { tracer } from '@/infrastructure/logging/LoggerService';

type ChatImagePayload = {
    mime: string;
    data_base64: string;
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
    private _lastEditableUserActionBar: HTMLElement | null = null;
    private _editMessageHandler: ((text: string) => void | Promise<void>) | null = null;
    private readonly _boundDocumentClick: (e: Event) => void;
    private _retryStatusUnlisten: (() => void) | null = null;
    private _isInitialized = false;
    private _isDestroyed = false;
    private _attachmentRenderVersion = 0;
    private readonly _uiTimeouts = new Set<ReturnType<typeof setTimeout>>();
    private readonly _attachmentRenderer: ChatAttachmentRenderer;
    private readonly _imageController: ChatImageController;
    private readonly _messageInteractionController: ChatMessageInteractionController;
    private readonly _messageRenderer: ChatMessageRenderer;

    private get _messagesContainer(): HTMLElement | null {
        return document.getElementById('chat-messages');
    }
    private get _chatContainer(): HTMLElement | null {
        return document.getElementById('chat-container');
    }
    private get _attachmentsContainer(): HTMLElement | null {
        return document.getElementById('chat-attachments');
    }
    private get _chatInput(): HTMLTextAreaElement | null {
        return document.getElementById('chat-input') as HTMLTextAreaElement | null;
    }
    private get _chatInputPlaceholder(): HTMLElement | null {
        return document.getElementById('chat-input-placeholder');
    }
    private get _clearBtn(): HTMLElement | null {
        return document.getElementById('clear-chat-btn');
    }
    private get _attachBtn(): HTMLElement | null {
        return document.getElementById('chat-attach-btn');
    }
    private get _voiceBtn(): HTMLElement | null {
        return document.getElementById('chat-voice-btn');
    }
    private get _sendBtn(): HTMLElement | null {
        return document.getElementById('chat-send-btn');
    }
    private get _tokenCount(): HTMLElement | null {
        return document.getElementById('chat-token-count');
    }

    private readonly _typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

    constructor() {
        this._imageController = new ChatImageController({
            isDestroyed: () => this._isDestroyed,
            setManagedTimeout: (callback, delayMs) => {
                this._setManagedTimeout(callback, delayMs);
            },
            extractErrorMessage: (error) => this._extractErrorMessage(error),
        });
        this._attachmentRenderer = new ChatAttachmentRenderer({
            isDestroyed: () => this._isDestroyed,
            getRenderVersion: () => this._attachmentRenderVersion,
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
            getEditMessageHandler: () => this._editMessageHandler,
            setLastEditableUserActionBar: (actionBar) => {
                this._setLastEditableUserActionBar(actionBar);
            },
        });
        this._messageRenderer = new ChatMessageRenderer({
            onImageLoad: () => {
                this._scrollToBottom(true);
            },
        });
        this._boundDocumentClick = (e: Event) => {
            if (!(e.target instanceof HTMLElement)) return;
            if (e instanceof MouseEvent && e.button !== 0) return;
            if (!e.target.closest('#chat-messages')) return;
            this._imageController.handleImageClick(e as MouseEvent);
            void this._handleMessageClick(e as MouseEvent);
            void this._messageInteractionController.handleCopyClick(e as MouseEvent);
        };

        // Configure marked renderer for code blocks
        const renderer = new marked.Renderer();
        renderer.code = function ({
            text,
            lang,
            escaped,
        }: {
            text: string;
            lang?: string;
            escaped?: boolean;
        }): string {
            const language = lang ?? 'text';
            // Simple UUID-like for uniqueness if needed, but we rely on DOM traversal
            return `
             <div class="code-block-wrapper">
                 <div class="code-block-header">
                     <span class="code-lang">${language}</span>
                     <button class="code-copy-btn" title="${getGlobalWin().t('ui.launcher.web.copy_code', 'Copy code')}">
                        <!-- Simple Copy Icon -->
                        <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M4 6h2v14H4zm2 14h12v2H6zM18 6h2v14h-2zM6 4h2v2H6zm10 0h2v2h-2zm-6-2h4v2h-4zm0 4h4v2h-4zM8 2h2v6H8zm6 0h2v6h-2z"></path>
                        </svg>
                        <span>${getGlobalWin().t('ui.launcher.web.copy', 'Copy')}</span>
                     </button>
                 </div>
                 <pre><code class="language-${language}">${escaped === true ? text : text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
             </div>
             `;
        };

        marked.use({ renderer });
    }

    /**
     * Initializes the ChatUI component.
     */
    public async init(): Promise<void> {
        if (this._isInitialized || this._isDestroyed) return;
        this._isInitialized = true;
        document.addEventListener('click', this._boundDocumentClick);
        // Bind AI events
        await this._bindAiEvents();
    }

    private async _bindAiEvents(): Promise<void> {
        const win = getGlobalWin();
        if (win.__TAURI_INTERNALS__ !== undefined && this._retryStatusUnlisten === null) {
            this._retryStatusUnlisten = await listen<{ code: string; wait_seconds: number }>(
                'ai:status:retry',
                (e) => {
                    const { code, wait_seconds } = e.payload;
                    if (code === 'GEMINI_QUOTA_RETRY') {
                        // Show toast or update UI
                        const g = getGlobalWin();
                        const msg =
                            typeof g.t === 'function'
                                ? g.t(
                                      'ui.gemini.status.retry',
                                      'Rate limited. Retrying in {seconds}s...',
                                      {
                                          seconds: wait_seconds.toString(),
                                      },
                                  )
                                : 'Rate limited. Retrying...';
                        this.showToast(msg, 'warning', 3000);

                        // Optional: Update typing indicator if active
                        const typing = document.querySelector(
                            '.chat-message.assistant.typing .typing-dots',
                        );
                        if (typing) {
                            const label = document.createElement('div');
                            label.className = 'typing-status';
                            label.textContent = msg;
                            label.style.fontSize = '0.8em';
                            label.style.opacity = '0.8';
                            label.style.marginTop = '4px';

                            // Remove old status if exists
                            const old = typing.parentElement?.querySelector('.typing-status');
                            if (old !== null && old !== undefined) old.remove();

                            typing.parentElement?.appendChild(label);
                        }
                    }
                },
            );
        }
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;

        document.removeEventListener('click', this._boundDocumentClick);
        this._retryStatusUnlisten?.();
        this._retryStatusUnlisten = null;
        this._imageController.destroy();
        this._attachmentRenderer.revokeAttachmentObjectUrls();

        for (const timeout of this._typingTimeouts.values()) {
            clearTimeout(timeout);
        }
        this._typingTimeouts.clear();
        for (const timeout of this._uiTimeouts.values()) {
            clearTimeout(timeout);
        }
        this._uiTimeouts.clear();
        this._lastEditableUserActionBar = null;
        this._editMessageHandler = null;
    }

    /**
     * Clears all messages and attachments from the UI.
     */
    public clear(): void {
        if (this._messagesContainer) {
            this._messagesContainer.innerHTML = '';
            this._messagesContainer.classList.remove('has-messages');
            this._messagesContainer.style.display = '';
        }
        if (this._chatContainer) {
            this._chatContainer.classList.remove('has-messages');
        }
        this.updateAttachments([], () => void 0);
    }

    public setEditMessageHandler(handler: (text: string) => void | Promise<void>): void {
        this._editMessageHandler = handler;
    }

    public renderHistory(messages: Array<{ role: IChatRole; content: unknown }>): void {
        this.clear();
        for (const message of messages) {
            this.appendMessage(message.role, message.content, {
                skipAnimation: true,
            });
        }
        this.revealLatestMessage();
    }

    private _extractFromObject(obj: Record<string, unknown>): string {
        if ('message' in obj && typeof obj['message'] === 'string') return obj['message'];
        if ('error' in obj && typeof obj['error'] === 'string') return obj['error'];
        if ('text' in obj && typeof obj['text'] === 'string') return obj['text'];

        try {
            return JSON.stringify(obj, null, 2);
        } catch {
            return getGlobalWin().t(
                'ui.chat.complex_object_fallback',
                '[Complex object: cannot display]',
            );
        }
    }

    private _safeExtractText(data: unknown): string {
        if (typeof data === 'string') return data;
        if (data instanceof Error) return data.message;

        if (typeof data === 'object' && data !== null) {
            return this._extractFromObject(data as Record<string, unknown>);
        }

        return typeof data === 'number' || typeof data === 'boolean' ? String(data) : '';
    }

    private _extractErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;

        return String(error);
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

        const safeContent = this._safeExtractText(content);

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
        if (this._messagesContainer) {
            this._messagesContainer.appendChild(row);
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
        update: (chunk: unknown) => void;
        replace: (text: string) => void;
        discard: () => void;
        finalize: (fullContent: unknown, finalOpts?: Record<string, unknown>) => void;
    } {
        this._prepareContainer();

        const row = document.createElement('div');
        row.className = `chat-row ${role === 'user' ? 'user' : 'bot'}`;

        const bubble = this._createMessageBubble(opts);
        const actions = this._appendMessageActions('', role, null);
        const copyBtn = actions?.copyBtn ?? null;

        const textNode = document.createElement('div');
        textNode.className = 'markdown-body';
        bubble.appendChild(textNode);

        row.appendChild(bubble);
        if (this._messagesContainer) {
            this._messagesContainer.appendChild(row);
        }
        this._scrollToBottom();

        let accumulatedText = '';
        let renderCounter = 0;
        let lastRenderTime = Date.now();
        let renderVersion = 0;
        let isDiscarded = false;
        let renderTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingScrollToBottom = false;

        const isStreamingTargetLive = (version: number): boolean =>
            !this._isDestroyed &&
            !isDiscarded &&
            version === renderVersion &&
            row.isConnected &&
            textNode.isConnected;

        const renderMarkdown = (
            sourceText: string,
            version: number,
            scrollToBottom = false,
        ): void => {
            try {
                const parseResult = marked.parse(sourceText);
                if (parseResult instanceof Promise) {
                    void parseResult
                        .then((rawHtml) => {
                            if (!isStreamingTargetLive(version)) return;
                            textNode.innerHTML = DOMPurify.sanitize(rawHtml);
                            if (scrollToBottom) this._scrollToBottom();
                        })
                        .catch(() => {
                            if (!isStreamingTargetLive(version)) return;
                            textNode.textContent = sourceText;
                            if (scrollToBottom) this._scrollToBottom();
                        });
                    return;
                }

                if (!isStreamingTargetLive(version)) return;
                textNode.innerHTML = DOMPurify.sanitize(parseResult);
                if (scrollToBottom) this._scrollToBottom();
            } catch {
                if (!isStreamingTargetLive(version)) return;
                textNode.textContent = sourceText;
                if (scrollToBottom) this._scrollToBottom();
            }
        };

        const flushRender = (scrollToBottom = false): void => {
            const version = ++renderVersion;

            try {
                if (
                    accumulatedText.length < 50 &&
                    !accumulatedText.includes('`') &&
                    !accumulatedText.includes('\n')
                ) {
                    if (!isStreamingTargetLive(version)) return;
                    textNode.textContent = accumulatedText;
                    if (scrollToBottom) this._scrollToBottom();
                } else {
                    renderMarkdown(accumulatedText, version, scrollToBottom);
                }
            } catch {
                if (!isStreamingTargetLive(version)) return;
                textNode.textContent = accumulatedText;
                if (scrollToBottom) this._scrollToBottom();
            }

            lastRenderTime = Date.now();
        };

        const scheduleRender = (immediate = false, scrollToBottom = false): void => {
            pendingScrollToBottom ||= scrollToBottom;

            if (renderTimer !== null) {
                if (!immediate) return;
                clearTimeout(renderTimer);
                renderTimer = null;
            }

            const runRender = () => {
                renderTimer = null;
                const shouldScroll = pendingScrollToBottom;
                pendingScrollToBottom = false;
                flushRender(shouldScroll);
            };

            if (immediate) {
                runRender();
                return;
            }

            const delay = Math.max(0, 100 - (Date.now() - lastRenderTime));
            renderTimer = globalThis.setTimeout(runRender, delay);
        };

        return {
            textNode,
            update: (chunk: unknown) => {
                const safeChunk = this._safeExtractText(chunk);
                accumulatedText += safeChunk;
                if (copyBtn instanceof HTMLElement) {
                    copyBtn.dataset['copyText'] = accumulatedText;
                }
                renderCounter++;
                const now = Date.now();

                // Adaptive rendering:
                // 1. Render first 3 chunks immediately for perceived speed
                // 2. Then render every 100ms or every 4 chunks to balance smoothness and performance
                const shouldRender =
                    renderCounter <= 3 || now - lastRenderTime > 100 || renderCounter % 4 === 0;

                scheduleRender(shouldRender, true);
            },
            replace: (text: string) => {
                accumulatedText = text;
                if (copyBtn instanceof HTMLElement) {
                    copyBtn.dataset['copyText'] = accumulatedText;
                }
                renderCounter++;
                scheduleRender(true, true);
            },
            discard: () => {
                isDiscarded = true;
                renderVersion += 1;
                if (renderTimer !== null) {
                    clearTimeout(renderTimer);
                    renderTimer = null;
                }
                row.remove();
            },
            finalize: (fullContent: unknown, finalOpts: Record<string, unknown> = {}) => {
                const safeFullContent = this._safeExtractText(fullContent);
                if (safeFullContent.trim() === '') {
                    isDiscarded = true;
                    renderVersion += 1;
                    if (renderTimer !== null) {
                        clearTimeout(renderTimer);
                        renderTimer = null;
                    }
                    row.remove();
                    return;
                }
                accumulatedText = safeFullContent;
                if (copyBtn instanceof HTMLElement) {
                    copyBtn.dataset['copyText'] = safeFullContent;
                }
                scheduleRender(true, true);

                if (finalOpts['attachments'] !== undefined) {
                    this._appendAttachments(bubble, finalOpts['attachments'] as IChatAttachment[]);
                }
                if (finalOpts['images'] !== undefined) {
                    this._appendImages(
                        bubble,
                        finalOpts['images'] as { mime: string; data_base64: string }[],
                    );
                    const primaryImage = this._getPrimaryImage(finalOpts['images']);
                    if (primaryImage !== null && actions !== null) {
                        this._imageController.ensureImageActionButtons(
                            actions.actionBar,
                            primaryImage,
                        );
                    }
                }

                if (actions !== null && !bubble.contains(actions.actionBar)) {
                    bubble.appendChild(actions.actionBar);
                }
                if (actions !== null && role === 'assistant') {
                    this._scheduleBubbleImageActions(bubble, actions.actionBar);
                }
                this._scrollToBottom();
            },
        };
    }

    public createImageGenerationMessage(opts: {
        onCancel: () => void | Promise<void>;
        onRegenerate: () => void | Promise<void>;
    }): ImageGenerationMessageHandle {
        this._prepareContainer();

        const row = document.createElement('div');
        row.className = 'chat-row bot';

        const bubble = this._createMessageBubble({ mediaFirst: true });
        bubble.classList.add('chat-image-generation');

        const media = document.createElement('div');
        media.className = 'chat-generated-media hidden';

        const image = document.createElement('img');
        image.className = 'chat-img chat-generated-image';
        image.alt = 'Generated preview';
        media.appendChild(image);

        const status = document.createElement('div');
        status.className = 'chat-generated-status';
        status.textContent = getGlobalWin().t('ui.chat.image_generating', 'Generating image...');

        const progress = document.createElement('div');
        progress.className = 'chat-generated-progress';

        const progressFill = document.createElement('div');
        progressFill.className = 'chat-generated-progress-fill';
        progress.appendChild(progressFill);

        const caption = document.createElement('div');
        caption.className = 'chat-generated-caption hidden';

        const controls = document.createElement('div');
        controls.className = 'chat-generated-controls';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'chat-generated-control is-cancel';
        cancelBtn.textContent = getGlobalWin().t('ui.chat.image_cancel', 'Cancel');

        const regenerateBtn = document.createElement('button');
        regenerateBtn.type = 'button';
        regenerateBtn.className = 'chat-generated-control is-regenerate hidden';
        regenerateBtn.textContent = getGlobalWin().t('ui.chat.image_regenerate', 'Regenerate');

        const invokeControl = (
            button: HTMLButtonElement,
            action: () => void | Promise<void>,
        ): void => {
            button.disabled = true;
            Promise.resolve(action())
                .catch((error: unknown) => {
                    tracer.error('[ChatUI] Image generation control failed', error);
                })
                .finally(() => {
                    if (!this._isDestroyed && button.isConnected) {
                        button.disabled = false;
                    }
                });
        };

        cancelBtn.addEventListener('click', () => {
            invokeControl(cancelBtn, opts.onCancel);
        });
        regenerateBtn.addEventListener('click', () => {
            invokeControl(regenerateBtn, opts.onRegenerate);
        });

        controls.append(cancelBtn, regenerateBtn);
        bubble.append(media, status, progress, caption, controls);
        row.appendChild(bubble);
        this._messagesContainer?.appendChild(row);
        this._scrollToBottom();

        let actions: {
            actionBar: HTMLElement;
            copyBtn: HTMLElement;
            editBtn: HTMLElement | null;
        } | null = null;
        let finalImage: ChatImagePayload | null = null;

        const setProgressFromStatus = (text: string): void => {
            const dividerIndex = text.indexOf('/');
            if (dividerIndex < 0) {
                progressFill.style.width = '';
                progress.classList.remove('is-complete');
                return;
            }

            const current = Number.parseInt(text.slice(0, dividerIndex).trim(), 10);
            const total = Number.parseInt(text.slice(dividerIndex + 1).trim(), 10);
            if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
                progressFill.style.width = '';
                progress.classList.remove('is-complete');
                return;
            }

            const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
            progressFill.style.width = `${String(percent)}%`;
            progress.classList.toggle('is-complete', percent >= 100);
        };

        const showPreview = (dataUrl: string): void => {
            if (dataUrl.trim() === '') return;
            if (image.src === dataUrl) return;
            image.src = dataUrl;
            media.classList.remove('hidden');
            bubble.classList.add('chat-bubble--media');
            this._scrollToBottom(true);
        };

        const showRegenerateOnly = (): void => {
            cancelBtn.classList.add('hidden');
            regenerateBtn.classList.remove('hidden');
        };

        const ensureImageActions = (content: string): void => {
            if (finalImage === null) {
                return;
            }
            actions ??= this._appendMessageActions(content, 'assistant', finalImage);
            if (actions !== null && !bubble.contains(actions.actionBar)) {
                bubble.appendChild(actions.actionBar);
                this._scheduleBubbleImageActions(bubble, actions.actionBar);
            }
        };

        return {
            setStatus: (text: string) => {
                status.textContent = text;
                setProgressFromStatus(text);
            },
            setPreview: (dataUrl: string) => {
                showPreview(dataUrl);
            },
            finalize: (result: { text: string; images: ChatImagePayload[] }) => {
                finalImage = result.images[0] ?? null;
                if (finalImage !== null) {
                    showPreview(`data:${finalImage.mime};base64,${finalImage.data_base64}`);
                }

                status.textContent = getGlobalWin().t('ui.chat.image_ready', 'Generated image');
                progressFill.style.width = '100%';
                progress.classList.add('is-complete');

                caption.textContent = result.text;
                caption.classList.toggle('hidden', result.text.trim() === '');

                showRegenerateOnly();
                ensureImageActions(result.text);
                this._scrollToBottom();
            },
            fail: (message: string) => {
                bubble.classList.add('chat-error');
                status.textContent = message;
                progress.classList.remove('is-complete');
                progressFill.style.width = '';
                caption.classList.add('hidden');
                showRegenerateOnly();
                this._scrollToBottom();
            },
            cancel: (
                message = getGlobalWin().t('ui.chat.image_cancelled', 'Image generation cancelled'),
            ) => {
                status.textContent = message;
                progress.classList.remove('is-complete');
                progressFill.style.width = '';
                caption.classList.add('hidden');
                showRegenerateOnly();
                this._scrollToBottom();
            },
            discard: () => {
                row.remove();
            },
        };
    }

    private _prepareContainer(): void {
        if (!this._messagesContainer || !this._chatContainer) return;
        if (!this._messagesContainer.classList.contains('has-messages')) {
            this._messagesContainer.classList.add('has-messages');
            this._chatContainer.classList.add('has-messages');
        }
    }

    private _scrollToBottom(sticky = false): void {
        if (!this._messagesContainer) return;

        if (sticky) {
            const threshold = 150;
            const isAtBottom =
                this._messagesContainer.scrollHeight -
                    this._messagesContainer.scrollTop -
                    this._messagesContainer.clientHeight <
                threshold;
            if (!isAtBottom) return;
        }

        this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
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
        if (!this._attachmentsContainer) return;
        this._attachmentRenderVersion += 1;
        this._attachmentRenderer.updateAttachments(this._attachmentsContainer, files, onRemove);
    }

    /**
     * Shows a typing indicator in the UI.
     */
    public showTyping(id: string): void {
        if (!this._messagesContainer) return;

        // Clear existing if any (unlikely with unique IDs but for safety)
        this.removeTyping(id);

        const typingDiv = document.createElement('div');
        typingDiv.id = id;
        typingDiv.className = 'chat-message assistant typing';
        typingDiv.innerHTML = `
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
            `;
        this._messagesContainer.appendChild(typingDiv);
        this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;

        // Safety auto-cleanup after 60 seconds
        const timeout = globalThis.setTimeout((): void => {
            tracer.warn(`[ChatUI] Typing indicator ${id} timed out and was auto-removed`);
            this.removeTyping(id);
        }, 60000);
        this._typingTimeouts.set(id, timeout);
    }

    /**
     * Removes a typing indicator from the UI.
     */
    public removeTyping(id: string): void {
        // Clear safety timeout
        if (this._typingTimeouts.has(id)) {
            clearTimeout(this._typingTimeouts.get(id));
            this._typingTimeouts.delete(id);
        }

        const indicator = document.getElementById(id);
        if (indicator !== null) indicator.remove();
    }

    public showToast(
        msg: string,
        type: 'success' | 'error' | 'warning' = 'success',
        duration = 2000,
    ): void {
        const win = getGlobalWin();
        if (typeof win.showToast === 'function') {
            win.showToast(msg, type, duration);
        } else {
            tracer.debug(`[Toast] ${type}: ${msg}`);
        }
    }

    private _setManagedTimeout(callback: () => void, delayMs: number): void {
        const timeout = globalThis.setTimeout(() => {
            this._uiTimeouts.delete(timeout);
            callback();
        }, delayMs);
        this._uiTimeouts.add(timeout);
    }

    /**
     * Updates the token count display.
     */
    public updateTokenCount(count: number): void {
        this._lastTokenCount = count;
        const el = document.getElementById('chat-token-count');
        if (el === null) return;

        if (count > 0) {
            el.textContent = `${String(count)} ${getGlobalWin().t('ui.launcher.web.tokens', 'tokens')}`;
            el.classList.add('visible');
            el.style.display = '';
            // Add warning color if tokens are high (heuristic: 20k tokens)
            if (count > 20000) {
                el.style.color = 'var(--danger)';
            } else if (count > 10000) {
                el.style.color = 'var(--warning)';
            } else {
                el.style.color = '';
            }
        } else {
            el.classList.remove('visible');
            el.style.display = 'none';
        }
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
            const win = getGlobalWin();
            const isTauri = win.__TAURI_INTERNALS__ !== undefined;
            if (isTauri) {
                try {
                    await invoke('plugin:shell|open', { path: url });
                } catch (err) {
                    tracer.error('[ChatUI] Failed to open link via shell:', err);
                    // Fallback to window.open (might be blocked or open in webview depending on config)
                    window.open(url, '_blank');
                }
            } else {
                // Browser fallback
                window.open(url, '_blank');
            }
        }
    }

    /**
     * Refreshes all localized static strings in the Chat UI.
     */
    public refreshTranslations(): void {
        const win = getGlobalWin();
        const t = win.t;
        if (typeof t !== 'function') return;

        // 1. Chat input placeholder
        if (this._chatInput) {
            const placeholderKey = this._chatInput.dataset['i18nPlaceholder'];
            if (placeholderKey !== undefined) {
                const placeholderText = t(placeholderKey, 'Ask something...');
                this._chatInput.placeholder = placeholderText;
                if (this._chatInputPlaceholder) {
                    this._chatInputPlaceholder.textContent = placeholderText;
                }
            }
        }

        // 2. Button titles
        if (this._clearBtn) {
            const clearTitleKey =
                this._clearBtn.dataset['i18nTitle'] ?? 'ui.launcher.web.chat_clear_title';
            this._clearBtn.title = t(clearTitleKey, 'Clear Chat');
            const clearText = this._clearBtn.querySelector('.chat-clear-text');
            if (clearText) {
                clearText.textContent = t('ui.launcher.web.chat_clear', 'Clear Chat');
            }
        }

        if (this._attachBtn) this._attachBtn.title = t('ui.launcher.web.attach', 'Attach');
        if (this._voiceBtn) this._voiceBtn.title = t('ui.launcher.web.voice', 'Voice');
        if (this._sendBtn) this._sendBtn.title = t('ui.launcher.web.send', 'Send');

        this._messageInteractionController.refreshTranslations(t);

        document.querySelectorAll<HTMLElement>('.chat-save-image-btn').forEach((btn) => {
            btn.title = t('ui.chat.save_image', 'Save Image');
        });

        document.querySelectorAll<HTMLElement>('.chat-open-image-folder-btn').forEach((btn) => {
            btn.title = t('ui.chat.open_image_folder', 'Open image folder');
        });

        document
            .querySelectorAll<HTMLElement>('.chat-generated-control.is-cancel')
            .forEach((btn) => {
                btn.textContent = t('ui.chat.image_cancel', 'Cancel');
            });

        document
            .querySelectorAll<HTMLElement>('.chat-generated-control.is-regenerate')
            .forEach((btn) => {
                btn.textContent = t('ui.chat.image_regenerate', 'Regenerate');
            });

        const viewerClose = document.querySelector<HTMLElement>('.chat-image-viewer-close');
        if (viewerClose) {
            viewerClose.setAttribute(
                'aria-label',
                t('ui.chat.close_image_preview', 'Close image preview'),
            );
            viewerClose.title = t('ui.chat.close_image_preview', 'Close image preview');
        }

        document.querySelectorAll<HTMLElement>('.media-remove').forEach((btn) => {
            btn.title = t('ui.launcher.web.remove_attachment', 'Remove attachment');
        });

        // 3. Token count (if visible)
        if (this._tokenCount?.classList.contains('visible') === true) {
            this.updateTokenCount(this._lastTokenCount);
        }
    }
}
