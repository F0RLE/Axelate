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

export class ChatUI {
    private _lastEditableUserActionBar: HTMLElement | null = null;
    private _editMessageHandler: ((text: string) => void | Promise<void>) | null = null;
    private readonly _boundDocumentClick: (e: Event) => void;
    private _retryStatusUnlisten: (() => void) | null = null;
    private _isInitialized = false;
    private _isDestroyed = false;

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
            if (!e.target.closest('#chat-messages')) return;
            void this._handleMessageClick(e as MouseEvent);
            void this._handleCopyClick(e as MouseEvent);
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
                        <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>${getGlobalWin().t('ui.launcher.web.copy', 'Copy')}</span>
                     </button>
                 </div>
                 <pre><code class="language-${language}">${escaped === true ? text : text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
             </div>
             `;
        };

        marked.use({ renderer });

        document.addEventListener('click', this._boundDocumentClick);
    }

    /**
     * Initializes the ChatUI component.
     */
    public async init(): Promise<void> {
        if (this._isInitialized || this._isDestroyed) return;
        this._isInitialized = true;
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

        for (const timeout of this._typingTimeouts.values()) {
            clearTimeout(timeout);
        }
        this._typingTimeouts.clear();
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
        const actions = this._appendMessageActions(safeContent, role);
        const textNode = this._createMessageTextNode(safeContent, opts);
        bubble.appendChild(textNode);

        this._appendAttachments(bubble, opts['attachments'] as IChatAttachment[]);
        this._appendImages(bubble, opts['images'] as { mime: string; data_base64: string }[]);
        this._appendMeta(bubble, opts['tokens'] as number | undefined);
        if (actions !== null) bubble.appendChild(actions.actionBar);

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
        finalize: (fullContent: unknown, finalOpts?: Record<string, unknown>) => void;
    } {
        this._prepareContainer();

        const row = document.createElement('div');
        row.className = `chat-row ${role === 'user' ? 'user' : 'bot'}`;

        const bubble = this._createMessageBubble(opts);
        const actions = this._appendMessageActions('', role);
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

                if (shouldRender) {
                    try {
                        // For very short text or first few chunks, skip full Markdown parse for speed
                        if (
                            accumulatedText.length < 50 &&
                            !accumulatedText.includes('`') &&
                            !accumulatedText.includes('\n')
                        ) {
                            textNode.textContent = accumulatedText;
                        } else {
                            // marked.parse can return a Promise if async plugins are used
                            const parseResult = marked.parse(accumulatedText);
                            if (parseResult instanceof Promise) {
                                void parseResult.then((rawHtml) => {
                                    textNode.innerHTML = DOMPurify.sanitize(rawHtml);
                                });
                            } else {
                                textNode.innerHTML = DOMPurify.sanitize(parseResult);
                            }
                        }
                    } catch {
                        textNode.textContent = accumulatedText;
                    }
                    lastRenderTime = now;
                }

                this._scrollToBottom(true);
            },
            replace: (text: string) => {
                accumulatedText = text;
                if (copyBtn instanceof HTMLElement) {
                    copyBtn.dataset['copyText'] = accumulatedText;
                }
                renderCounter++;
                const now = Date.now();

                try {
                    const parseResult = marked.parse(text);
                    if (parseResult instanceof Promise) {
                        void parseResult.then((rawHtml) => {
                            textNode.innerHTML = DOMPurify.sanitize(rawHtml);
                        });
                    } else {
                        textNode.innerHTML = DOMPurify.sanitize(parseResult);
                    }
                } catch {
                    textNode.textContent = text;
                }

                lastRenderTime = now;
                this._scrollToBottom(true);
            },
            finalize: (fullContent: unknown, finalOpts: Record<string, unknown> = {}) => {
                const safeFullContent = this._safeExtractText(fullContent);
                if (copyBtn instanceof HTMLElement) {
                    copyBtn.dataset['copyText'] = safeFullContent;
                }

                try {
                    const parseResult = marked.parse(safeFullContent);
                    if (parseResult instanceof Promise) {
                        void parseResult.then((finalHtml) => {
                            textNode.innerHTML = DOMPurify.sanitize(finalHtml);
                            this._scrollToBottom();
                        });
                    } else {
                        textNode.innerHTML = DOMPurify.sanitize(parseResult);
                    }
                } catch {
                    textNode.textContent = safeFullContent;
                }

                if (finalOpts['attachments'] !== undefined) {
                    this._appendAttachments(bubble, finalOpts['attachments'] as IChatAttachment[]);
                }
                if (finalOpts['images'] !== undefined) {
                    this._appendImages(
                        bubble,
                        finalOpts['images'] as { mime: string; data_base64: string }[],
                    );
                }

                this._appendMeta(bubble, finalOpts['tokens'] as number | undefined);
                if (actions !== null && !bubble.contains(actions.actionBar)) {
                    bubble.appendChild(actions.actionBar);
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
        globalThis.setTimeout(() => {
            this._scrollToBottom();
        }, 120);
    }

    /**
     * Creates a message bubble element.
     */
    private _createMessageBubble(opts: Record<string, unknown>): HTMLElement {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble${opts['error'] === true ? ' chat-error' : ''}`;
        return bubble;
    }

    private _appendMessageActions(
        content: string,
        role: 'user' | 'assistant',
    ): { actionBar: HTMLElement; copyBtn: HTMLElement; editBtn: HTMLElement | null } | null {
        const actionBar = document.createElement('div');
        actionBar.className = `chat-message-actions ${role === 'user' ? 'is-user' : 'is-bot'}`;

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'chat-copy-own-btn';
        copyBtn.dataset['copyText'] = content;
        copyBtn.title = getGlobalWin().t('ui.launcher.web.copy', 'Copy');
        copyBtn.innerHTML = DOMPurify.sanitize(`
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        `);
        actionBar.appendChild(copyBtn);

        let editBtn: HTMLButtonElement | null = null;
        if (role === 'user') {
            editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'chat-edit-own-btn';
            editBtn.dataset['editText'] = content;
            editBtn.title = getGlobalWin().t('ui.launcher.web.edit_last', 'Edit last message');
            editBtn.innerHTML = DOMPurify.sanitize(`
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                </svg>
            `);
            actionBar.appendChild(editBtn);
            this._setLastEditableUserActionBar(actionBar);
        }

        return { actionBar, copyBtn, editBtn };
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
                wrapper.style.position = 'relative';
                wrapper.style.display = 'inline-block';
                wrapper.style.maxWidth = '100%';

                const el = document.createElement('img');
                el.className = 'chat-img';
                el.src = `data:${mime};base64,${b64}`;
                el.style.display = 'block';
                el.style.maxWidth = '100%';
                el.style.borderRadius = 'var(--radius-md)';
                el.addEventListener(
                    'load',
                    () => {
                        this._scrollToBottom(true);
                    },
                    { once: true },
                );

                const btn = document.createElement('button');
                btn.className = 'chat-img-download-btn';
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

                const g = getGlobalWin();
                btn.title =
                    typeof g.t === 'function'
                        ? g.t('ui.chat.save_image', 'Save Image')
                        : 'Save Image';

                // Add basic overlay styling directly for now
                btn.style.position = 'absolute';
                btn.style.bottom = '10px';
                btn.style.right = '10px';
                btn.style.background = 'rgba(0,0,0,0.6)';
                btn.style.color = 'white';
                btn.style.border = 'none';
                btn.style.borderRadius = 'var(--radius-sm)';
                btn.style.padding = '6px';
                btn.style.cursor = 'pointer';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'center';
                btn.style.transition = 'background 0.2s';

                btn.onmouseenter = () => (btn.style.background = 'rgba(0,0,0,0.8)');
                btn.onmouseleave = () => (btn.style.background = 'rgba(0,0,0,0.6)');

                btn.onclick = () => {
                    void this._downloadImageBase64(b64, mime);
                };

                wrapper.appendChild(el);
                wrapper.appendChild(btn);
                bubble.appendChild(wrapper);
            } catch {
                /* ignore image errors */
            }
        });
    }

    private _base64ToBytes(b64: string): Uint8Array {
        const binaryString = atob(b64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.codePointAt(i) ?? 0;
        }
        return bytes;
    }

    private async _performSaveImage(b64: string, ext: string): Promise<string | null> {
        type DialogModule = {
            save(opts: {
                filters: { name: string; extensions: string[] }[];
                defaultPath: string;
            }): Promise<string | null>;
        };
        type FsModule = {
            writeFile(path: string, contents: Uint8Array): Promise<void>;
        };

        const dialogPlugin = (await import('@tauri-apps/plugin-dialog')) as unknown as DialogModule;
        const fsPlugin = (await import('@tauri-apps/plugin-fs')) as unknown as FsModule;

        const saveDialog = dialogPlugin.save;
        const writeFile = fsPlugin.writeFile;

        if (typeof saveDialog !== 'function' || typeof writeFile !== 'function') {
            throw new TypeError('Could not find Tauri save/writeFile plugins.');
        }

        const filePath = await saveDialog({
            filters: [{ name: 'Image', extensions: [ext] }],
            defaultPath: `generated_image_${Date.now()}.${ext}`,
        });

        if (typeof filePath === 'string' && filePath.length > 0) {
            const bytes = this._base64ToBytes(b64);
            await writeFile(filePath, bytes);
            return filePath;
        }
        return null;
    }

    private async _downloadImageBase64(b64: string, mime: string): Promise<void> {
        try {
            let ext = 'png';
            if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
            if (mime.includes('webp')) ext = 'webp';

            const filePath = await this._performSaveImage(b64, ext);

            if (filePath !== null) {
                const g = getGlobalWin();
                if (typeof g.showToast === 'function') {
                    g.showToast(
                        typeof g.t === 'function'
                            ? g.t('ui.chat.image_saved', 'Image saved successfully')
                            : 'Image saved successfully',
                        'success',
                    );
                }
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

    /**
     * Appends metadata (time and tokens) to a message bubble.
     */
    private _appendMeta(bubble: HTMLElement, tokens?: number): void {
        void bubble;
        void tokens;
    }

    public updateAttachments(files: File[], onRemove: (index: number) => void): void {
        if (!this._attachmentsContainer) return;

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
            void this._renderPendingAttachment(f, idx, onRemove);
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
    ): Promise<void> {
        const card = document.createElement('div');
        const isImage = f.type.startsWith('image/');
        card.className = `chat-media-card${isImage ? ' is-image' : ' is-file'}`;

        const fileTokens = await chatFileHandler.getFileTokenEstimate(f);
        const name = this._shortenFileName(f.name);

        const contentHtml = isImage
            ? (() => {
                  const objectUrl = URL.createObjectURL(f);
                  const badgeHtml =
                      fileTokens > 0 ? `<div class="media-badge">${String(fileTokens)}</div>` : '';
                  return `<img src="${objectUrl}" style="width:100%; height:100%; object-fit: cover; border-radius: 10px; opacity: 0.9;" alt="${DOMPurify.sanitize(name)}" onload="URL.revokeObjectURL(this.src)">${badgeHtml}`;
              })()
            : this._createFilePillHtml(f.name, fileTokens, name);

        card.innerHTML = `
            ${contentHtml}
            <button type="button" class="media-remove" title="${getGlobalWin().t('ui.launcher.web.remove_attachment', 'Remove attachment')}">×</button>
        `;

        const btn: HTMLElement | null = card.querySelector('.media-remove');
        if (btn !== null) {
            btn.onclick = (e) => {
                e.stopPropagation();
                onRemove(idx);
            };
        }

        if (this._attachmentsContainer) {
            this._attachmentsContainer.appendChild(card);
        }
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
            <svg class="icon-check" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `);

        setTimeout(() => {
            btn.classList.remove('is-copied');
            btn.innerHTML = originalHtml;
        }, 1200);
    }

    /**
     * Updates the token count display.
     */
    public updateTokenCount(count: number): void {
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

        document.querySelectorAll<HTMLElement>('.chat-img-download-btn').forEach((btn) => {
            btn.title = t('ui.chat.save_image', 'Save Image');
        });

        document.querySelectorAll<HTMLElement>('.media-remove').forEach((btn) => {
            btn.title = t('ui.launcher.web.remove_attachment', 'Remove attachment');
        });

        // 3. Token count (if visible)
        if (this._tokenCount?.classList.contains('visible') === true) {
            const count = Number.parseInt(this._tokenCount.textContent || '0', 10);
            if (!Number.isNaN(count)) {
                this.updateTokenCount(count);
            }
        }
    }
}
