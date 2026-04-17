import DOMPurify from 'dompurify';
import { invoke } from '@tauri-apps/api/core';

import type { ChatImageController } from './ChatImageController';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { tracer } from '@/infrastructure/logging/LoggerService';

type ChatImagePayload = {
    mime: string;
    data_base64: string;
};

type ChatMessageInteractionControllerDeps = {
    imageController: ChatImageController;
    isDestroyed: () => boolean;
    setManagedTimeout: (callback: () => void, delayMs: number) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'warning', duration?: number) => void;
    getEditMessageHandler: () => ((text: string) => void | Promise<void>) | null;
    setLastEditableUserActionBar: (actionBar: HTMLElement) => void;
};

export class ChatMessageInteractionController {
    public constructor(private readonly _deps: ChatMessageInteractionControllerDeps) {}

    public appendMessageActions(
        content: string,
        role: 'user' | 'assistant',
        image: ChatImagePayload | null,
    ): { actionBar: HTMLElement; copyBtn: HTMLElement; editBtn: HTMLElement | null } {
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
            this._deps.setLastEditableUserActionBar(actionBar);
        }

        if (hasImageActions) {
            this._deps.imageController.ensureImageActionButtons(actionBar, image);
        }

        return { actionBar, copyBtn, editBtn };
    }

    public async handleCopyClick(event: MouseEvent): Promise<void> {
        const target = event.target as HTMLElement;
        const editBtn = target.closest('.chat-edit-own-btn');
        if (editBtn instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();

            const text = editBtn.dataset['editText'] ?? '';
            const handler = this._deps.getEditMessageHandler();
            if (text !== '' && handler !== null) {
                await handler(text);
            }
            return;
        }

        const ownBtn = target.closest('.chat-copy-own-btn');
        if (ownBtn instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();

            const text = ownBtn.dataset['copyText'] ?? '';
            if (text === '') return;

            try {
                await this._copyToClipboard(text);
                this._showCopyResult(ownBtn, true);
            } catch (error) {
                tracer.error('[ChatUI] Message copy failed:', error);
                this._showCopyResult(ownBtn, false);
            }
            return;
        }

        const btn = target.closest('.code-copy-btn');
        if (btn === null) return;

        event.preventDefault();
        event.stopPropagation();

        const wrapper = btn.closest('.code-block-wrapper');
        const codeEl = wrapper?.querySelector('code');
        const text = codeEl?.textContent ?? '';
        if (text === '') return;

        try {
            await this._copyToClipboard(text);
            this._showCopyResult(btn as HTMLElement, true);
        } catch (error) {
            tracer.error('[ChatUI] Copy failed:', error);
            this._showCopyResult(btn as HTMLElement, false);
        }
    }

    public refreshTranslations(t: (key: string, fallback?: string) => string): void {
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
    }

    private async _copyToClipboard(text: string): Promise<void> {
        const win = getGlobalWin();
        const isTauri = win.__TAURI_INTERNALS__ !== undefined;
        if (isTauri) {
            try {
                await invoke('plugin:clipboard-manager|write_text', { text });
                return;
            } catch {
                /* fallback to navigator */
            }
        }

        await navigator.clipboard.writeText(text);
    }

    private _showCopyResult(btn: HTMLElement, success: boolean): void {
        if (!success) {
            this._deps.showToast(
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

        this._deps.setManagedTimeout(() => {
            if (this._deps.isDestroyed() || !document.body.contains(btn)) {
                return;
            }
            btn.classList.remove('is-copied');
            btn.innerHTML = originalHtml;
        }, 1200);
    }
}
