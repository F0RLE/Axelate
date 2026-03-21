import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChatUI } from './ChatUI';

describe('ChatUI lifecycle', () => {
    let ui: ChatUI | null = null;

    beforeEach(() => {
        document.body.innerHTML = '<div id="chat-messages"></div>';
        (
            globalThis as unknown as {
                t: (key: string, fallback?: string) => string;
            }
        ).t = (key, fallback) => `t:${key}:${fallback ?? ''}`;
        vi.clearAllMocks();
    });

    afterEach(() => {
        ui?.destroy();
        ui = null;
        document.body.innerHTML = '';
    });

    it('should remove delegated document click handler on destroy', async () => {
        const messages = document.getElementById('chat-messages');
        if (!(messages instanceof HTMLElement)) {
            throw new Error('chat-messages not found');
        }
        messages.innerHTML = '<button class="chat-copy-own-btn" data-copy-text="hello"></button>';

        ui = new ChatUI();

        const button = document.querySelector('.chat-copy-own-btn') as HTMLButtonElement;
        button.click();
        await Promise.resolve();

        expect(invoke).toHaveBeenCalledTimes(1);

        ui.destroy();
        button.click();
        await Promise.resolve();

        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from retry status listener on destroy', async () => {
        const unlisten = vi.fn();
        vi.mocked(listen).mockResolvedValueOnce(unlisten);

        ui = new ChatUI();
        await ui.init();

        expect(listen).toHaveBeenCalledWith('ai:status:retry', expect.any(Function));

        ui.destroy();

        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('should refresh localized titles for existing chat action buttons', () => {
        document.body.innerHTML = `
            <div id="chat-messages">
                <button class="chat-copy-own-btn" title="old-copy"></button>
                <button class="chat-edit-own-btn" title="old-edit"></button>
                <button class="code-copy-btn" title="old-code"><span>Old Copy</span></button>
                <button class="chat-img-download-btn" title="old-save"></button>
                <button class="media-remove" title="old-remove"></button>
            </div>
            <textarea id="chat-input" data-i18n-placeholder="ui.launcher.web.chat_placeholder"></textarea>
            <button id="clear-chat-btn"><span class="chat-clear-text"></span></button>
            <button id="chat-attach-btn"></button>
            <button id="chat-voice-btn"></button>
            <button id="chat-send-btn"></button>
        `;

        ui = new ChatUI();
        ui.refreshTranslations();

        expect((document.querySelector('.chat-copy-own-btn') as HTMLButtonElement).title).toBe(
            't:ui.launcher.web.copy:Copy',
        );
        expect((document.querySelector('.chat-edit-own-btn') as HTMLButtonElement).title).toBe(
            't:ui.launcher.web.edit_last:Edit last message',
        );
        expect((document.querySelector('.code-copy-btn') as HTMLButtonElement).title).toBe(
            't:ui.launcher.web.copy_code:Copy code',
        );
        expect((document.querySelector('.code-copy-btn span') as HTMLSpanElement).textContent).toBe(
            't:ui.launcher.web.copy:Copy',
        );
        expect((document.querySelector('.chat-img-download-btn') as HTMLButtonElement).title).toBe(
            't:ui.chat.save_image:Save Image',
        );
        expect((document.querySelector('.media-remove') as HTMLButtonElement).title).toBe(
            't:ui.launcher.web.remove_attachment:Remove attachment',
        );
    });
});
