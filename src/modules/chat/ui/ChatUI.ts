import { marked } from 'marked';
import markedFootnote from 'marked-footnote';
import markedKatex from 'marked-katex-extension';
import markedAlert from 'marked-alert';
import 'katex/dist/katex.min.css';

interface ITauri {
    core: {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    event: {
        listen: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;
    };
}

interface IGlobal {
    __TAURI__?: ITauri;
    t: (key: string, defaultVal?: string, params?: Record<string, unknown>) => string;
    showToast?: (msg: string, type: 'success' | 'error' | 'warning', duration?: number) => void;
}

// Configure marked
marked.use(markedAlert());
marked.use(
    markedKatex({
        throwOnError: false,
    }),
);
// Syntax highlighting removed by user request

marked.use(markedFootnote());
marked.use({
    breaks: true,
    gfm: true,
});

import { chatFileHandler } from '../services/ChatFileHandler';
import { IChatRole, IChatAttachment } from '../types/chatTypes';
import { getFileIcon } from '../utils/chatUtils';
import DOMPurify from 'dompurify';

export class ChatUI {
    private readonly _messagesContainer: HTMLElement | null;
    private readonly _chatContainer: HTMLElement | null;
    private readonly _attachmentsContainer: HTMLElement | null;
    private readonly _typingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

    constructor() {
        this._messagesContainer = document.getElementById('chat-messages');
        this._chatContainer = document.getElementById('chat-container');
        this._attachmentsContainer = document.getElementById('chat-attachments');

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
            const language = lang || 'text';
            // Simple UUID-like for uniqueness if needed, but we rely on DOM traversal
            return `
             <div class="code-block-wrapper">
                 <div class="code-block-header">
                     <span class="code-lang">${language}</span>
                     <button class="code-copy-btn" title="Copy code">
                        <!-- Simple Copy Icon -->
                        <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy</span>
                     </button>
                 </div>
                 <pre><code class="language-${language}">${escaped ? text : text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
             </div>
             `;
        };

        marked.use({ renderer });

        // Bind event listeners
        if (this._messagesContainer) {
            this._messagesContainer.addEventListener('click', this._handleMessageClick.bind(this));
            this._messagesContainer.addEventListener('click', this._handleCopyClick.bind(this));
        }
    }

    /**
     * Initializes the ChatUI component.
     */
    public async init(): Promise<void> {
        // Bind AI events
        await this._bindAiEvents();
    }

    private async _bindAiEvents(): Promise<void> {
        const g = globalThis as unknown as IGlobal;
        if (g.__TAURI__?.event) {
            await g.__TAURI__.event.listen<{ code: string; wait_seconds: number }>(
                'ai:status:retry',
                (e) => {
                    const { code, wait_seconds } = e.payload;
                    if (code === 'GEMINI_QUOTA_RETRY') {
                        // Show toast or update UI
                        const msg = g.t(
                            'ui.gemini.status.retry',
                            'Rate limited. Retrying in {seconds}s...',
                            {
                                seconds: wait_seconds,
                            },
                        );
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
                            if (old) old.remove();

                            typing.parentElement?.appendChild(label);
                        }
                    }
                },
            );
        }
    }

    /**
     * Clears all messages and attachments from the UI.
     */
    public clear(): void {
        if (this._messagesContainer) {
            this._messagesContainer.innerHTML = '';
            this._messagesContainer.classList.remove('has-messages');
        }
        if (this._chatContainer) {
            this._chatContainer.classList.remove('has-messages');
        }
        this.updateAttachments([], () => {});
    }

    /**
     * Appends a new message to the chat container.
     */
    public appendMessage(
        role: IChatRole,
        content: string,
        opts: Record<string, unknown> = {},
    ): void {
        this._prepareContainer();

        const row = document.createElement('div');
        row.className = 'chat-row ' + (role === 'user' ? 'user' : 'bot');

        const bubble = this._createMessageBubble(opts);
        const textNode = this._createMessageTextNode(content, opts);
        bubble.appendChild(textNode);

        this._appendAttachments(bubble, opts.attachments as IChatAttachment[]);
        this._appendImages(bubble, opts.images as { mime: string; data_base64: string }[]);
        this._appendMeta(bubble, opts.tokens as number | undefined);

        row.appendChild(bubble);
        this._messagesContainer!.appendChild(row);
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
        update: (chunk: string) => void;
        finalize: (fullContent: string, finalOpts?: Record<string, unknown>) => void;
    } {
        this._prepareContainer();

        const row = document.createElement('div');
        row.className = 'chat-row ' + (role === 'user' ? 'user' : 'bot');

        const bubble = this._createMessageBubble(opts);
        const textNode = document.createElement('div');
        textNode.className = 'markdown-body';
        bubble.appendChild(textNode);

        row.appendChild(bubble);
        this._messagesContainer!.appendChild(row);
        this._scrollToBottom();

        let accumulatedText = '';
        let renderCounter = 0;
        let lastRenderTime = Date.now();

        return {
            textNode,
            update: (chunk: string) => {
                accumulatedText += chunk;
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
                            const rawHtml = marked.parse(accumulatedText) as string;
                            textNode.innerHTML = DOMPurify.sanitize(rawHtml);
                        }
                    } catch {
                        textNode.textContent = accumulatedText;
                    }
                    lastRenderTime = now;
                }

                this._scrollToBottom(true);
            },
            finalize: (fullContent: string, finalOpts: Record<string, unknown> = {}) => {
                try {
                    const finalHtml = marked.parse(fullContent) as string;
                    textNode.innerHTML = DOMPurify.sanitize(finalHtml);
                } catch {
                    textNode.textContent = fullContent;
                }

                if (finalOpts.attachments) {
                    this._appendAttachments(bubble, finalOpts.attachments as IChatAttachment[]);
                }
                if (finalOpts.images) {
                    this._appendImages(
                        bubble,
                        finalOpts.images as { mime: string; data_base64: string }[],
                    );
                }

                this._appendMeta(bubble, finalOpts.tokens as number | undefined);
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
            const threshold = 150; // px
            const isAtBottom =
                this._messagesContainer.scrollHeight -
                    this._messagesContainer.scrollTop -
                    this._messagesContainer.clientHeight <
                threshold;
            if (!isAtBottom) return;
        }

        this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
    }

    /**
     * Creates a message bubble element.
     */
    private _createMessageBubble(opts: Record<string, unknown>): HTMLElement {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble' + (opts.error ? ' chat-error' : '');
        return bubble;
    }

    /**
     * Creates a text node for a message, supporting i18n and Markdown.
     */
    private _createMessageTextNode(content: string, opts: Record<string, unknown>): HTMLElement {
        const textNode = document.createElement('div');
        textNode.className = 'markdown-body'; // Helper class for styling
        const g = globalThis as unknown as IGlobal;

        let finalContent = content || '';

        if (opts.i18nKey) {
            const i18nKey = typeof opts.i18nKey === 'string' ? opts.i18nKey : '';
            if (i18nKey) {
                textNode.dataset.i18n = i18nKey;
                if (opts.i18nParams) {
                    textNode.dataset.i18nParams = JSON.stringify(opts.i18nParams);
                }
                finalContent = g.t(i18nKey, content, opts.i18nParams as Record<string, string>);
            }
        } else if (opts.i18nPrefixKey) {
            const prefixKey = typeof opts.i18nPrefixKey === 'string' ? opts.i18nPrefixKey : '';
            if (prefixKey) {
                textNode.dataset.i18nPrefix = prefixKey;
                const prefix = g.t(prefixKey, 'Error: ');
                finalContent = prefix + (content || '');
            }
        }

        // Render Markdown
        try {
            const rawHtml = marked.parse(finalContent) as string;
            textNode.innerHTML = DOMPurify.sanitize(rawHtml);
        } catch (e) {
            console.error('[ChatUI] Markdown render error:', e);
            textNode.textContent = finalContent;
        }

        return textNode;
    }

    /**
     * Appends attachments to a message bubble.
     */
    private _appendAttachments(bubble: HTMLElement, attachments?: IChatAttachment[]): void {
        if (!attachments || attachments.length === 0) return;

        const attachContainer = document.createElement('div');
        attachContainer.className = 'chat-message-attachments';
        // Removed legacy inline styles to favor CSS class

        // Limit visible attachments in bubble
        const maxVisible = 6;
        const visibleAttachments = attachments.slice(0, maxVisible);
        const hiddenCount = attachments.length - maxVisible;

        visibleAttachments.forEach((f) => {
            const card = document.createElement('div');

            let isImage = f.type?.startsWith('image/');
            const ext = f.name?.split('.').pop()?.toLowerCase() || '';
            if (!isImage && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
                isImage = true;
            }

            card.className = 'chat-media-card' + (isImage ? ' is-image' : ' is-file');

            const hasData = !!f.data_base64;
            const name = this._shortenFileName(f.name || 'file');
            const fileTokens = f.tokens || 0;

            if (isImage && hasData) {
                // Image Preview Mode
                const mime = f.type || (ext === 'svg' ? 'image/svg+xml' : `image/${ext}`);
                card.innerHTML = `
                <img src="data:${mime};base64,${f.data_base64}" alt="${DOMPurify.sanitize(name)}" style="width:100%; height:100%; object-fit: cover; border-radius: 10px;">
                ${fileTokens > 0 ? `<div class="media-badge">${fileTokens}</div>` : ''}
            `;
            } else {
                // Standard File Mode (Pill UI)
                const iconSvg = getFileIcon(f.name);
                card.innerHTML = `
                <div class="media-icon">${DOMPurify.sanitize(iconSvg)}</div>
                <div class="media-info">
                    <div class="media-name">${DOMPurify.sanitize(name)}</div>
                    ${fileTokens > 0 ? `<div class="media-tokens">${fileTokens} tokens</div>` : ''}
                </div>
            `;
            }
            attachContainer.appendChild(card);
        });

        if (hiddenCount > 0) {
            const moreCard = document.createElement('div');
            moreCard.className = 'chat-media-card more-card';
            moreCard.innerHTML = `<span>+${hiddenCount}</span>`;
            attachContainer.appendChild(moreCard);
        }

        bubble.appendChild(attachContainer);
    }

    /**
     * Shortens a file name for display.
     */
    private _shortenFileName(name: string): string {
        if (name.length <= 25) return name;
        const extIndex = name.lastIndexOf('.');
        if (extIndex > 0) {
            const ext = name.substring(extIndex);
            return name.substring(0, 18) + '..' + ext;
        }
        return name.substring(0, 20) + '..';
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
                if (!b64) return;
                const el = document.createElement('img');
                el.className = 'chat-img';
                el.src = `data:${mime};base64,${b64}`;
                bubble.appendChild(el);
            } catch {
                /* ignore image errors */
            }
        });
    }

    /**
     * Appends metadata (time and tokens) to a message bubble.
     */
    private _appendMeta(bubble: HTMLElement, tokens?: number): void {
        const meta = document.createElement('div');
        meta.className = 'chat-meta';

        // Time
        const timeSpan = document.createElement('span');
        timeSpan.textContent = new Date().toLocaleTimeString();
        meta.appendChild(timeSpan);

        // Tokens
        if (typeof tokens === 'number' && tokens > 0) {
            const tokenSpan = document.createElement('span');
            tokenSpan.className = 'chat-tokens';
            tokenSpan.textContent = `${tokens} ${tokens === 1 ? 'token' : 'tokens'}`;
            meta.appendChild(tokenSpan);
        }

        bubble.appendChild(meta);
    }

    /**
     * Updates the attachment list in the UI.
     */
    public updateAttachments(files: File[], onRemove: (_index: number) => void): void {
        if (!this._attachmentsContainer) return;

        this._attachmentsContainer.innerHTML = '';
        if (!files.length) {
            this._attachmentsContainer.classList.add('hidden');
            return;
        }
        this._attachmentsContainer.classList.remove('hidden');
        this._attachmentsContainer.classList.add('visible');

        const maxVisible = 6;
        const visibleFiles = files.slice(0, maxVisible);
        const hiddenCount = files.length - maxVisible;

        visibleFiles.forEach(async (f, idx) => {
            const card = document.createElement('div');
            const isImage = f.type.startsWith('image/');
            card.className = 'chat-media-card' + (isImage ? ' is-image' : ' is-file');

            let contentHtml = '';
            let name = f.name || 'file';

            // Relaxed limit for names in horizontal layout
            if (name.length > 25) {
                const extIndex = name.lastIndexOf('.');
                if (extIndex > 0) {
                    name = name.substring(0, 18) + '..' + name.substring(extIndex);
                } else {
                    name = name.substring(0, 20) + '..';
                }
            }

            // Get single file token count
            const fileTokens = await chatFileHandler.getFileTokenEstimate(f);

            if (isImage) {
                const objectUrl = URL.createObjectURL(f);
                contentHtml = `<img src="${objectUrl}" style="width:100%; height:100%; object-fit: cover; border-radius: 10px; opacity: 0.9;" onload="URL.revokeObjectURL(this.src)">`;
                if (fileTokens > 0) {
                    contentHtml += `<div class="media-badge">${fileTokens}</div>`;
                }
            } else {
                let iconSvg = '';
                try {
                    iconSvg = getFileIcon(f.name);
                } catch {
                    iconSvg = '📄';
                }
                contentHtml = `
                <div class="media-icon">${DOMPurify.sanitize(iconSvg)}</div>
                <div class="media-info">
                    <div class="media-name">${DOMPurify.sanitize(name)}</div>
                    ${fileTokens > 0 ? `<div class="media-tokens">${fileTokens} tokens</div>` : ''}
                </div>
            `;
            }

            card.innerHTML = `
            ${contentHtml}
            <button type="button" class="media-remove" title="Remove attachment">×</button>
        `;

            const btn = card.querySelector('.media-remove') as HTMLButtonElement;
            if (btn) {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    onRemove(idx);
                };
            }

            this._attachmentsContainer!.appendChild(card);
        });

        if (hiddenCount > 0) {
            const moreCard = document.createElement('div');
            moreCard.className = 'chat-media-card more-card';
            moreCard.innerHTML = `<span>+${hiddenCount}</span>`;
            this._attachmentsContainer.appendChild(moreCard);
        }
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
        const timeout = globalThis.setTimeout(() => {
            console.warn(`[ChatUI] Typing indicator ${id} timed out and was auto-removed`);
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
        if (indicator) indicator.remove();
    }

    public showToast(
        msg: string,
        type: 'success' | 'error' | 'warning' = 'success',
        duration = 2000,
    ): void {
        if (typeof globalThis.showToast === 'function') {
            globalThis.showToast(msg, type, duration);
        } else {
            console.debug(`[Toast] ${type}: ${msg}`);
        }
    }

    /**
     * Handles clicks on the "Copy" button in code blocks.
     */
    private async _handleCopyClick(e: MouseEvent): Promise<void> {
        const target = e.target as HTMLElement;
        const btn = target.closest('.code-copy-btn');

        if (btn) {
            e.preventDefault();
            e.stopPropagation();

            // Find the code block within the same wrapper
            const wrapper = btn.closest('.code-block-wrapper');
            const codeEl = wrapper?.querySelector('code');

            if (codeEl?.textContent) {
                const text = codeEl.textContent;
                const g = globalThis as unknown as IGlobal;

                try {
                    // Try Tauri Clipboard Plugin first, fall back to navigator.clipboard
                    // Note: Modern browsers and Tauri both support navigator.clipboard
                    if (g.__TAURI__?.core?.invoke) {
                        try {
                            await g.__TAURI__.core.invoke('plugin:clipboard|write', { text });
                        } catch {
                            await navigator.clipboard.writeText(text);
                        }
                    } else {
                        await navigator.clipboard.writeText(text);
                    }

                    // Visual feedback
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = `
                         <svg class="icon-check" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--success);">
                            <polyline points="20 6 9 17 4 12"></polyline>
                         </svg>
                         <span style="color: var(--success);">Copied!</span>
                    `;
                    setTimeout(() => {
                        btn.innerHTML = originalHtml;
                    }, 2000);
                } catch (err) {
                    console.error('[ChatUI] Copy failed:', err);
                    this.showToast('Failed to copy code', 'error');
                }
            }
        }
    }

    /**
     * Updates the token count display.
     */
    public updateTokenCount(count: number): void {
        const el = document.getElementById('chat-token-count');
        if (!el) return;

        if (count > 0) {
            el.textContent = `${count} tokens`;
            el.classList.add('visible');
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
        }
    }

    /**
     * Intercepts clicks on links to open them in the system browser.
     */
    private async _handleMessageClick(e: MouseEvent): Promise<void> {
        const target = e.target as HTMLElement;
        const link = target.closest('a');

        if (link?.href) {
            e.preventDefault();
            e.stopPropagation();

            const url = link.href;
            const g = globalThis as unknown as IGlobal;

            if (g.__TAURI__?.core?.invoke) {
                try {
                    await g.__TAURI__.core.invoke('plugin:shell|open', { path: url });
                } catch (err) {
                    console.error('[ChatUI] Failed to open link via shell:', err);
                    // Fallback to window.open (might be blocked or open in webview depending on config)
                    window.open(url, '_blank');
                }
            } else {
                // Browser fallback
                window.open(url, '_blank');
            }
        }
    }
}
