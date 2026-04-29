import DOMPurify from 'dompurify';
import { invoke } from '@tauri-apps/api/core';

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TTranslateFunction } from '@/shared/types/global_bridge_types';

type ChatImageLogger = Pick<LoggerService, 'error'>;

type SavedChatImage = {
    filePath: string;
    folderPath: string;
};

type ChatImagePayload = {
    mime: string;
    data_base64: string;
};

type ChatImageControllerDeps = {
    isDestroyed: () => boolean;
    setManagedTimeout: (callback: () => void, delayMs: number) => void;
    extractErrorMessage: (error: unknown) => string;
    showToast: (
        message: string,
        type?: 'success' | 'error' | 'warning' | 'info',
        duration?: number,
    ) => void;
    translate: TTranslateFunction;
    tracer: ChatImageLogger;
};

export class ChatImageController {
    private static readonly _imageResetDelayMs = 250;
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

    private readonly _boundImageViewerKeydown: (event: KeyboardEvent) => void;
    private _imageViewerOverlay: HTMLElement | null = null;
    private _imageViewerImage: HTMLImageElement | null = null;
    private _imageViewerPrevButton: HTMLButtonElement | null = null;
    private _imageViewerNextButton: HTMLButtonElement | null = null;
    private _imageViewerCounter: HTMLElement | null = null;
    private _imageViewerSources: string[] = [];
    private _imageViewerIndex = 0;

    public constructor(private readonly _deps: ChatImageControllerDeps) {
        this._boundImageViewerKeydown = (event: KeyboardEvent) => {
            if (event.ctrlKey && ['+', '-', '=', '0'].includes(event.key)) {
                return;
            }
            if (event.key === 'Escape') {
                this.closeImageViewer();
                return;
            }
            if (event.key === 'ArrowLeft') {
                this._showAdjacentImage(-1);
                return;
            }
            if (event.key === 'ArrowRight') {
                this._showAdjacentImage(1);
            }
        };
    }

    public destroy(): void {
        this.closeImageViewer();
        this._imageViewerOverlay?.remove();
        this._imageViewerOverlay = null;
        this._imageViewerImage = null;
        this._imageViewerPrevButton = null;
        this._imageViewerNextButton = null;
        this._imageViewerCounter = null;
        this._imageViewerSources = [];
        this._imageViewerIndex = 0;
    }

    public handleImageClick(event: MouseEvent): boolean {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;

        let image = target.closest('.chat-img, .chat-generated-image, .chat-attachment-img');
        if (!(image instanceof HTMLImageElement)) {
            image =
                target
                    .closest('.chat-media-card.is-image')
                    ?.querySelector('img.chat-attachment-img') ?? null;
        }
        if (!(image instanceof HTMLImageElement)) return false;

        const currentSrc = image.currentSrc.trim();
        const attributeSrc = image.getAttribute('src');
        const fallbackSrc = image.src.trim();
        const src =
            currentSrc.length > 0
                ? image.currentSrc
                : attributeSrc !== null && attributeSrc.trim().length > 0
                  ? attributeSrc
                  : fallbackSrc;
        if (src.trim().length === 0) return false;

        event.preventDefault();
        event.stopPropagation();
        this.openImageViewer(src);
        return true;
    }

    public ensureImageActionButtons(actionBar: HTMLElement, image: ChatImagePayload): void {
        if (actionBar.querySelector('.chat-save-image-btn, .chat-open-image-folder-btn')) return;
        actionBar.querySelector('.chat-copy-own-btn')?.remove();

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'chat-save-image-btn';
        this._syncImageActionLabel(saveBtn, 'ui.chat.save_image', 'Save Image');
        saveBtn.innerHTML = ChatImageController._downloadIcon;
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

        actionBar.appendChild(saveBtn);
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
                saveBtn.innerHTML = ChatImageController._checkIcon;
                this._promoteSaveButtonToFolder(
                    saveBtn,
                    savedImage.filePath,
                    savedImage.folderPath,
                );
            }
        } catch (error) {
            this._deps.tracer.error('[ChatUI] Save image failed', error);
            this._deps.showToast(
                this._deps.translate('ui.chat.image_save_failed', 'Failed to save image'),
                'error',
            );
        }
    }

    private _resolveImageViewerHost(): HTMLElement {
        return (
            document.getElementById('page-chat') ??
            document.getElementById('main-area') ??
            document.body
        );
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
            <button type="button" class="chat-image-viewer-close window-control-btn close-btn">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M5 4h2v2H5zm12 0h2v2h-2zM7 6h2v2H7zm8 0h2v2h-2zM9 8h2v2H9zm4 0h2v2h-2zM11 10h2v4h-2zM9 14h2v2H9zm4 0h2v2h-2zM7 16h2v2H7zm8 0h2v2h-2zM5 18h2v2H5zm12 0h2v2h-2z"></path>
                </svg>
            </button>
            <button type="button" class="chat-image-viewer-nav chat-image-viewer-prev">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                    <path d="M14 5h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2H8zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z"></path>
                </svg>
            </button>
            <div class="chat-image-viewer-stage">
                <img class="chat-image-viewer-img">
            </div>
            <button type="button" class="chat-image-viewer-nav chat-image-viewer-next">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                    <path d="M8 5h2v2H8zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2H8z"></path>
                </svg>
            </button>
            <div class="chat-image-viewer-counter"></div>
        `);
        const closeButton = overlay.querySelector<HTMLButtonElement>('.chat-image-viewer-close');
        const label = this._deps.translate('ui.chat.close_image_preview', 'Close image preview');
        closeButton?.setAttribute('aria-label', label);
        closeButton?.setAttribute('title', label);

        const prevButton = overlay.querySelector<HTMLButtonElement>('.chat-image-viewer-prev');
        const nextButton = overlay.querySelector<HTMLButtonElement>('.chat-image-viewer-next');
        prevButton?.setAttribute(
            'aria-label',
            this._deps.translate('ui.chat.previous_image', 'Previous image'),
        );
        nextButton?.setAttribute(
            'aria-label',
            this._deps.translate('ui.chat.next_image', 'Next image'),
        );

        overlay.addEventListener('click', (event) => {
            const eventTarget = event.target;
            if (!(eventTarget instanceof HTMLElement)) return;
            if (
                eventTarget === overlay ||
                eventTarget.closest('.chat-image-viewer-stage') instanceof HTMLElement ||
                eventTarget.closest('.chat-image-viewer-close') instanceof HTMLElement
            ) {
                this.closeImageViewer();
            }
        });

        prevButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._showAdjacentImage(-1);
        });
        nextButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._showAdjacentImage(1);
        });

        this._resolveImageViewerHost().appendChild(overlay);
        this._imageViewerOverlay = overlay;
        this._imageViewerImage = overlay.querySelector('.chat-image-viewer-img');
        this._imageViewerPrevButton = prevButton;
        this._imageViewerNextButton = nextButton;
        this._imageViewerCounter = overlay.querySelector('.chat-image-viewer-counter');
        this._imageViewerImage?.setAttribute(
            'alt',
            this._deps.translate('ui.chat.image_preview', 'Image preview'),
        );
        this._imageViewerImage?.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }

    private openImageViewer(src: string): void {
        if (src.trim().length === 0) return;

        this._ensureImageViewer();
        if (
            !(this._imageViewerOverlay instanceof HTMLElement) ||
            !(this._imageViewerImage instanceof HTMLImageElement)
        ) {
            return;
        }

        this._imageViewerSources = this._collectImageViewerSources();
        const sourceIndex = this._imageViewerSources.indexOf(src);
        if (sourceIndex === -1) {
            this._imageViewerSources = [src];
            this._imageViewerIndex = 0;
        } else {
            this._imageViewerIndex = sourceIndex;
        }

        this._setImageViewerSource(src, 0);
        this._imageViewerOverlay.classList.remove('hidden');
        document.body.classList.add('chat-image-viewer-open');
        document.addEventListener('keydown', this._boundImageViewerKeydown);
    }

    private closeImageViewer(): void {
        if (!(this._imageViewerOverlay instanceof HTMLElement)) return;

        this._imageViewerOverlay.classList.add('hidden');
        this._imageViewerImage?.removeAttribute('src');
        document.body.classList.remove('chat-image-viewer-open');
        document.removeEventListener('keydown', this._boundImageViewerKeydown);
    }

    private _collectImageViewerSources(): string[] {
        const sources: string[] = [];
        const seen = new Set<string>();
        document
            .querySelectorAll<HTMLImageElement>(
                '#chat-messages img.chat-img, #chat-messages img.chat-generated-image, #chat-messages img.chat-attachment-img, #chat-attachments img.chat-attachment-img',
            )
            .forEach((image) => {
                const src = this._resolveImageSource(image);
                if (src === null || seen.has(src)) return;
                seen.add(src);
                sources.push(src);
            });
        return sources;
    }

    private _resolveImageSource(image: HTMLImageElement): string | null {
        const currentSrc = image.currentSrc.trim();
        const attributeSrc = image.getAttribute('src');
        const fallbackSrc = image.src.trim();
        const src =
            currentSrc.length > 0
                ? image.currentSrc
                : attributeSrc !== null && attributeSrc.trim().length > 0
                  ? attributeSrc
                  : fallbackSrc;
        return src.trim().length > 0 ? src : null;
    }

    private _showAdjacentImage(direction: -1 | 1): void {
        if (this._imageViewerSources.length <= 1) return;
        const nextIndex =
            (this._imageViewerIndex + direction + this._imageViewerSources.length) %
            this._imageViewerSources.length;
        this._imageViewerIndex = nextIndex;
        this._setImageViewerSource(this._imageViewerSources[nextIndex] ?? '', direction);
    }

    private _setImageViewerSource(src: string, direction: -1 | 0 | 1): void {
        if (!(this._imageViewerImage instanceof HTMLImageElement)) return;
        if (src.trim().length === 0) return;

        this._imageViewerImage.classList.remove(
            'is-entering-forward',
            'is-entering-backward',
            'is-opening',
        );
        this._imageViewerImage.src = src;
        const animationClass =
            direction > 0
                ? 'is-entering-forward'
                : direction < 0
                  ? 'is-entering-backward'
                  : 'is-opening';
        requestAnimationFrame(() => {
            this._imageViewerImage?.classList.add(animationClass);
        });
        this._syncImageViewerNavigation();
    }

    private _syncImageViewerNavigation(): void {
        const hasMany = this._imageViewerSources.length > 1;
        this._imageViewerPrevButton?.classList.toggle('hidden', !hasMany);
        this._imageViewerNextButton?.classList.toggle('hidden', !hasMany);
        if (this._imageViewerCounter instanceof HTMLElement) {
            this._imageViewerCounter.classList.toggle('hidden', !hasMany);
            this._imageViewerCounter.textContent = hasMany
                ? `${this._imageViewerIndex + 1} / ${this._imageViewerSources.length}`
                : '';
        }
    }

    private _promoteSaveButtonToFolder(
        saveBtn: HTMLButtonElement,
        filePath: string,
        folderPath: string,
    ): void {
        this._deps.setManagedTimeout(() => {
            if (this._deps.isDestroyed() || !document.body.contains(saveBtn)) {
                return;
            }
            saveBtn.disabled = false;
            saveBtn.classList.remove('chat-save-image-btn', 'is-saved');
            saveBtn.classList.add('chat-open-image-folder-btn');
            saveBtn.dataset['filePath'] = filePath;
            saveBtn.dataset['folderPath'] = folderPath;
            this._syncImageActionLabel(saveBtn, 'ui.chat.open_image_folder', 'Open image folder');
            saveBtn.innerHTML = ChatImageController._folderIcon;
        }, ChatImageController._imageResetDelayMs);
    }

    private _restoreFolderButtonToSave(saveBtn: HTMLButtonElement): void {
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
        this._syncImageActionLabel(saveBtn, 'ui.chat.save_image', 'Save Image');
        saveBtn.innerHTML = ChatImageController._downloadIcon;
    }

    private _setFolderButtonState(
        saveBtn: HTMLButtonElement,
        filePath: string,
        folderPath: string,
    ): void {
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
        this._syncImageActionLabel(saveBtn, 'ui.chat.open_image_folder', 'Open image folder');
        saveBtn.innerHTML = ChatImageController._folderIcon;
    }

    private _syncImageActionLabel(saveBtn: HTMLButtonElement, key: string, fallback: string): void {
        const label = this._deps.translate(key, fallback);
        saveBtn.title = label;
        saveBtn.dataset['tooltip'] = label;
        saveBtn.setAttribute('aria-label', label);
    }

    private _animateFolderButtonReset(saveBtn: HTMLButtonElement): void {
        if (!saveBtn.classList.contains('chat-open-image-folder-btn')) return;
        if (saveBtn.classList.contains('is-resetting')) return;

        saveBtn.disabled = true;
        saveBtn.classList.add('is-resetting', 'is-trash-state');
        saveBtn.innerHTML = ChatImageController._trashIcon;
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
            globalThis.setTimeout(resolve, ChatImageController._imageResetDelayMs);
        });
        const deleteRequest = invoke('delete_chat_image', { filePath });

        try {
            await Promise.all([deleteRequest, animationDelay]);
            this._restoreFolderButtonToSave(saveBtn);
        } catch (error) {
            this._deps.tracer.error('[ChatUI] Delete saved image failed', error);
            await animationDelay;
            this._setFolderButtonState(saveBtn, filePath, folderPath);
            this._deps.showToast(
                this._deps.translate('ui.chat.image_delete_failed', 'Failed to delete image'),
                'error',
            );
        }
    }

    private async _openImageLocation(
        saveBtn: HTMLButtonElement,
        filePath: string,
        folderPath: string,
    ): Promise<void> {
        const handleMissing = async (): Promise<void> => {
            this._restoreFolderButtonToSave(saveBtn);
            try {
                await invoke('open_chat_image_location', { filePath: folderPath, folderPath });
            } catch {
                /* ignore fallback folder-open errors */
            }
            this._deps.showToast(
                this._deps.translate(
                    'ui.chat.image_missing_resave',
                    'Image was removed, save it again',
                ),
                'warning',
            );
        };

        try {
            await invoke('open_chat_image_location', { filePath, folderPath });
        } catch (error) {
            const message = this._deps.extractErrorMessage(error);
            const normalized = message.toLowerCase();
            const isMissing =
                normalized.includes('does not exist') ||
                normalized.includes('not found') ||
                normalized.includes('saved image does not exist') ||
                normalized.includes('not_found');
            if (isMissing) {
                await handleMissing();
                return;
            }

            this._deps.tracer.error('[ChatUI] Open image location failed', error);
            this._deps.showToast(
                this._deps.translate(
                    'ui.chat.image_open_folder_failed',
                    'Failed to open image folder',
                ),
                'error',
            );
        }
    }
}
