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

    public constructor(private readonly _deps: ChatImageControllerDeps) {
        this._boundImageViewerKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                this.closeImageViewer();
            }
        };
    }

    public destroy(): void {
        document.removeEventListener('keydown', this._boundImageViewerKeydown);
        document.body.classList.remove('chat-image-viewer-open');
        this._imageViewerOverlay?.remove();
        this._imageViewerOverlay = null;
        this._imageViewerImage = null;
    }

    public handleImageClick(event: MouseEvent): boolean {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;

        const image = target.closest('.chat-img');
        if (!(image instanceof HTMLImageElement)) return false;

        event.preventDefault();
        event.stopPropagation();
        this.openImageViewer(image.currentSrc || image.src);
        return true;
    }

    public ensureImageActionButtons(actionBar: HTMLElement, image: ChatImagePayload): void {
        if (actionBar.querySelector('.chat-save-image-btn, .chat-open-image-folder-btn')) return;
        actionBar.querySelector('.chat-copy-own-btn')?.remove();

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'chat-save-image-btn';
        saveBtn.title = this._deps.translate('ui.chat.save_image', 'Save Image');
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
        saveBtn.dataset['imageBase64'] = image.data_base64;
        saveBtn.dataset['imageMime'] = image.mime;

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
            <button type="button" class="chat-image-viewer-close window-control-btn close-btn" aria-label="Close image preview">
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
                this.closeImageViewer();
            }
        });

        this._resolveImageViewerHost().appendChild(overlay);
        this._imageViewerOverlay = overlay;
        this._imageViewerImage = overlay.querySelector('.chat-image-viewer-img');
    }

    private openImageViewer(src: string): void {
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

    private closeImageViewer(): void {
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
        this._deps.setManagedTimeout(() => {
            if (this._deps.isDestroyed() || !document.body.contains(saveBtn)) {
                return;
            }
            saveBtn.disabled = false;
            saveBtn.classList.remove('chat-save-image-btn', 'is-saved');
            saveBtn.classList.add('chat-open-image-folder-btn');
            saveBtn.dataset['filePath'] = filePath;
            saveBtn.dataset['folderPath'] = folderPath;
            saveBtn.title = this._deps.translate('ui.chat.open_image_folder', 'Open image folder');
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
        saveBtn.title = this._deps.translate('ui.chat.save_image', 'Save Image');
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
        saveBtn.title = this._deps.translate('ui.chat.open_image_folder', 'Open image folder');
        saveBtn.innerHTML = ChatImageController._folderIcon;
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
