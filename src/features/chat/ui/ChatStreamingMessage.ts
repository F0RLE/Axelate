import DOMPurify from 'dompurify';
import { marked } from 'marked';

import type { IChatAttachment, IChatRole } from '../types/chatTypes';
import { safeExtractText } from './ChatContentFormatter';

type ChatImagePayload = {
    mime: string;
    data_base64: string;
};

type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

export type StreamingMessageHandle = {
    textNode: HTMLElement;
    setStatus: (text: string) => void;
    update: (chunk: unknown) => void;
    replace: (text: string) => void;
    cancel: () => void;
    discard: () => void;
    finalize: (fullContent: unknown, finalOpts?: Record<string, unknown>) => void;
};

type CreateChatStreamingMessageDeps = {
    role: IChatRole;
    opts?: Record<string, unknown>;
    isDestroyed: () => boolean;
    translate: ChatTranslate;
    scrollToBottom: (sticky?: boolean) => void;
    appendRow: (row: HTMLElement) => void;
    createMessageBubble: (opts: Record<string, unknown>) => HTMLElement;
    appendMessageActions: (
        content: string,
        role: 'user' | 'assistant',
        image: ChatImagePayload | null,
    ) => { actionBar: HTMLElement; copyBtn: HTMLElement; editBtn: HTMLElement | null } | null;
    appendAttachments: (bubble: HTMLElement, attachments?: IChatAttachment[]) => void;
    appendImages: (bubble: HTMLElement, images?: ChatImagePayload[]) => void;
    getPrimaryImage: (rawImages: unknown) => ChatImagePayload | null;
    ensureImageActionButtons: (actionBar: HTMLElement, image: ChatImagePayload) => void;
    scheduleBubbleImageActions: (bubble: HTMLElement, actionBar: HTMLElement) => void;
};

export function createChatStreamingMessage(
    deps: CreateChatStreamingMessageDeps,
): StreamingMessageHandle {
    const row = document.createElement('div');
    row.className = `chat-row ${deps.role === 'user' ? 'user' : 'bot'}`;

    const bubble = deps.createMessageBubble(deps.opts ?? {});
    const actions = deps.appendMessageActions('', deps.role, null);
    const copyBtn = actions?.copyBtn ?? null;

    const textNode = document.createElement('div');
    textNode.className = 'markdown-body';

    const statusNode = document.createElement('div');
    statusNode.className = 'chat-streaming-state';

    const statusText = document.createElement('span');
    statusText.className = 'chat-streaming-state-text';

    statusNode.appendChild(statusText);
    bubble.appendChild(textNode);

    row.appendChild(bubble);
    deps.appendRow(row);
    deps.scrollToBottom();

    let accumulatedText = '';
    let lastRenderTime = Date.now();
    let renderVersion = 0;
    let isDiscarded = false;
    let renderFrame: number | null = null;
    let renderTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let pendingScrollToBottom = false;

    const setStatus = (text: string): void => {
        const trimmed = text.trim();
        if (trimmed === '' || isDiscarded) {
            statusNode.remove();
            return;
        }

        statusText.textContent = trimmed;
        if (!bubble.contains(statusNode)) {
            bubble.insertBefore(statusNode, textNode);
        }
    };

    const hideStatus = (): void => {
        statusNode.remove();
    };

    const isStreamingTargetLive = (version: number): boolean =>
        !deps.isDestroyed() &&
        !isDiscarded &&
        version === renderVersion &&
        row.isConnected &&
        textNode.isConnected;

    const renderMarkdown = (sourceText: string, version: number, scrollToBottom = false): void => {
        try {
            const parseResult = marked.parse(sourceText);
            if (parseResult instanceof Promise) {
                void parseResult
                    .then((rawHtml) => {
                        if (!isStreamingTargetLive(version)) return;
                        textNode.innerHTML = DOMPurify.sanitize(rawHtml);
                        if (scrollToBottom) deps.scrollToBottom();
                    })
                    .catch(() => {
                        if (!isStreamingTargetLive(version)) return;
                        textNode.textContent = sourceText;
                        if (scrollToBottom) deps.scrollToBottom();
                    });
                return;
            }

            if (!isStreamingTargetLive(version)) return;
            textNode.innerHTML = DOMPurify.sanitize(parseResult);
            if (scrollToBottom) deps.scrollToBottom();
        } catch {
            if (!isStreamingTargetLive(version)) return;
            textNode.textContent = sourceText;
            if (scrollToBottom) deps.scrollToBottom();
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
                if (scrollToBottom) deps.scrollToBottom();
            } else {
                renderMarkdown(accumulatedText, version, scrollToBottom);
            }
        } catch {
            if (!isStreamingTargetLive(version)) return;
            textNode.textContent = accumulatedText;
            if (scrollToBottom) deps.scrollToBottom();
        }

        lastRenderTime = Date.now();
    };

    const scheduleRender = (immediate = false, scrollToBottom = false): void => {
        pendingScrollToBottom ||= scrollToBottom;

        if (renderFrame !== null) {
            if (!immediate) return;
            globalThis.cancelAnimationFrame(renderFrame);
            renderFrame = null;
        }

        const runRender = () => {
            renderFrame = null;
            const shouldScroll = pendingScrollToBottom;
            pendingScrollToBottom = false;
            flushRender(shouldScroll);
        };

        if (immediate) {
            runRender();
            return;
        }

        if (renderTimeout !== null) {
            return;
        }

        const renderOnFrame = () => {
            const elapsed = Date.now() - lastRenderTime;
            if (elapsed >= 100) {
                runRender();
                return;
            }

            renderFrame = globalThis.requestAnimationFrame(renderOnFrame);
        };

        renderTimeout = globalThis.setTimeout(() => {
            renderTimeout = null;
            renderFrame = globalThis.requestAnimationFrame(renderOnFrame);
        }, 0);
    };

    const cancelScheduledRender = (): void => {
        if (renderFrame !== null) {
            globalThis.cancelAnimationFrame(renderFrame);
            renderFrame = null;
        }
        if (renderTimeout !== null) {
            globalThis.clearTimeout(renderTimeout);
            renderTimeout = null;
        }
    };

    return {
        textNode,
        setStatus,
        update: (chunk: unknown) => {
            const safeChunk = safeExtractText(chunk, deps.translate);
            if (safeChunk !== '') {
                hideStatus();
            }
            accumulatedText += safeChunk;
            textNode.textContent = accumulatedText;
            deps.scrollToBottom(true);
            if (copyBtn instanceof HTMLElement) {
                copyBtn.dataset['copyText'] = accumulatedText;
            }
        },
        replace: (text: string) => {
            accumulatedText = text;
            if (text.trim() !== '') {
                hideStatus();
            }
            if (copyBtn instanceof HTMLElement) {
                copyBtn.dataset['copyText'] = accumulatedText;
            }
            scheduleRender(false, true);
        },
        cancel: () => {
            renderVersion += 1;
            cancelScheduledRender();

            if (accumulatedText.trim() === '') {
                isDiscarded = true;
                row.remove();
                return;
            }

            hideStatus();
            scheduleRender(true, true);
            if (actions !== null && !bubble.contains(actions.actionBar)) {
                bubble.appendChild(actions.actionBar);
            }
            deps.scrollToBottom();
        },
        discard: () => {
            isDiscarded = true;
            renderVersion += 1;
            cancelScheduledRender();
            row.remove();
        },
        finalize: (fullContent: unknown, finalOpts: Record<string, unknown> = {}) => {
            const safeFullContent = safeExtractText(fullContent, deps.translate);
            if (safeFullContent.trim() === '') {
                isDiscarded = true;
                renderVersion += 1;
                cancelScheduledRender();
                row.remove();
                return;
            }

            accumulatedText = safeFullContent;
            hideStatus();
            textNode.textContent = safeFullContent;
            if (copyBtn instanceof HTMLElement) {
                copyBtn.dataset['copyText'] = safeFullContent;
            }
            scheduleRender(false, true);

            if (finalOpts['attachments'] !== undefined) {
                deps.appendAttachments(bubble, finalOpts['attachments'] as IChatAttachment[]);
            }
            if (finalOpts['images'] !== undefined) {
                deps.appendImages(bubble, finalOpts['images'] as ChatImagePayload[]);
                const primaryImage = deps.getPrimaryImage(finalOpts['images']);
                if (primaryImage !== null && actions !== null) {
                    deps.ensureImageActionButtons(actions.actionBar, primaryImage);
                }
            }

            if (actions !== null && !bubble.contains(actions.actionBar)) {
                bubble.appendChild(actions.actionBar);
            }
            if (actions !== null && deps.role === 'assistant') {
                deps.scheduleBubbleImageActions(bubble, actions.actionBar);
            }
            deps.scrollToBottom(true);
        },
    };
}
