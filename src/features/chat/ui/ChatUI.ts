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
import type { TGlobalWin } from '@/shared/types/global_bridge_types';
import DOMPurify from 'dompurify';
import { logger } from '@/infrastructure/logging/LoggerService';

export class ChatUI {
    private readonly _messagesContainer: HTMLElement | null;
    private readonly _chatContainer: HTMLElement | null;
    private readonly _attachmentsContainer: HTMLElement | null;
    private readonly _chatInput: HTMLTextAreaElement | null;
    private readonly _clearBtn: HTMLElement | null;
    private readonly _attachBtn: HTMLElement | null;
    private readonly _voiceBtn: HTMLElement | null;
    private readonly _sendBtn: HTMLElement | null;
    private readonly _tokenCount: HTMLElement | null;
    private readonly _typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

    constructor() {
        this._messagesContainer = document.getElementById('chat-messages');
        this._chatContainer = document.getElementById('chat-container');
        this._attachmentsContainer = document.getElementById('chat-attachments');
        this._chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        this._clearBtn = document.getElementById('clear-chat-btn');
        this._attachBtn = document.getElementById('chat-attach-btn');
        this._voiceBtn = document.getElementById('chat-voice-btn');
        this._sendBtn = document.getElementById('chat-send-btn');
        this._tokenCount = document.getElementById('chat-token-count');

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
                     <button class="code-copy-btn" title="${(globalThis as TGlobalWin).t('ui.launcher.web.copy_code', 'Copy code')}">
                        <!-- Simple Copy Icon -->
                        <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>${(globalThis as TGlobalWin).t('ui.launcher.web.copy', 'Copy')}</span>
                     </button>
                 </div>
                 <pre><code class="language-${language}">${escaped === true ? text : text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
             </div>
             `;
        };

        marked.use({ renderer });

        // Bind event listeners
        if (this._messagesContainer) {
            this._messagesContainer.addEventListener('click', (e) => {
                void this._handleMessageClick(e as MouseEvent);
            });
            this._messagesContainer.addEventListener('click', (e) => {
                void this._handleCopyClick(e as MouseEvent);
            });
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
        const win = globalThis as TGlobalWin;
        if (win.__TAURI_INTERNALS__ !== undefined) {
            await listen<{ code: string; wait_seconds: number }>('ai:status:retry', (e) => {
                const { code, wait_seconds } = e.payload;
                if (code === 'GEMINI_QUOTA_RETRY') {
                    // Show toast or update UI
                    const g = globalThis as TGlobalWin;
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
            });
        }
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
        row.className = `chat-row ${role === 'user' ? 'user' : 'bot'}`;

        const bubble = this._createMessageBubble(opts);
        const textNode = this._createMessageTextNode(content, opts);
        bubble.appendChild(textNode);

        this._appendAttachments(bubble, opts['attachments'] as IChatAttachment[]);
        this._appendImages(bubble, opts['images'] as { mime: string; data_base64: string }[]);
        this._appendMeta(bubble, opts['tokens'] as number | undefined);

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
        update: (chunk: string) => void;
        finalize: (fullContent: string, finalOpts?: Record<string, unknown>) => void;
    } {
        this._prepareContainer();

        const row = document.createElement('div');
        row.className = `chat-row ${role === 'user' ? 'user' : 'bot'}`;

        const bubble = this._createMessageBubble(opts);
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
                            const rawHtml = marked.parse(accumulatedText);
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
                    const finalHtml = marked.parse(fullContent);
                    textNode.innerHTML = DOMPurify.sanitize(finalHtml);
                } catch {
                    textNode.textContent = fullContent;
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
        bubble.className = `chat-bubble${opts['error'] === true ? ' chat-error' : ''}`;
        return bubble;
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
            const rawHtml = marked.parse(finalContent);
            textNode.innerHTML = DOMPurify.sanitize(rawHtml);
        } catch (e) {
            logger.error('[ChatUI] Markdown render error:', e);
            textNode.textContent = finalContent;
        }

        return textNode;
    }

    private _resolveI18nContent(
        el: HTMLElement,
        content: string,
        opts: Record<string, unknown>,
    ): string {
        const g = globalThis as TGlobalWin;

        // Handle i18nKey
        if (typeof opts['i18nKey'] === 'string' && opts['i18nKey'] !== '') {
            const i18nKey = opts['i18nKey'];
            el.dataset['i18n'] = i18nKey;

            if (opts['i18nParams'] !== undefined) {
                el.dataset['i18nParams'] = JSON.stringify(opts['i18nParams']);
            }

            // Note: tParams would be used here if translator supported interpolation
            logger.debug('[ChatUI] i18nParams ignored by translator');

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
            const t = (globalThis as TGlobalWin).t;
            const fallback = tokens === 1 ? 'token' : 'tokens';
            const tokensWord = t('ui.launcher.web.tokens', fallback);
            tokenSpan.textContent = `${String(tokens)} ${tokensWord}`;
            meta.appendChild(tokenSpan);
        }

        bubble.appendChild(meta);
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

        let contentHtml = '';
        if (isImage) {
            const objectUrl = URL.createObjectURL(f);
            contentHtml = `<img src="${objectUrl}" style="width:100%; height:100%; object-fit: cover; border-radius: 10px; opacity: 0.9;" alt="${DOMPurify.sanitize(name)}" onload="URL.revokeObjectURL(this.src)">`;
            if (fileTokens > 0) {
                contentHtml += `<div class="media-badge">${String(fileTokens)}</div>`;
            }
        } else {
            contentHtml = this._createFilePillHtml(f.name, fileTokens, name);
        }

        card.innerHTML = `
            ${contentHtml}
            <button type="button" class="media-remove" title="${(globalThis as TGlobalWin).t('ui.launcher.web.remove_attachment', 'Remove attachment')}">×</button>
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
        let iconSvg = '';
        try {
            iconSvg = getFileIcon(originalName);
        } catch {
            iconSvg = '📄';
        }

        const t = (globalThis as TGlobalWin).t;
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
            logger.warn(`[ChatUI] Typing indicator ${id} timed out and was auto-removed`);
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
        const win = globalThis as TGlobalWin;
        if (typeof win.showToast === 'function') {
            win.showToast(msg, type, duration);
        } else {
            logger.debug(`[Toast] ${type}: ${msg}`);
        }
    }

    /**
     * Handles clicks on the "Copy" button in code blocks.
     */
    private async _handleCopyClick(e: MouseEvent): Promise<void> {
        const target = e.target as HTMLElement;
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
            logger.error('[ChatUI] Copy failed:', err);
            this._showCopyResult(btn as HTMLElement, false);
        }
    }

    private async _copyToClipboard(text: string): Promise<void> {
        const win = globalThis as TGlobalWin;
        const isTauri = win.__TAURI_INTERNALS__ !== undefined;
        if (isTauri) {
            try {
                await invoke('plugin:clipboard|write', { text });
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
                (globalThis as TGlobalWin).t('ui.launcher.web.copy_failed', 'Failed to copy code'),
                'error',
            );
            return;
        }

        const originalHtml = btn.innerHTML;
        const t = (globalThis as TGlobalWin).t;
        const label = t('ui.launcher.web.copied', 'Copied!');

        btn.innerHTML = DOMPurify.sanitize(`
            <svg class="icon-check" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--success);">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span style="color: var(--success);">${label}</span>
        `);

        setTimeout(() => {
            btn.innerHTML = originalHtml;
        }, 2000);
    }

    /**
     * Updates the token count display.
     */
    public updateTokenCount(count: number): void {
        const el = document.getElementById('chat-token-count');
        if (el === null) return;

        if (count > 0) {
            el.textContent = `${String(count)} ${(globalThis as TGlobalWin).t('ui.launcher.web.tokens', 'tokens')}`;
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
            const win = globalThis as TGlobalWin;
            const isTauri = win.__TAURI_INTERNALS__ !== undefined;
            if (isTauri) {
                try {
                    await invoke('plugin:shell|open', { path: url });
                } catch (err) {
                    logger.error('[ChatUI] Failed to open link via shell:', err);
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
        const win = globalThis as TGlobalWin;
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

        // 3. Token count (if visible)
        if (this._tokenCount?.classList.contains('visible') === true) {
            const count = Number.parseInt(this._tokenCount.textContent || '0', 10);
            if (!Number.isNaN(count)) {
                this.updateTokenCount(count);
            }
        }
    }
}
