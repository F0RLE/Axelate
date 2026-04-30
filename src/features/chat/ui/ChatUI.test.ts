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
    const image = document.querySelector('.chat-img, .chat-generated-image');
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

function requireImageViewerNav(): { prev: HTMLButtonElement; next: HTMLButtonElement } {
    const prev = document.querySelector('.chat-image-viewer-prev');
    const next = document.querySelector('.chat-image-viewer-next');
    if (!(prev instanceof HTMLButtonElement) || !(next instanceof HTMLButtonElement)) {
        throw new TypeError('image viewer navigation not found');
    }

    return { prev, next };
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
                <button class="chat-regenerate-own-btn" title="old-regenerate"></button>
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
        expect(
            (document.querySelector('.chat-copy-own-btn') as HTMLButtonElement).getAttribute(
                'aria-label',
            ),
        ).toBe('t:ui.launcher.web.copy:Copy');
        expect((document.querySelector('.chat-edit-own-btn') as HTMLButtonElement).title).toBe(
            't:ui.launcher.web.edit_last:Edit last message',
        );
        expect(
            (document.querySelector('.chat-regenerate-own-btn') as HTMLButtonElement).title,
        ).toBe('t:ui.launcher.web.regenerate:Regenerate');
        expect(
            (document.querySelector('.chat-regenerate-own-btn') as HTMLButtonElement).dataset[
                'tooltip'
            ],
        ).toBe('t:ui.launcher.web.regenerate:Regenerate');
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
            (document.querySelector('.chat-save-image-btn') as HTMLButtonElement).dataset[
                'tooltip'
            ],
        ).toBe('t:ui.chat.save_image:Save Image');
        expect(
            (document.querySelector('.chat-open-image-folder-btn') as HTMLButtonElement).title,
        ).toBe('t:ui.chat.open_image_folder:Open image folder');
        expect(
            (document.querySelector('.chat-open-image-folder-btn') as HTMLButtonElement).dataset[
                'tooltip'
            ],
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

    it('should replace the pending response state with streamed assistant text', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createStreamingMessage('assistant');
        handle.setStatus('Preparing response...');

        expect(document.querySelector('.chat-streaming-state')?.textContent).toBe(
            'Preparing response...',
        );
        expect(document.querySelector('.markdown-body')?.textContent).toBe('');

        handle.update('hello');

        expect(document.querySelector('.chat-streaming-state')).toBeNull();
        expect(document.querySelector('.markdown-body')?.textContent).toBe('hello');
    });

    it('should finalize generated images without regenerate controls', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();

        handle.finalize({
            text: 'caption',
            images: [{ mime: 'image/png', data_base64: 'ZmFrZQ==' }],
        });

        expect(document.querySelector('.chat-generated-control.is-regenerate')).toBeNull();
        expect(document.querySelector('.chat-generated-controls')).toBeNull();
        expect(document.querySelector('.chat-generated-caption')?.textContent).toBe('caption');
        expect((document.querySelector('.chat-generated-image') as HTMLImageElement).src).toContain(
            'data:image/png;base64,ZmFrZQ==',
        );
    });

    it('should suppress default generated image ready caption', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();

        handle.finalize({
            text: 'Generated image',
            images: [{ mime: 'image/png', data_base64: 'ZmFrZQ==' }],
        });

        expect(document.querySelector('.chat-generated-caption')?.textContent).toBe('');
        expect(
            document.querySelector('.chat-image-generation')?.classList.contains('has-no-caption'),
        ).toBe(true);
    });

    it('should restore assistant image history with generated image layout', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        ui.renderHistory([
            {
                role: 'assistant',
                content: 'Generated image',
                opts: {
                    images: [{ mime: 'image/png', data_base64: 'ZmFrZQ==' }],
                },
            },
        ]);

        expect(document.querySelector('.chat-row--generated-image')).not.toBeNull();
        expect(document.querySelector('.chat-bubble--media')).toBeNull();
        expect((document.querySelector('.chat-generated-image') as HTMLImageElement).src).toContain(
            'data:image/png;base64,ZmFrZQ==',
        );
        expect(
            document.querySelector('.chat-image-generation')?.classList.contains('has-no-caption'),
        ).toBe(true);
    });

    it('should ignore generated image payloads with unsafe mime or base64', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        ui.appendMessage('assistant', 'image', {
            images: [{ mime: 'image/svg+xml', data_base64: '<svg></svg>' }],
            skipAnimation: true,
        });

        expect(document.querySelector('.chat-img, .chat-generated-image')).toBeNull();
        expect(document.querySelector('.chat-save-image-btn')).toBeNull();
    });

    it('should render attachment file names as text only', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        ui.appendMessage('user', 'uploaded', {
            attachments: [
                {
                    name: '<img src=x>.txt',
                    type: 'text/plain',
                    size: 4,
                    data_base64: '',
                    tokens: 3,
                },
            ],
            skipAnimation: true,
        });

        const name = document.querySelector('.media-name');
        expect(name?.textContent).toBe('<img src=x>.txt');
        expect(name?.querySelector('img')).toBeNull();
    });

    it('should render image progress percent and speed separately from status text', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();

        handle.setStatus('image status=running percent=40 step=8 total=20 speed=1.25it/s');

        expect(document.querySelector('.chat-generated-status')?.textContent).toBe(
            't:ui.chat.image_generating:Rendering image',
        );
        expect(
            document.querySelector<HTMLElement>('.chat-generated-progress-fill')?.style.width,
        ).toBe('40%');
        expect(document.querySelector('.chat-generated-progress-summary')?.textContent).toBe(
            '40% · 8/20 steps · 1.25 it/s',
        );
    });

    it('should render image generation heartbeat when concrete progress is unavailable', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();

        handle.setStatus('image status=running elapsed=12s');

        expect(document.querySelector('.chat-generated-status')?.textContent).toBe(
            't:ui.chat.image_generating:Rendering image',
        );
        expect(document.querySelector('.chat-generated-progress-summary')?.textContent).toBe(
            '0% · 12s',
        );
    });

    it('should keep cancelled image generation from becoming a transport error', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();

        handle.cancel();
        handle.fail('error sending request for url (http://localhost:8082/sdapi/v1/txt2img)');

        expect(
            document.querySelector('.chat-image-generation')?.classList.contains('chat-error'),
        ).toBe(false);
        expect(
            document.querySelector('.chat-image-generation')?.classList.contains('is-cancelled'),
        ).toBe(true);
        expect(document.querySelector('.chat-generated-status')?.textContent).toBe(
            't:ui.chat.image_cancelled:Image generation cancelled',
        );
        expect(
            document.querySelector('.chat-generated-progress')?.classList.contains('hidden'),
        ).toBe(true);
    });

    it('should keep generated image preview pinned when the chat was already at bottom', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';
        const messages = document.getElementById('chat-messages') as HTMLDivElement;

        Object.defineProperty(messages, 'clientHeight', { configurable: true, value: 400 });
        Object.defineProperty(messages, 'scrollHeight', {
            configurable: true,
            get: () =>
                document.querySelector('.chat-generated-media:not(.hidden)') === null ? 1000 : 2000,
        });

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();
        expect(messages.scrollTop).toBe(1000);

        handle.setPreview('data:image/png;base64,dGVzdA==');

        expect(messages.scrollTop).toBe(2000);
    });

    it('should not force generated image preview to bottom when the user scrolled up', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';
        const messages = document.getElementById('chat-messages') as HTMLDivElement;

        Object.defineProperty(messages, 'clientHeight', { configurable: true, value: 400 });
        Object.defineProperty(messages, 'scrollHeight', {
            configurable: true,
            get: () =>
                document.querySelector('.chat-generated-media:not(.hidden)') === null ? 1000 : 2000,
        });

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();
        messages.scrollTop = 100;

        handle.setPreview('data:image/png;base64,dGVzdA==');

        expect(messages.scrollTop).toBe(100);
    });

    it('should not force generated image finalization to bottom when the user scrolled up', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';
        const messages = document.getElementById('chat-messages') as HTMLDivElement;

        Object.defineProperty(messages, 'clientHeight', { configurable: true, value: 400 });
        Object.defineProperty(messages, 'scrollHeight', {
            configurable: true,
            get: () =>
                document.querySelector('.chat-generated-media:not(.hidden)') === null ? 1000 : 2000,
        });

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();
        messages.scrollTop = 100;

        handle.finalize({
            text: 'done',
            images: [{ mime: 'image/png', data_base64: 'dGVzdA==' }],
        });

        expect(messages.scrollTop).toBe(100);
    });

    it('should ignore unsafe live generated image preview URLs', () => {
        document.body.innerHTML = '<div id="chat-messages"></div><div id="chat-container"></div>';

        ui = createChatUI();
        const handle = ui.createImageGenerationMessage();
        handle.setPreview('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');

        expect(document.querySelector('.chat-generated-media:not(.hidden)')).toBeNull();
        expect(document.querySelector<HTMLImageElement>('.chat-generated-image')?.src).toBe('');
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
        expect(saveButton.dataset['imageBase64']).toBeUndefined();
        expect(saveButton.dataset['imageMime']).toBeUndefined();
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
        expect(preview.getAttribute('src')).toBeNull();
    });

    it('should close image preview when clicking empty viewer stage', async () => {
        ui = createChatUI();
        await renderAssistantImage(ui, true);

        const image = requireChatImage();
        image.click();
        await flushPromises();

        const { overlay, preview } = requireImageViewer();
        const stage = document.querySelector('.chat-image-viewer-stage');
        if (!(stage instanceof HTMLElement)) {
            throw new TypeError('image viewer stage not found');
        }

        stage.click();
        await flushPromises();

        expect(overlay.classList.contains('hidden')).toBe(true);
        expect(preview.getAttribute('src')).toBeNull();
    });

    it('should switch between chat images from the image viewer', async () => {
        renderImageChatBody();
        ui = createChatUI();
        await ui.init();

        ui.appendMessage('assistant', 'image', {
            images: [
                { mime: 'image/png', data_base64: 'b25l' },
                { mime: 'image/png', data_base64: 'dHdv' },
            ],
            skipAnimation: true,
        });

        const firstImage = document.querySelector('.chat-img');
        if (!(firstImage instanceof HTMLImageElement)) {
            throw new TypeError('first chat image not found');
        }

        firstImage.click();
        await flushPromises();

        const { overlay, preview } = requireImageViewer();
        const { next, prev } = requireImageViewerNav();

        expect(overlay.classList.contains('hidden')).toBe(false);
        expect(preview.src.startsWith('data:image/png;base64,b25l')).toBe(true);

        next.click();
        await flushPromises();

        expect(overlay.classList.contains('hidden')).toBe(false);
        expect(preview.src.startsWith('data:image/png;base64,dHdv')).toBe(true);

        prev.click();
        await flushPromises();

        expect(preview.src.startsWith('data:image/png;base64,b25l')).toBe(true);
    });

    it('should preserve native browser zoom shortcuts while image preview is open', async () => {
        ui = createChatUI();
        await renderAssistantImage(ui, true);

        const image = requireChatImage();
        image.click();
        await flushPromises();

        const wheelEvent = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: 100,
        });
        document.dispatchEvent(wheelEvent);

        expect(wheelEvent.defaultPrevented).toBe(false);

        const keyEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: '+',
        });
        document.dispatchEvent(keyEvent);

        expect(keyEvent.defaultPrevented).toBe(false);
    });

    it('should not open image preview for thumbnails without a usable source', async () => {
        renderImageChatBody();
        document
            .getElementById('chat-messages')
            ?.insertAdjacentHTML('beforeend', '<img class="chat-img" alt="empty">');

        ui = createChatUI();
        await ui.init();

        const image = requireChatImage();
        image.click();
        await flushPromises();

        expect(document.querySelector('.chat-image-viewer')).toBeNull();
        expect(document.body.classList.contains('chat-image-viewer-open')).toBe(false);
    });

    it('should open attached chat images in the same preview viewer', async () => {
        renderImageChatBody();
        ui = createChatUI();
        await ui.init();

        ui.appendMessage('user', 'uploaded', {
            attachments: [
                {
                    name: 'photo.png',
                    type: 'image/png',
                    size: 4,
                    data_base64: 'cGhvdG8=',
                    tokens: 7,
                },
            ],
            skipAnimation: true,
        });

        const attachmentImage = document.querySelector('.chat-attachment-img');
        if (!(attachmentImage instanceof HTMLImageElement)) {
            throw new TypeError('attachment image not found');
        }
        const badge = document.querySelector('.media-badge');
        if (!(badge instanceof HTMLElement)) {
            throw new TypeError('attachment badge not found');
        }

        badge.click();
        await flushPromises();

        const { overlay, preview } = requireImageViewer();
        expect(overlay.classList.contains('hidden')).toBe(false);
        expect(preview.src.startsWith('data:image/png;base64,cGhvdG8=')).toBe(true);
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
        expect(document.querySelector('.chat-image-viewer')).toBeNull();
    });
});
