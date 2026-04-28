import DOMPurify from 'dompurify';
import { marked } from 'marked';

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TTranslateFunction } from '@/shared/types/global_bridge_types';

type ChatMessageRendererLogger = Pick<LoggerService, 'error' | 'debug'>;

type ChatImagePayload = {
    mime: string;
    data_base64: string;
};

type ChatMessageRendererDeps = {
    onImageLoad: () => void;
    translate: TTranslateFunction;
    tracer: ChatMessageRendererLogger;
};

export class ChatMessageRenderer {
    public constructor(private readonly _deps: ChatMessageRendererDeps) {}

    public createMessageBubble(opts: Record<string, unknown>): HTMLElement {
        const bubble = document.createElement('div');
        bubble.className = this._buildBubbleClassName(opts);
        return bubble;
    }

    public getPrimaryImage(rawImages: unknown): ChatImagePayload | null {
        if (!Array.isArray(rawImages)) return null;

        const candidate = rawImages.find(
            (item) =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as { data_base64?: unknown }).data_base64 === 'string' &&
                typeof (item as { mime?: unknown }).mime === 'string',
        ) as ChatImagePayload | undefined;

        return candidate ?? null;
    }

    public extractImageFromBubble(bubble: HTMLElement): ChatImagePayload | null {
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

    public createMessageTextNode(content: string, opts: Record<string, unknown>): HTMLElement {
        const textNode = document.createElement('div');
        textNode.className = 'markdown-body';

        const finalContent = this.resolveI18nContent(textNode, content, opts);

        try {
            const parseResult = marked.parse(finalContent);
            if (parseResult instanceof Promise) {
                void parseResult.then((rawHtml) => {
                    this._applySanitizedHtml(textNode, rawHtml);
                });
            } else {
                this._applySanitizedHtml(textNode, parseResult);
            }
        } catch (error) {
            this._deps.tracer.error('[ChatUI] Markdown render error:', error);
            textNode.textContent = finalContent;
        }

        return textNode;
    }

    public appendImages(bubble: HTMLElement, images?: ChatImagePayload[]): void {
        if (!images || images.length === 0) return;

        bubble.classList.add('chat-bubble--media');
        const insertionTarget =
            bubble.querySelector(
                '.markdown-body, .chat-generated-status, .chat-generated-caption',
            ) ?? null;

        images.forEach((img) => {
            try {
                const imageDataUrl = this._buildImageDataUrl(img);
                if (imageDataUrl === null) return;

                const wrapper = document.createElement('div');
                wrapper.className = 'chat-img-wrapper';

                const image = document.createElement('img');
                image.className = 'chat-img';
                image.src = imageDataUrl;
                image.alt = 'Generated image';
                image.width = 512;
                image.height = 512;
                image.decoding = 'async';
                image.addEventListener(
                    'load',
                    () => {
                        this._deps.onImageLoad();
                    },
                    { once: true },
                );

                wrapper.appendChild(image);
                if (insertionTarget instanceof HTMLElement) {
                    insertionTarget.before(wrapper);
                } else {
                    bubble.appendChild(wrapper);
                }
            } catch {
                /* ignore image errors */
            }
        });
    }

    private resolveI18nContent(
        element: HTMLElement,
        content: string,
        opts: Record<string, unknown>,
    ): string {
        if (typeof opts['i18nKey'] === 'string' && opts['i18nKey'] !== '') {
            const i18nKey = opts['i18nKey'];
            element.dataset['i18n'] = i18nKey;

            if (opts['i18nParams'] !== undefined) {
                element.dataset['i18nParams'] = JSON.stringify(opts['i18nParams']);
            }

            this._deps.tracer.debug('[ChatUI] i18nParams ignored by translator');
            return this._deps.translate(i18nKey, content);
        }

        if (typeof opts['i18nPrefixKey'] === 'string' && opts['i18nPrefixKey']) {
            const prefixKey = opts['i18nPrefixKey'];
            element.dataset['i18nPrefix'] = prefixKey;

            const prefix = this._deps.translate(prefixKey, 'Error: ');
            return prefix + content;
        }

        return content;
    }

    private _applySanitizedHtml(element: HTMLElement, html: string): void {
        element.innerHTML = DOMPurify.sanitize(html);
    }

    private _buildBubbleClassName(opts: Record<string, unknown>): string {
        const hasImages = Array.isArray(opts['images']) && (opts['images'] as unknown[]).length > 0;
        const mediaFirst = opts['mediaFirst'] === true || hasImages;

        return [
            'chat-bubble',
            opts['error'] === true ? 'chat-error' : '',
            opts['thought'] === true ? 'chat-thought' : '',
            mediaFirst ? 'chat-bubble--media' : '',
        ]
            .filter((className) => className !== '')
            .join(' ');
    }

    private _buildImageDataUrl(image: ChatImagePayload): string | null {
        const mime = image.mime || 'image/png';
        const base64 = image.data_base64 || '';
        if (base64 === '') {
            return null;
        }

        return `data:${mime};base64,${base64}`;
    }
}
