import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChatUI } from './ChatUI';
import { chatFileHandler } from '../services/ChatFileHandler';

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
                <button class="chat-save-image-btn" title="old-save"></button>
                <button class="chat-open-image-folder-btn" title="old-folder"></button>
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
        expect((document.querySelector('.chat-save-image-btn') as HTMLButtonElement).title).toBe(
            't:ui.chat.save_image:Save Image',
        );
        expect(
            (document.querySelector('.chat-open-image-folder-btn') as HTMLButtonElement).title,
        ).toBe('t:ui.chat.open_image_folder:Open image folder');
        expect((document.querySelector('.media-remove') as HTMLButtonElement).title).toBe(
            't:ui.launcher.web.remove_attachment:Remove attachment',
        );
    });

    it('should refresh token count from internal state instead of parsing rendered text', () => {
        document.body.innerHTML = `
            <div id="chat-messages"></div>
            <div id="chat-token-count" class="visible">broken localized token text</div>
            <textarea id="chat-input" data-i18n-placeholder="ui.launcher.web.chat_placeholder"></textarea>
            <button id="clear-chat-btn"><span class="chat-clear-text"></span></button>
            <button id="chat-attach-btn"></button>
            <button id="chat-voice-btn"></button>
            <button id="chat-send-btn"></button>
        `;

        ui = new ChatUI();
        ui.updateTokenCount(12);

        const tokenEl = document.getElementById('chat-token-count') as HTMLElement;
        tokenEl.textContent = 'непарсимое значение';

        ui.refreshTranslations();

        expect(tokenEl.textContent).toBe('12 t:ui.launcher.web.tokens:tokens');
    });

    it('should remove orphan streaming message when finalized without answer text', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = new ChatUI();
        const handle = ui.createStreamingMessage('assistant');
        handle.finalize('');

        expect(document.querySelector('.chat-row')).toBeNull();
    });

    it('should scroll chat history to the bottom after restore', () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        const messages = document.getElementById('chat-messages') as HTMLDivElement;
        Object.defineProperty(messages, 'scrollHeight', { configurable: true, value: 640 });

        ui = new ChatUI();
        ui.renderHistory([
            { role: 'user', content: 'one' },
            { role: 'assistant', content: 'two' },
        ]);

        expect(messages.scrollTop).toBe(640);
        vi.runAllTimers();
        expect(messages.scrollTop).toBe(640);
    });

    it('should ignore stale attachment renders after attachments were cleared', async () => {
        let resolveTokens: ((value: number) => void) | null = null;
        vi.spyOn(chatFileHandler, 'getFileTokenEstimate').mockImplementation(
            () =>
                new Promise<number>((resolve) => {
                    resolveTokens = resolve;
                }),
        );

        document.body.innerHTML = `
            <div id="chat-messages"></div>
            <div id="chat-container"></div>
            <div id="chat-attachments"></div>
        `;

        ui = new ChatUI();
        const file = new File(['content'], 'late.txt', { type: 'text/plain' });

        ui.updateAttachments([file], () => {});
        ui.updateAttachments([], () => {});

        (resolveTokens as ((value: number) => void) | null)?.(7);
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector('.chat-media-card')).toBeNull();
    });

    it('should save generated chat images to the default axelate pictures folder', async () => {
        vi.useFakeTimers();
        const showToast = vi.fn();
        (
            globalThis as unknown as {
                showToast: typeof showToast;
            }
        ).showToast = showToast;

        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = new ChatUI();
        ui.appendMessage('assistant', 'image', {
            images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
            skipAnimation: true,
        });

        expect(document.querySelector('.chat-copy-own-btn')).toBeNull();

        const saveButton = document.querySelector('.chat-save-image-btn');
        if (!(saveButton instanceof HTMLButtonElement)) {
            throw new Error('save image button not found');
        }

        vi.mocked(invoke).mockResolvedValueOnce({
            file_path: 'C:\\Users\\FORLE\\Pictures\\axelate\\axelate_image.png',
            folder_path: 'C:\\Users\\FORLE\\Pictures\\axelate',
        });
        saveButton.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(invoke).toHaveBeenCalledWith('save_chat_image_default', {
            base64Data: 'dGVzdA==',
            mimeType: 'image/png',
        });
        expect(saveButton.classList.contains('is-saved')).toBe(true);
        expect(showToast).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        await Promise.resolve();

        expect(document.querySelector('.chat-save-image-btn')).toBeNull();
        expect(saveButton.classList.contains('chat-open-image-folder-btn')).toBe(true);
        vi.useRealTimers();
    });

    it('should open saved image folder from chat action bar', async () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = new ChatUI();
        ui.appendMessage('assistant', 'image', {
            images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
            skipAnimation: true,
        });

        const saveButton = document.querySelector('.chat-save-image-btn');
        if (!(saveButton instanceof HTMLButtonElement)) {
            throw new Error('save image button not found');
        }

        vi.mocked(invoke).mockResolvedValueOnce({
            file_path: 'C:\\Users\\FORLE\\Pictures\\axelate\\axelate_image.png',
            folder_path: 'C:\\Users\\FORLE\\Pictures\\axelate',
        });
        saveButton.click();
        await Promise.resolve();
        await Promise.resolve();

        vi.advanceTimersByTime(300);
        await Promise.resolve();

        vi.mocked(invoke).mockResolvedValueOnce(undefined);
        saveButton.click();
        await Promise.resolve();

        expect(invoke).toHaveBeenLastCalledWith('open_chat_image_location', {
            filePath: 'C:\\Users\\FORLE\\Pictures\\axelate\\axelate_image.png',
            folderPath: 'C:\\Users\\FORLE\\Pictures\\axelate',
        });
        vi.useRealTimers();
    });

    it('should restore save button when saved image was removed from disk', async () => {
        vi.useFakeTimers();
        const showToast = vi.fn();
        (
            globalThis as unknown as {
                showToast: typeof showToast;
            }
        ).showToast = showToast;

        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = new ChatUI();
        ui.appendMessage('assistant', 'image', {
            images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
            skipAnimation: true,
        });

        const saveButton = document.querySelector('.chat-save-image-btn');
        if (!(saveButton instanceof HTMLButtonElement)) {
            throw new Error('save image button not found');
        }

        vi.mocked(invoke).mockResolvedValueOnce({
            file_path: 'C:\\Users\\FORLE\\Pictures\\axelate\\axelate_image.png',
            folder_path: 'C:\\Users\\FORLE\\Pictures\\axelate',
        });
        saveButton.click();
        await Promise.resolve();
        await Promise.resolve();

        vi.advanceTimersByTime(300);
        await Promise.resolve();

        vi.mocked(invoke).mockRejectedValueOnce(new Error('Saved image does not exist'));
        saveButton.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(saveButton.classList.contains('chat-save-image-btn')).toBe(true);
        expect(saveButton.classList.contains('chat-open-image-folder-btn')).toBe(false);
        expect(invoke).toHaveBeenLastCalledWith('open_chat_image_location', {
            filePath: 'C:\\Users\\FORLE\\Pictures\\axelate',
            folderPath: 'C:\\Users\\FORLE\\Pictures\\axelate',
        });
        expect(showToast).toHaveBeenCalledWith(
            't:ui.chat.image_missing_resave:Image was removed, save it again',
            'warning',
        );
        vi.useRealTimers();
    });

    it('should delete saved image and restore download button on right click', async () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = new ChatUI();
        ui.appendMessage('assistant', 'image', {
            images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
            skipAnimation: true,
        });

        const saveButton = document.querySelector('.chat-save-image-btn');
        if (!(saveButton instanceof HTMLButtonElement)) {
            throw new Error('save image button not found');
        }

        vi.mocked(invoke).mockResolvedValueOnce({
            file_path: 'C:\\Users\\FORLE\\Pictures\\axelate\\axelate_image.png',
            folder_path: 'C:\\Users\\FORLE\\Pictures\\axelate',
        });
        saveButton.click();
        await Promise.resolve();
        await Promise.resolve();

        vi.advanceTimersByTime(300);
        await Promise.resolve();

        saveButton.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
        );
        expect(saveButton.classList.contains('is-resetting')).toBe(true);
        expect(saveButton.classList.contains('is-trash-state')).toBe(true);

        vi.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();

        expect(invoke).toHaveBeenLastCalledWith('delete_chat_image', {
            filePath: 'C:\\Users\\FORLE\\Pictures\\axelate\\axelate_image.png',
        });
        expect(saveButton.classList.contains('chat-save-image-btn')).toBe(true);
        expect(saveButton.classList.contains('chat-open-image-folder-btn')).toBe(false);
        vi.useRealTimers();
    });

    it('should open image preview on thumbnail click and close on backdrop click', async () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = new ChatUI();
        ui.appendMessage('assistant', 'image', {
            images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
            skipAnimation: true,
        });

        const image = document.querySelector('.chat-img');
        if (!(image instanceof HTMLImageElement)) {
            throw new Error('chat image not found');
        }

        image.click();
        await Promise.resolve();

        const overlay = document.querySelector('.chat-image-viewer');
        const preview = document.querySelector('.chat-image-viewer-img');
        if (!(overlay instanceof HTMLElement) || !(preview instanceof HTMLImageElement)) {
            throw new Error('image viewer not found');
        }

        expect(overlay.classList.contains('hidden')).toBe(false);
        expect(preview.src.startsWith('data:image/png;base64,dGVzdA==')).toBe(true);

        overlay.click();
        await Promise.resolve();

        expect(overlay.classList.contains('hidden')).toBe(true);
    });

    it('should remove image viewer body state on destroy', async () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = new ChatUI();
        ui.appendMessage('assistant', 'image', {
            images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
            skipAnimation: true,
        });

        const image = document.querySelector('.chat-img');
        if (!(image instanceof HTMLImageElement)) {
            throw new Error('chat image not found');
        }

        image.click();
        await Promise.resolve();

        expect(document.body.classList.contains('chat-image-viewer-open')).toBe(true);

        ui.destroy();
        ui = null;

        expect(document.body.classList.contains('chat-image-viewer-open')).toBe(false);
    });
});
