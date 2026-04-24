import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChatUI } from './ChatUI';
import { ChatFileHandler } from '../services/ChatFileHandler';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

const savedImageFilePath = String.raw`C:\Users\FORLE\Pictures\axelate\axelate_image.png`;
const savedImageFolderPath = String.raw`C:\Users\FORLE\Pictures\axelate`;
const assistantImagePayload = {
    images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
    skipAnimation: true,
};
const translate = (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}`;
let fileHandler: ChatFileHandler;
const fileHandlerTracer: Pick<LoggerService, 'warn' | 'error'> = {
    warn: vi.fn(),
    error: vi.fn(),
};
const chatUiTracer: Pick<LoggerService, 'warn' | 'error' | 'debug'> = {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

function createChatUI(options?: {
    showToast?: (
        message: string,
        type?: 'success' | 'error' | 'warning' | 'info',
        duration?: number,
    ) => void;
    isTauriRuntime?: boolean;
}): ChatUI {
    const showToast = options?.showToast ?? vi.fn();
    const isTauriRuntime = options?.isTauriRuntime ?? true;

    return new ChatUI({
        fileHandler,
        translate,
        showToast,
        isTauriRuntime: () => isTauriRuntime,
        openExternalUrl: async (url: string) => {
            if (isTauriRuntime) {
                await invoke('plugin:shell|open', { path: url });
                return;
            }

            window.open(url, '_blank');
        },
        copyText: async (text: string) => {
            if (isTauriRuntime) {
                await invoke('plugin:clipboard-manager|write_text', { text });
                return;
            }

            await navigator.clipboard.writeText(text);
        },
        tracer: chatUiTracer,
    });
}

async function flushPromises(count = 1): Promise<void> {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
}

function renderImageChatBody(): void {
    document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';
}

function requireSaveImageButton(): HTMLButtonElement {
    const saveButton = document.querySelector('.chat-save-image-btn');
    if (!(saveButton instanceof HTMLButtonElement)) {
        throw new TypeError('save image button not found');
    }

    return saveButton;
}

function requireChatImage(): HTMLImageElement {
    const image = document.querySelector('.chat-img');
    if (!(image instanceof HTMLImageElement)) {
        throw new TypeError('chat image not found');
    }

    return image;
}

function requireImageViewer(): { overlay: HTMLElement; preview: HTMLImageElement } {
    const overlay = document.querySelector('.chat-image-viewer');
    const preview = document.querySelector('.chat-image-viewer-img');
    if (!(overlay instanceof HTMLElement) || !(preview instanceof HTMLImageElement)) {
        throw new TypeError('image viewer not found');
    }

    return { overlay, preview };
}

async function renderAssistantImage(ui: ChatUI, initialize = false): Promise<void> {
    renderImageChatBody();
    if (initialize) {
        await ui.init();
    }

    ui.appendMessage('assistant', 'image', assistantImagePayload);
}

async function saveGeneratedImage(saveButton: HTMLButtonElement): Promise<void> {
    vi.mocked(invoke).mockResolvedValueOnce({
        file_path: savedImageFilePath,
        folder_path: savedImageFolderPath,
    });
    saveButton.click();
    await flushPromises(2);
}

async function convertSaveButtonToFolderAction(saveButton: HTMLButtonElement): Promise<void> {
    await saveGeneratedImage(saveButton);
    vi.advanceTimersByTime(300);
    await flushPromises();
}

describe('ChatUI lifecycle', () => {
    let ui: ChatUI | null = null;

    beforeEach(() => {
        document.body.innerHTML = '<div id="chat-messages"></div>';
        vi.clearAllMocks();
        fileHandler = new ChatFileHandler(fileHandlerTracer);
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

        ui = createChatUI();
        await ui.init();

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

        ui = createChatUI();
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

        ui = createChatUI();
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
            <div id="chat-container" class="has-messages"></div>
            <div id="chat-messages"></div>
            <div id="chat-token-count" class="visible">broken localized token text</div>
            <textarea id="chat-input" data-i18n-placeholder="ui.launcher.web.chat_placeholder"></textarea>
            <button id="clear-chat-btn"><span class="chat-clear-text"></span></button>
            <button id="chat-attach-btn"></button>
            <button id="chat-voice-btn"></button>
            <button id="chat-send-btn"></button>
            <button id="chat-context-btn"></button>
        `;

        ui = createChatUI();
        ui.updateTokenCount(12, 100);
        ui.updateContextTokenCount(12, 100);

        const tokenEl = document.getElementById('chat-token-count') as HTMLElement;
        const contextBtn = document.getElementById('chat-context-btn') as HTMLElement;
        tokenEl.textContent = 'непарсимое значение';

        ui.refreshTranslations();

        expect(tokenEl.textContent).toBe('12 t:ui.launcher.web.tokens:tokens');
        expect(contextBtn.style.getPropertyValue('--chat-context-fill')).toBe('12%');
        expect(contextBtn.title).toContain('12 / 100');
    });

    it('should render context usage on the chat context button', () => {
        document.body.innerHTML = `
            <div id="chat-messages"></div>
            <div id="chat-token-count"></div>
            <button id="chat-context-btn"></button>
        `;

        ui = createChatUI();
        ui.updateContextTokenCount(512, 1024);

        const contextBtn = document.getElementById('chat-context-btn') as HTMLElement;

        expect(contextBtn.style.getPropertyValue('--chat-context-fill')).toBe('50%');
        expect(contextBtn.classList.contains('visible')).toBe(true);
        expect(contextBtn.dataset['tooltip']).toContain('512 / 1024');
    });

    it('should keep context usage visible after the input becomes empty', () => {
        document.body.innerHTML = `
            <div id="chat-container" class="has-messages"></div>
            <div id="chat-token-count"></div>
            <button id="chat-context-btn"></button>
        `;

        ui = createChatUI();
        ui.updateContextTokenCount(99, 258000);
        ui.updateTokenCount(0, 258000);

        const contextBtn = document.getElementById('chat-context-btn') as HTMLElement;

        expect(contextBtn.classList.contains('visible')).toBe(true);
        expect(contextBtn.dataset['tooltip']).toContain('99 / 258000');
    });

    it('should remove orphan streaming message when finalized without answer text', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createStreamingMessage('assistant');
        handle.finalize('');

        expect(document.querySelector('.chat-row')).toBeNull();
    });

    it('should show streaming dots until first text chunk arrives', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createStreamingMessage('assistant');

        expect(document.querySelector('.chat-streaming-status .typing-dots')).not.toBeNull();

        handle.update('hello');

        expect(document.querySelector('.chat-streaming-status')).toBeNull();
        expect(document.querySelector('.markdown-body')?.textContent).toBe('hello');
    });

    it('should scroll chat history to the bottom after restore', () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        const messages = document.getElementById('chat-messages') as HTMLDivElement;
        Object.defineProperty(messages, 'scrollHeight', { configurable: true, value: 640 });

        ui = createChatUI();
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
        vi.spyOn(fileHandler, 'getFileTokenEstimate').mockImplementation(
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

        ui = createChatUI();
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
        ui = createChatUI({ showToast });
        await renderAssistantImage(ui);

        expect(document.querySelector('.chat-copy-own-btn')).toBeNull();

        const saveButton = requireSaveImageButton();
        await saveGeneratedImage(saveButton);

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
        ui = createChatUI();
        await renderAssistantImage(ui);

        const saveButton = requireSaveImageButton();
        await convertSaveButtonToFolderAction(saveButton);

        vi.mocked(invoke).mockResolvedValueOnce(undefined);
        saveButton.click();
        await flushPromises();

        expect(invoke).toHaveBeenLastCalledWith('open_chat_image_location', {
            filePath: savedImageFilePath,
            folderPath: savedImageFolderPath,
        });
        vi.useRealTimers();
    });

    it('should restore save button when saved image was removed from disk', async () => {
        vi.useFakeTimers();
        const showToast = vi.fn();
        ui = createChatUI({ showToast });
        await renderAssistantImage(ui);

        const saveButton = requireSaveImageButton();
        await convertSaveButtonToFolderAction(saveButton);

        vi.mocked(invoke).mockRejectedValueOnce(new TypeError('Saved image does not exist'));
        saveButton.click();
        await flushPromises(2);

        expect(saveButton.classList.contains('chat-save-image-btn')).toBe(true);
        expect(saveButton.classList.contains('chat-open-image-folder-btn')).toBe(false);
        expect(invoke).toHaveBeenLastCalledWith('open_chat_image_location', {
            filePath: savedImageFolderPath,
            folderPath: savedImageFolderPath,
        });
        expect(showToast).toHaveBeenCalledWith(
            't:ui.chat.image_missing_resave:Image was removed, save it again',
            'warning',
            2000,
        );
        vi.useRealTimers();
    });

    it('should delete saved image and restore download button on right click', async () => {
        vi.useFakeTimers();
        ui = createChatUI();
        await renderAssistantImage(ui);

        const saveButton = requireSaveImageButton();
        await convertSaveButtonToFolderAction(saveButton);

        saveButton.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
        );
        expect(saveButton.classList.contains('is-resetting')).toBe(true);
        expect(saveButton.classList.contains('is-trash-state')).toBe(true);

        vi.advanceTimersByTime(300);
        await flushPromises(2);

        expect(invoke).toHaveBeenLastCalledWith('delete_chat_image', {
            filePath: savedImageFilePath,
        });
        expect(saveButton.classList.contains('chat-save-image-btn')).toBe(true);
        expect(saveButton.classList.contains('chat-open-image-folder-btn')).toBe(false);
        vi.useRealTimers();
    });

    it('should open image preview on thumbnail click and close on backdrop click', async () => {
        ui = createChatUI();
        await renderAssistantImage(ui, true);

        const image = requireChatImage();
        image.click();
        await flushPromises();

        const { overlay, preview } = requireImageViewer();

        expect(overlay.classList.contains('hidden')).toBe(false);
        expect(preview.src.startsWith('data:image/png;base64,dGVzdA==')).toBe(true);

        overlay.click();
        await flushPromises();

        expect(overlay.classList.contains('hidden')).toBe(true);
    });

    it('should remove image viewer body state on destroy', async () => {
        ui = createChatUI();
        await renderAssistantImage(ui, true);

        const image = requireChatImage();
        image.click();
        await flushPromises();

        expect(document.body.classList.contains('chat-image-viewer-open')).toBe(true);

        ui.destroy();
        ui = null;

        expect(document.body.classList.contains('chat-image-viewer-open')).toBe(false);
    });
});
