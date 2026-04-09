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

import { chatFileHandler } from '../services/ChatFileHandler';
import type { IChatAttachment, IChatRole } from '../types/chatTypes';
import { getFileIcon } from '../utils/chatUtils';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import DOMPurify from 'dompurify';
import { tracer } from '@/infrastructure/logging/LoggerService';

type SavedChatImage = {
    filePath: string;
    folderPath: string;
};

export class ChatUI {
    private static readonly _imageResetDelayMs = 250;
    private _lastTokenCount = 0;
    private _lastEditableUserActionBar: HTMLElement | null = null;
    private _editMessageHandler: ((text: string) => void | Promise<void>) | null = null;
    private readonly _boundDocumentClick: (e: Event) => void;
    private readonly _boundImageViewerKeydown: (e: KeyboardEvent) => void;
    private _retryStatusUnlisten: (() => void) | null = null;
    private _isInitialized = false;
    private _isDestroyed = false;
    private _attachmentRenderVersion = 0;
    private _imageViewerOverlay: HTMLElement | null = null;
    private _imageViewerImage: HTMLImageElement | null = null;
    private readonly _uiTimeouts = new Set<ReturnType<typeof setTimeout>>();
    private readonly _attachmentObjectUrls = new Set<string>();

    private static readonly _downloadIcon = DOMPurify.sanitize(`
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M21 15v4h-2v-4zm-2 4v2H5v-2zM5 15v4H3v-4zm8-12v14h-2V3z"></path>
            <path d="M7 11v2h10v-2zm2 2v2h2v-2zm4 0v2h2v-2z"></path>
            <path d="M15 11v2h2v-2z"></path>
        </svg>
    `);

    private static readonly _folderIcon = DOMPurify.sanitize(`
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M4 4h6v2H4zm0 14h16v2H4zM20 8h2v10h-2zM2 6h2v12H2zm8 0h10v2H10z"></path>
        </svg>
    `);

    private static readonly _checkIcon = DOMPurify.sanitize(`
        <svg class="icon-check" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M10 18H8v-2h2v2Zm-2-2H6v-2h2v2Zm4-2v2h-2v-2h2Zm-6 0H4v-2h2v2Zm8 0h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2V8h2v2Zm2-2h-2V6h2v2Z"></path>
        </svg>
    `);

    private static readonly _trashIcon = DOMPurify.sanitize(`
        <svg class="icon-trash" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M6 7h2v2H6zm14 0h2v10h-2zM8 5h12v2H8zM4 9h2v2H4zm-2 2h2v2H2zm2 2h2v2H4zm2 2h2v2H6zm2 2h12v2H8zm6-6h2v2h-2zm2 2h2v2h-2zm0-4h2v2h-2zm-4 4h2v2h-2zm0-4h2v2h-2z"></path>
        </svg>
    `);

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
        this._boundDocumentClick = (e: Event) => {
            if (!(e.target instanceof HTMLElement)) return;
            if (e instanceof MouseEvent && e.button !== 0) return;
            if (!e.target.closest('#chat-messages')) return;
            this._handleImageClick(e as MouseEvent);
            void this._handleMessageClick(e as MouseEvent);
            void this._handleCopyClick(e as MouseEvent);
        };
        this._boundImageViewerKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this._closeImageViewer();
            }
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
        document.removeEventListener('keydown', this._boundImageViewerKeydown);
        this._retryStatusUnlisten?.();
        this._retryStatusUnlisten = null;
        document.body.classList.remove('chat-image-viewer-open');
        this._imageViewerOverlay?.remove();
        this._imageViewerOverlay = null;
        this._imageViewerImage = null;
        this._revokeAttachmentObjectUrls();

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
                        this._ensureImageActionButtons(actions.actionBar, primaryImage);
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
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble${opts['error'] === true ? ' chat-error' : ''}${opts['thought'] === true ? ' chat-thought' : ''}`;
        return bubble;
    }

    private _appendMessageActions(
        content: string,
        role: 'user' | 'assistant',
        image: { mime: string; data_base64: string } | null,
    ): { actionBar: HTMLElement; copyBtn: HTMLElement; editBtn: HTMLElement | null } | null {
        const actionBar = document.createElement('div');
        actionBar.className = `chat-message-actions ${role === 'user' ? 'is-user' : 'is-bot'}`;
        const hasImageActions = role === 'assistant' && image !== null;

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'chat-copy-own-btn';
        copyBtn.dataset['copyText'] = content;
        copyBtn.title = getGlobalWin().t('ui.launcher.web.copy', 'Copy');
        copyBtn.innerHTML = DOMPurify.sanitize(`
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M4 6h2v14H4zm2 14h12v2H6zM18 6h2v14h-2zM6 4h2v2H6zm10 0h2v2h-2zm-6-2h4v2h-4zm0 4h4v2h-4zM8 2h2v6H8zm6 0h2v6h-2z"></path>
            </svg>
        `);
        if (!hasImageActions) {
            actionBar.appendChild(copyBtn);
        }

        let editBtn: HTMLButtonElement | null = null;
        if (role === 'user') {
            editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'chat-edit-own-btn';
            editBtn.dataset['editText'] = content;
            editBtn.title = getGlobalWin().t('ui.launcher.web.edit_last', 'Edit last message');
            editBtn.innerHTML = DOMPurify.sanitize(`
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M15 2h4v2h-4zm-2 2h2v2h-2zm-2 2h2v2h-2zM9 8h2v2H9zM7 10h2v2H7zm-2 2h2v2H5zm-2 2h2v6h6v-2H7v-4H5zm10 2h8v2h-8z"></path>
                </svg>
            `);
            actionBar.appendChild(editBtn);
            this._setLastEditableUserActionBar(actionBar);
        }

        if (hasImageActions) {
            this._ensureImageActionButtons(actionBar, image);
        }

        return { actionBar, copyBtn, editBtn };
    }

    private _getPrimaryImage(rawImages: unknown): { mime: string; data_base64: string } | null {
        if (!Array.isArray(rawImages)) return null;

        const candidate = rawImages.find(
            (item) =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as { data_base64?: unknown }).data_base64 === 'string' &&
                typeof (item as { mime?: unknown }).mime === 'string',
        ) as { mime: string; data_base64: string } | undefined;

        return candidate ?? null;
    }

    private _ensureImageActionButtons(
        actionBar: HTMLElement,
        image: { mime: string; data_base64: string },
    ): void {
        if (actionBar.querySelector('.chat-save-image-btn, .chat-open-image-folder-btn')) return;
        actionBar.querySelector('.chat-copy-own-btn')?.remove();

        const t = getGlobalWin().t;

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'chat-save-image-btn';
        saveBtn.title =
            typeof t === 'function' ? t('ui.chat.save_image', 'Save Image') : 'Save Image';
        saveBtn.innerHTML = ChatUI._downloadIcon;
        saveBtn.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (saveBtn.classList.contains('chat-open-image-folder-btn')) {
                void this._deleteSavedImage(saveBtn);
            }
        });
        saveBtn.addEventListener('click', (event) => {
            if (event.button !== 0) return;
            const filePath = saveBtn.dataset['filePath'];
            const folderPath = saveBtn.dataset['folderPath'];
            if (
                typeof filePath === 'string' &&
                filePath.length > 0 &&
                typeof folderPath === 'string' &&
                folderPath.length > 0
            ) {
                void this._openImageLocation(saveBtn, filePath, folderPath);
                return;
            }
            void this._handleSaveImageAction(saveBtn, image.data_base64, image.mime);
        });
        saveBtn.dataset['imageBase64'] = image.data_base64;
        saveBtn.dataset['imageMime'] = image.mime;

        actionBar.appendChild(saveBtn);
    }

    private _scheduleBubbleImageActions(bubble: HTMLElement, actionBar: HTMLElement): void {
        this._setManagedTimeout(() => {
            const image = this._extractImageFromBubble(bubble);
            if (image !== null) {
                this._ensureImageActionButtons(actionBar, image);
            }
        }, 0);
    }

    private _extractImageFromBubble(
        bubble: HTMLElement,
    ): { mime: string; data_base64: string } | null {
        const image = bubble.querySelector<HTMLImageElement>('img');
        if (!(image instanceof HTMLImageElement)) return null;

        const src = image.currentSrc || image.src;
        if (!src.startsWith('data:image/')) return null;

        const match = /^data:([^;]+);base64,(.+)$/i.exec(src);
        if (match === null) return null;

        const mime = match[1];
        const data_base64 = match[2];
        if (mime === undefined || data_base64 === undefined || mime === '' || data_base64 === '') {
            return null;
        }

        return { mime, data_base64 };
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
        const textNode = document.createElement('div');
        textNode.className = 'markdown-body'; // Helper class for styling

        const finalContent = this._resolveI18nContent(textNode, content, opts);

        // Render Markdown
        try {
            const parseResult = marked.parse(finalContent);
            if (parseResult instanceof Promise) {
                void parseResult.then((rawHtml) => {
                    textNode.innerHTML = DOMPurify.sanitize(rawHtml);
                });
            } else {
                textNode.innerHTML = DOMPurify.sanitize(parseResult);
            }
        } catch (e) {
            tracer.error('[ChatUI] Markdown render error:', e);
            textNode.textContent = finalContent;
        }

        return textNode;
    }

    private _resolveI18nContent(
        el: HTMLElement,
        content: string,
        opts: Record<string, unknown>,
    ): string {
        const g = getGlobalWin();

        // Handle i18nKey
        if (typeof opts['i18nKey'] === 'string' && opts['i18nKey'] !== '') {
            const i18nKey = opts['i18nKey'];
            el.dataset['i18n'] = i18nKey;

            if (opts['i18nParams'] !== undefined) {
                el.dataset['i18nParams'] = JSON.stringify(opts['i18nParams']);
            }

            // Note: tParams would be used here if translator supported interpolation
            tracer.debug('[ChatUI] i18nParams ignored by translator');

            return typeof g.t === 'function' ? g.t(i18nKey, content) : content;
        }

        // Handle i18nPrefixKey
        if (typeof opts['i18nPrefixKey'] === 'string' && opts['i18nPrefixKey']) {
            const prefixKey = opts['i18nPrefixKey'];
            el.dataset['i18nPrefix'] = prefixKey;

            const prefix = typeof g.t === 'function' ? g.t(prefixKey, 'Error: ') : 'Error: ';
            return prefix + content;
        }

        return content;
    }

    /**
     * Appends attachments to a message bubble.
     */
    private _appendAttachments(bubble: HTMLElement, attachments?: IChatAttachment[]): void {
        if (attachments === undefined || attachments.length === 0) return;

        const attachContainer = document.createElement('div');
        attachContainer.className = 'chat-message-attachments';

        const maxVisible = 6;
        const visibleAttachments = attachments.slice(0, maxVisible);
        const hiddenCount = attachments.length - maxVisible;

        visibleAttachments.forEach((f) => {
            this._renderChatAttachment(attachContainer, f);
        });

        if (hiddenCount > 0) {
            const moreCard = document.createElement('div');
            moreCard.className = 'chat-media-card more-card';
            moreCard.innerHTML = `<span>+${String(hiddenCount)}</span>`;
            attachContainer.appendChild(moreCard);
        }

        bubble.appendChild(attachContainer);
    }

    private _renderChatAttachment(container: HTMLElement, f: IChatAttachment): void {
        const card = document.createElement('div');
        let isImage = f.type.startsWith('image/');
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';

        if (!isImage && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
            isImage = true;
        }

        card.className = `chat-media-card${isImage ? ' is-image' : ' is-file'}`;
        const name = this._shortenFileName(f.name);
        const fileTokens = f.tokens ?? 0;

        if (isImage && f.data_base64.length > 0) {
            const mime = f.type || (ext === 'svg' ? 'image/svg+xml' : `image/${ext}`);
            card.innerHTML = `
                <img src="data:${mime};base64,${f.data_base64}" alt="${DOMPurify.sanitize(name)}" style="width:100%; height:100%; object-fit: cover; border-radius: 10px;">
                ${fileTokens > 0 ? `<div class="media-badge">${String(fileTokens)}</div>` : ''}
            `;
        } else {
            card.innerHTML = this._createFilePillHtml(f.name, fileTokens, name);
        }
        container.appendChild(card);
    }

    private _shortenFileName(name: string): string {
        if (name.length <= 25) return name;
        const extIndex = name.lastIndexOf('.');
        if (extIndex > 0) {
            const ext = name.substring(extIndex);
            return `${name.substring(0, 18)}..${ext}`;
        }
        return `${name.substring(0, 20)}..`;
    }
    /**
     * Appends images to a message bubble.
     */
    private _appendImages(
        bubble: HTMLElement,
        images?: { mime: string; data_base64: string }[],
    ): void {
        if (!images || images.length === 0) return;

        images.forEach((img) => {
            try {
                const mime = img.mime || 'image/png';
                const b64 = img.data_base64 || '';
                if (b64 === '') return;

                const wrapper = document.createElement('div');
                wrapper.className = 'chat-img-wrapper';

                const el = document.createElement('img');
                el.className = 'chat-img';
                el.src = `data:${mime};base64,${b64}`;
                el.alt = 'Generated image';
                el.addEventListener(
                    'load',
                    () => {
                        this._scrollToBottom(true);
                    },
                    { once: true },
                );

                wrapper.appendChild(el);
                bubble.appendChild(wrapper);
            } catch {
                /* ignore image errors */
            }
        });
    }

    private async _performSaveImage(b64: string, mime: string): Promise<SavedChatImage | null> {
        const result = await invoke<{ file_path: string; folder_path: string }>(
            'save_chat_image_default',
            {
                base64Data: b64,
                mimeType: mime,
            },
        );

        if (
            typeof result.file_path === 'string' &&
            result.file_path.length > 0 &&
            typeof result.folder_path === 'string' &&
            result.folder_path.length > 0
        ) {
            return {
                filePath: result.file_path,
                folderPath: result.folder_path,
            };
        }

        return null;
    }

    private async _handleSaveImageAction(
        saveBtn: HTMLButtonElement,
        b64: string,
        mime: string,
    ): Promise<void> {
        try {
            const savedImage = await this._performSaveImage(b64, mime);

            if (savedImage !== null) {
                saveBtn.classList.add('is-saved');
                saveBtn.disabled = true;
                saveBtn.innerHTML = ChatUI._checkIcon;
                this._promoteSaveButtonToFolder(
                    saveBtn,
                    savedImage.filePath,
                    savedImage.folderPath,
                );
            }
        } catch (e) {
            tracer.error('[ChatUI] Save image failed', e);
            const g = getGlobalWin();
            if (typeof g.showToast === 'function') {
                g.showToast(
                    typeof g.t === 'function'
                        ? g.t('ui.chat.image_save_failed', 'Failed to save image')
                        : 'Failed to save image',
                    'error',
                );
            }
        }
    }

    private _handleImageClick(e: MouseEvent): void {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;

        const image = target.closest('.chat-img');
        if (!(image instanceof HTMLImageElement)) return;

        e.preventDefault();
        e.stopPropagation();
        this._openImageViewer(image.currentSrc || image.src);
    }

    private _ensureImageViewer(): void {
        if (
            this._imageViewerOverlay instanceof HTMLElement &&
            this._imageViewerImage instanceof HTMLImageElement
        ) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'chat-image-viewer hidden';
        overlay.innerHTML = DOMPurify.sanitize(`
            <button type="button" class="chat-image-viewer-close" aria-label="Close image preview">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M5 4h2v2H5zm12 0h2v2h-2zM7 6h2v2H7zm8 0h2v2h-2zM9 8h2v2H9zm4 0h2v2h-2zM11 10h2v4h-2zM9 14h2v2H9zm4 0h2v2h-2zM7 16h2v2H7zm8 0h2v2h-2zM5 18h2v2H5zm12 0h2v2h-2z"></path>
                </svg>
            </button>
            <div class="chat-image-viewer-stage">
                <img class="chat-image-viewer-img" alt="Image preview">
            </div>
        `);

        overlay.addEventListener('click', (event) => {
            const eventTarget = event.target;
            if (!(eventTarget instanceof HTMLElement)) return;
            if (
                eventTarget === overlay ||
                eventTarget.closest('.chat-image-viewer-close') instanceof HTMLElement
            ) {
                this._closeImageViewer();
            }
        });

        document.body.appendChild(overlay);
        this._imageViewerOverlay = overlay;
        this._imageViewerImage = overlay.querySelector('.chat-image-viewer-img');
    }

    private _openImageViewer(src: string): void {
        this._ensureImageViewer();
        if (
            !(this._imageViewerOverlay instanceof HTMLElement) ||
            !(this._imageViewerImage instanceof HTMLImageElement)
        ) {
            return;
        }

        this._imageViewerImage.src = src;
        this._imageViewerOverlay.classList.remove('hidden');
        document.body.classList.add('chat-image-viewer-open');
        document.addEventListener('keydown', this._boundImageViewerKeydown);
    }

    private _closeImageViewer(): void {
        if (!(this._imageViewerOverlay instanceof HTMLElement)) return;

        this._imageViewerOverlay.classList.add('hidden');
        document.body.classList.remove('chat-image-viewer-open');
        document.removeEventListener('keydown', this._boundImageViewerKeydown);
    }

    private _promoteSaveButtonToFolder(
        saveBtn: HTMLButtonElement,
        filePath: string,
        folderPath: string,
    ): void {
        const t = getGlobalWin().t;

        this._setManagedTimeout(() => {
            if (this._isDestroyed || !document.body.contains(saveBtn)) {
                return;
            }
            saveBtn.disabled = false;
            saveBtn.classList.remove('chat-save-image-btn', 'is-saved');
            saveBtn.classList.add('chat-open-image-folder-btn');
            saveBtn.dataset['filePath'] = filePath;
            saveBtn.dataset['folderPath'] = folderPath;
            saveBtn.title =
                typeof t === 'function'
                    ? t('ui.chat.open_image_folder', 'Open image folder')
                    : 'Open image folder';
            saveBtn.innerHTML = ChatUI._folderIcon;
        }, ChatUI._imageResetDelayMs);
    }

    private _restoreFolderButtonToSave(saveBtn: HTMLButtonElement): void {
        const t = getGlobalWin().t;
        saveBtn.disabled = false;
        saveBtn.classList.remove(
            'chat-open-image-folder-btn',
            'is-saved',
            'is-resetting',
            'is-trash-state',
        );
        saveBtn.classList.add('chat-save-image-btn');
        delete saveBtn.dataset['filePath'];
        delete saveBtn.dataset['folderPath'];
        saveBtn.title =
            typeof t === 'function' ? t('ui.chat.save_image', 'Save Image') : 'Save Image';
        saveBtn.innerHTML = ChatUI._downloadIcon;
    }

    private _setFolderButtonState(
        saveBtn: HTMLButtonElement,
        filePath: string,
        folderPath: string,
    ): void {
        const t = getGlobalWin().t;
        saveBtn.disabled = false;
        saveBtn.classList.remove(
            'chat-save-image-btn',
            'is-saved',
            'is-resetting',
            'is-trash-state',
        );
        saveBtn.classList.add('chat-open-image-folder-btn');
        saveBtn.dataset['filePath'] = filePath;
        saveBtn.dataset['folderPath'] = folderPath;
        saveBtn.title =
            typeof t === 'function'
                ? t('ui.chat.open_image_folder', 'Open image folder')
                : 'Open image folder';
        saveBtn.innerHTML = ChatUI._folderIcon;
    }

    private _animateFolderButtonReset(saveBtn: HTMLButtonElement): void {
        if (!saveBtn.classList.contains('chat-open-image-folder-btn')) return;
        if (saveBtn.classList.contains('is-resetting')) return;

        saveBtn.disabled = true;
        saveBtn.classList.add('is-resetting', 'is-trash-state');
        saveBtn.innerHTML = ChatUI._trashIcon;
    }

    private async _deleteSavedImage(saveBtn: HTMLButtonElement): Promise<void> {
        const filePath = saveBtn.dataset['filePath'];
        const folderPath = saveBtn.dataset['folderPath'];
        if (
            typeof filePath !== 'string' ||
            filePath.length === 0 ||
            typeof folderPath !== 'string' ||
            folderPath.length === 0
        ) {
            this._restoreFolderButtonToSave(saveBtn);
            return;
        }

        this._animateFolderButtonReset(saveBtn);

        const animationDelay = new Promise((resolve) => {
            globalThis.setTimeout(resolve, ChatUI._imageResetDelayMs);
        });
        const deleteRequest = invoke('delete_chat_image', { filePath });

        try {
            await Promise.all([deleteRequest, animationDelay]);
            this._restoreFolderButtonToSave(saveBtn);
        } catch (e) {
            tracer.error('[ChatUI] Delete saved image failed', e);
            await animationDelay;
            this._setFolderButtonState(saveBtn, filePath, folderPath);

            const g = getGlobalWin();
            if (typeof g.showToast === 'function') {
                g.showToast(
                    typeof g.t === 'function'
                        ? g.t('ui.chat.image_delete_failed', 'Failed to delete image')
                        : 'Failed to delete image',
                    'error',
                );
            }
        }
    }

    private async _openImageLocation(
        saveBtn: HTMLButtonElement,
        filePath: string,
        folderPath: string,
    ): Promise<void> {
        const g = getGlobalWin();
        const handleMissing = (): void => {
            this._restoreFolderButtonToSave(saveBtn);
            void invoke('open_chat_image_location', { filePath: folderPath, folderPath }).catch(
                () => {
                    /* ignore fallback folder-open errors */
                },
            );
            if (typeof g.showToast === 'function') {
                g.showToast(
                    typeof g.t === 'function'
                        ? g.t('ui.chat.image_missing_resave', 'Image was removed, save it again')
                        : 'Image was removed, save it again',
                    'warning',
                );
            }
        };

        try {
            await invoke('open_chat_image_location', { filePath, folderPath });
        } catch (e) {
            const message = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
            const normalized = message.toLowerCase();
            const isMissing =
                normalized.includes('does not exist') ||
                normalized.includes('not found') ||
                normalized.includes('saved image does not exist') ||
                normalized.includes('not_found');
            if (isMissing) {
                handleMissing();
                return;
            }

            tracer.error('[ChatUI] Open image location failed', e);
            if (typeof g.showToast === 'function') {
                g.showToast(
                    typeof g.t === 'function'
                        ? g.t('ui.chat.image_open_folder_failed', 'Failed to open image folder')
                        : 'Failed to open image folder',
                    'error',
                );
            }
        }
    }

    public updateAttachments(files: File[], onRemove: (index: number) => void): void {
        if (!this._attachmentsContainer) return;
        const renderVersion = ++this._attachmentRenderVersion;

        this._revokeAttachmentObjectUrls();
        this._attachmentsContainer.innerHTML = '';
        if (!files.length) {
            this._attachmentsContainer.classList.add('hidden');
            this._attachmentsContainer.style.display = 'none';
            return;
        }
        this._attachmentsContainer.classList.remove('hidden');
        this._attachmentsContainer.style.display = '';
        this._attachmentsContainer.classList.add('visible');

        const maxVisible = 6;
        const visibleFiles = files.slice(0, maxVisible);
        const hiddenCount = files.length - maxVisible;

        visibleFiles.forEach((f, idx) => {
            void this._renderPendingAttachment(f, idx, onRemove, renderVersion);
        });

        if (hiddenCount > 0) {
            const moreCard = document.createElement('div');
            moreCard.className = 'chat-media-card more-card';
            moreCard.innerHTML = `<span>+${String(hiddenCount)}</span>`;
            this._attachmentsContainer.appendChild(moreCard);
        }
    }

    private async _renderPendingAttachment(
        f: File,
        idx: number,
        onRemove: (idx: number) => void,
        renderVersion: number,
    ): Promise<void> {
        const card = document.createElement('div');
        const isImage = f.type.startsWith('image/');
        card.className = `chat-media-card${isImage ? ' is-image' : ' is-file'}`;

        const fileTokens = await chatFileHandler.getFileTokenEstimate(f);
        if (
            this._isDestroyed ||
            renderVersion !== this._attachmentRenderVersion ||
            !(this._attachmentsContainer instanceof HTMLElement)
        ) {
            return;
        }
        const name = this._shortenFileName(f.name);
        if (isImage) {
            const objectUrl = URL.createObjectURL(f);
            this._attachmentObjectUrls.add(objectUrl);

            const imageEl = document.createElement('img');
            imageEl.src = objectUrl;
            imageEl.alt = name;
            imageEl.style.width = '100%';
            imageEl.style.height = '100%';
            imageEl.style.objectFit = 'cover';
            imageEl.style.borderRadius = '10px';
            imageEl.style.opacity = '0.9';

            const releaseObjectUrl = (): void => {
                this._releaseAttachmentObjectUrl(objectUrl);
                imageEl.onload = null;
                imageEl.onerror = null;
            };

            imageEl.onload = releaseObjectUrl;
            imageEl.onerror = releaseObjectUrl;
            card.appendChild(imageEl);

            if (fileTokens > 0) {
                const badge = document.createElement('div');
                badge.className = 'media-badge';
                badge.textContent = String(fileTokens);
                card.appendChild(badge);
            }
        } else {
            card.innerHTML = this._createFilePillHtml(f.name, fileTokens, name);
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'media-remove';
        btn.title = getGlobalWin().t('ui.launcher.web.remove_attachment', 'Remove attachment');
        btn.textContent = '×';
        btn.onclick = (e) => {
            e.stopPropagation();
            onRemove(idx);
        };
        card.appendChild(btn);

        this._attachmentsContainer.appendChild(card);
    }

    private _revokeAttachmentObjectUrls(): void {
        for (const objectUrl of this._attachmentObjectUrls) {
            URL.revokeObjectURL(objectUrl);
        }
        this._attachmentObjectUrls.clear();
    }

    private _releaseAttachmentObjectUrl(objectUrl: string): void {
        if (!this._attachmentObjectUrls.has(objectUrl)) {
            return;
        }

        URL.revokeObjectURL(objectUrl);
        this._attachmentObjectUrls.delete(objectUrl);
    }

    private _createFilePillHtml(originalName: string, tokens: number, displayName: string): string {
        const iconSvg = (() => {
            try {
                return getFileIcon(originalName);
            } catch {
                return '📄';
            }
        })();

        const t = getGlobalWin().t;
        const tokensLabel = t('ui.launcher.web.tokens', 'tokens');
        const tokensHtml =
            tokens > 0 ? `<div class="media-tokens">${String(tokens)} ${tokensLabel}</div>` : '';

        return `
            <div class="media-icon">${DOMPurify.sanitize(iconSvg)}</div>
            <div class="media-info">
                <div class="media-name">${DOMPurify.sanitize(displayName)}</div>
                ${tokensHtml}
            </div>
        `;
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

    /**
     * Handles clicks on the "Copy" button in code blocks.
     */
    private async _handleCopyClick(e: MouseEvent): Promise<void> {
        const target = e.target as HTMLElement;
        const editBtn = target.closest('.chat-edit-own-btn');
        if (editBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();

            const text = editBtn.dataset['editText'] ?? '';
            if (text !== '' && this._editMessageHandler !== null) {
                await this._editMessageHandler(text);
            }
            return;
        }

        const ownBtn = target.closest('.chat-copy-own-btn');
        if (ownBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();

            const text = ownBtn.dataset['copyText'] ?? '';
            if (text === '') return;

            try {
                await this._copyToClipboard(text);
                this._showCopyResult(ownBtn, true);
            } catch (err) {
                tracer.error('[ChatUI] Message copy failed:', err);
                this._showCopyResult(ownBtn, false);
            }
            return;
        }

        const btn = target.closest('.code-copy-btn');
        if (btn === null) return;

        e.preventDefault();
        e.stopPropagation();

        const wrapper = btn.closest('.code-block-wrapper');
        const codeEl = wrapper?.querySelector('code');
        const text = codeEl?.textContent ?? '';
        if (text === '') return;

        try {
            await this._copyToClipboard(text);
            this._showCopyResult(btn as HTMLElement, true);
        } catch (err) {
            tracer.error('[ChatUI] Copy failed:', err);
            this._showCopyResult(btn as HTMLElement, false);
        }
    }

    private async _copyToClipboard(text: string): Promise<void> {
        const win = getGlobalWin();
        const isTauri = win.__TAURI_INTERNALS__ !== undefined;
        if (isTauri) {
            try {
                await invoke('plugin:clipboard-manager|write_text', { text });
                return;
            } catch {
                // Fallback to navigator
            }
        }
        await navigator.clipboard.writeText(text);
    }

    private _showCopyResult(btn: HTMLElement, success: boolean): void {
        if (!success) {
            this.showToast(
                getGlobalWin().t('ui.launcher.web.copy_failed', 'Failed to copy code'),
                'error',
            );
            return;
        }

        const originalHtml = btn.innerHTML;
        btn.classList.add('is-copied');

        btn.innerHTML = DOMPurify.sanitize(`
            <svg class="icon-check" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M10 18H8v-2h2v2Zm-2-2H6v-2h2v2Zm4-2v2h-2v-2h2Zm-6 0H4v-2h2v2Zm8 0h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2V8h2v2Zm2-2h-2V6h2v2Z"></path>
            </svg>
        `);

        this._setManagedTimeout(() => {
            if (this._isDestroyed || !document.body.contains(btn)) {
                return;
            }
            btn.classList.remove('is-copied');
            btn.innerHTML = originalHtml;
        }, 1200);
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
                this._chatInput.placeholder = t(placeholderKey, 'Ask something...');
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

        document.querySelectorAll<HTMLElement>('.chat-copy-own-btn').forEach((btn) => {
            btn.title = t('ui.launcher.web.copy', 'Copy');
        });

        document.querySelectorAll<HTMLElement>('.chat-edit-own-btn').forEach((btn) => {
            btn.title = t('ui.launcher.web.edit_last', 'Edit last message');
        });

        document.querySelectorAll<HTMLElement>('.code-copy-btn').forEach((btn) => {
            btn.title = t('ui.launcher.web.copy_code', 'Copy code');
            const label = btn.querySelector('span');
            if (label !== null) {
                label.textContent = t('ui.launcher.web.copy', 'Copy');
            }
        });

        document.querySelectorAll<HTMLElement>('.chat-save-image-btn').forEach((btn) => {
            btn.title = t('ui.chat.save_image', 'Save Image');
        });

        document.querySelectorAll<HTMLElement>('.chat-open-image-folder-btn').forEach((btn) => {
            btn.title = t('ui.chat.open_image_folder', 'Open image folder');
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
