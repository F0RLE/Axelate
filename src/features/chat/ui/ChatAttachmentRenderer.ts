import DOMPurify from 'dompurify';

import type { ChatFileHandler } from '../services/ChatFileHandler';
import type { IChatAttachment } from '../types/chatTypes';
import { getFileIcon } from '../utils/chatUtils';
import type { TTranslateFunction } from '@/shared/types/global_bridge_types';

type ChatAttachmentRendererDeps = {
    fileHandler: Pick<ChatFileHandler, 'getFileTokenEstimate'>;
    isDestroyed: () => boolean;
    getRenderVersion: () => number;
    translate: TTranslateFunction;
};

export class ChatAttachmentRenderer {
    private readonly _attachmentObjectUrls = new Set<string>();

    public constructor(private readonly _deps: ChatAttachmentRendererDeps) {}

    public revokeAttachmentObjectUrls(): void {
        for (const objectUrl of this._attachmentObjectUrls) {
            URL.revokeObjectURL(objectUrl);
        }
        this._attachmentObjectUrls.clear();
    }

    public appendAttachments(bubble: HTMLElement, attachments?: IChatAttachment[]): void {
        if (attachments === undefined || attachments.length === 0) return;

        const attachContainer = document.createElement('div');
        attachContainer.className = 'chat-message-attachments';

        const maxVisible = 6;
        const visibleAttachments = attachments.slice(0, maxVisible);
        const hiddenCount = attachments.length - maxVisible;

        visibleAttachments.forEach((attachment) => {
            this.renderChatAttachment(attachContainer, attachment);
        });

        if (hiddenCount > 0) {
            const moreCard = document.createElement('div');
            moreCard.className = 'chat-media-card more-card';
            moreCard.innerHTML = `<span>+${String(hiddenCount)}</span>`;
            attachContainer.appendChild(moreCard);
        }

        bubble.appendChild(attachContainer);
    }

    public updateAttachments(
        container: HTMLElement,
        files: File[],
        onRemove: (index: number) => void,
    ): void {
        const renderVersion = this._deps.getRenderVersion();

        this.revokeAttachmentObjectUrls();
        container.innerHTML = '';
        if (!files.length) {
            container.classList.add('hidden');
            container.style.display = 'none';
            return;
        }
        container.classList.remove('hidden');
        container.style.display = '';
        container.classList.add('visible');

        const maxVisible = 6;
        const visibleFiles = files.slice(0, maxVisible);
        const hiddenCount = files.length - maxVisible;

        visibleFiles.forEach((file, index) => {
            void this.renderPendingAttachment(container, file, index, onRemove, renderVersion);
        });

        if (hiddenCount > 0) {
            const moreCard = document.createElement('div');
            moreCard.className = 'chat-media-card more-card';
            moreCard.innerHTML = `<span>+${String(hiddenCount)}</span>`;
            container.appendChild(moreCard);
        }
    }

    private renderChatAttachment(container: HTMLElement, file: IChatAttachment): void {
        const card = document.createElement('div');
        let isImage = file.type.startsWith('image/');
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

        if (!isImage && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
            isImage = true;
        }

        card.className = `chat-media-card${isImage ? ' is-image' : ' is-file'}`;
        const name = this.shortenFileName(file.name);
        const fileTokens = file.tokens ?? 0;

        if (isImage && file.data_base64.length > 0) {
            const safeBase64 = this.safeBase64Data(file.data_base64);
            if (safeBase64.length > 0) {
                const image = document.createElement('img');
                image.src = `data:${this.safeImageMime(file.type, ext)};base64,${safeBase64}`;
                image.alt = name;
                image.style.width = '100%';
                image.style.height = '100%';
                image.style.objectFit = 'cover';
                image.style.borderRadius = '10px';
                card.appendChild(image);

                if (fileTokens > 0) {
                    const badge = document.createElement('div');
                    badge.className = 'media-badge';
                    badge.textContent = String(fileTokens);
                    card.appendChild(badge);
                }
            } else {
                card.innerHTML = this.createFilePillHtml(file.name, fileTokens, name);
            }
        } else {
            card.innerHTML = this.createFilePillHtml(file.name, fileTokens, name);
        }

        container.appendChild(card);
    }

    private async renderPendingAttachment(
        container: HTMLElement,
        file: File,
        index: number,
        onRemove: (index: number) => void,
        renderVersion: number,
    ): Promise<void> {
        const card = document.createElement('div');
        const isImage = this.isImageFile(file);
        card.className = `chat-media-card${isImage ? ' is-image' : ' is-file'}`;

        const fileTokens = await this._deps.fileHandler.getFileTokenEstimate(file);
        if (this._deps.isDestroyed() || renderVersion !== this._deps.getRenderVersion()) {
            return;
        }

        const name = this.shortenFileName(file.name);
        if (isImage) {
            const objectUrl = URL.createObjectURL(file);
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
                this.releaseAttachmentObjectUrl(objectUrl);
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
            card.innerHTML = this.createFilePillHtml(file.name, fileTokens, name);
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'media-remove';
        btn.title = this._deps.translate('ui.launcher.web.remove_attachment', 'Remove attachment');
        btn.textContent = 'x';
        btn.onclick = (event) => {
            event.stopPropagation();
            onRemove(index);
        };
        card.appendChild(btn);

        container.appendChild(card);
    }

    private releaseAttachmentObjectUrl(objectUrl: string): void {
        if (!this._attachmentObjectUrls.has(objectUrl)) {
            return;
        }

        URL.revokeObjectURL(objectUrl);
        this._attachmentObjectUrls.delete(objectUrl);
    }

    private safeImageMime(type: string, ext: string): string {
        let candidate = type;
        if (candidate.length === 0) {
            candidate = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
        }
        return /^image\/(?:png|jpe?g|gif|webp|bmp|avif|svg\+xml)$/iu.test(candidate)
            ? candidate
            : 'image/png';
    }

    private safeBase64Data(data: string): string {
        const normalized = data.replaceAll(/\s+/gu, '');
        return /^[A-Za-z0-9+/]+={0,2}$/u.test(normalized) ? normalized : '';
    }

    private isImageFile(file: File): boolean {
        if (file.type.startsWith('image/')) return true;
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extension);
    }

    private shortenFileName(name: string): string {
        if (name.length <= 25) return name;
        const extIndex = name.lastIndexOf('.');
        if (extIndex > 0) {
            const ext = name.substring(extIndex);
            return `${name.substring(0, 18)}..${ext}`;
        }
        return `${name.substring(0, 20)}..`;
    }

    private createFilePillHtml(originalName: string, tokens: number, displayName: string): string {
        const iconSvg = (() => {
            try {
                return getFileIcon(originalName);
            } catch {
                return '📄';
            }
        })();

        const tokensLabel = this._deps.translate('ui.launcher.web.tokens', 'tokens');
        const safeTokensLabel = DOMPurify.sanitize(tokensLabel);
        const tokensHtml =
            tokens > 0
                ? `<div class="media-tokens">${String(tokens)} ${safeTokensLabel}</div>`
                : '';

        return `
            <div class="media-icon">${DOMPurify.sanitize(iconSvg)}</div>
            <div class="media-info">
                <div class="media-name">${DOMPurify.sanitize(displayName)}</div>
                ${tokensHtml}
            </div>
        `;
    }
}
