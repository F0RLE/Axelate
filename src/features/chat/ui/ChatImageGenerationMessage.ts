type ChatImagePayload = {
    mime: string;
    data_base64: string;
};

type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

type ImageGenerationMessageHandle = {
    setStatus: (text: string) => void;
    setPreview: (dataUrl: string) => void;
    finalize: (result: { text: string; images: ChatImagePayload[] }) => void;
    fail: (message: string) => void;
    cancel: (message?: string) => void;
    discard: () => void;
};

type CreateChatImageGenerationMessageDeps = {
    translate: ChatTranslate;
    isDestroyed: () => boolean;
    tracer: { error: (message: string, error?: unknown) => void };
    scrollToBottom: (sticky?: boolean) => void;
    appendRow: (row: HTMLElement) => void;
    createMessageBubble: (opts: Record<string, unknown>) => HTMLElement;
    appendMessageActions: (
        content: string,
        role: 'user' | 'assistant',
        image: ChatImagePayload | null,
    ) => { actionBar: HTMLElement; copyBtn: HTMLElement; editBtn: HTMLElement | null } | null;
    scheduleBubbleImageActions: (bubble: HTMLElement, actionBar: HTMLElement) => void;
    opts: {
        onCancel: () => void | Promise<void>;
        onRegenerate: () => void | Promise<void>;
    };
};

export function createChatImageGenerationMessage(
    deps: CreateChatImageGenerationMessageDeps,
): ImageGenerationMessageHandle {
    const row = document.createElement('div');
    row.className = 'chat-row bot';

    const bubble = deps.createMessageBubble({ mediaFirst: true });
    bubble.classList.add('chat-image-generation');

    const media = document.createElement('div');
    media.className = 'chat-generated-media hidden';

    const image = document.createElement('img');
    image.className = 'chat-img chat-generated-image';
    image.alt = 'Generated preview';
    media.appendChild(image);

    const status = document.createElement('div');
    status.className = 'chat-generated-status';
    status.textContent = deps.translate('ui.chat.image_generating', 'Generating image...');

    const progress = document.createElement('div');
    progress.className = 'chat-generated-progress';

    const progressFill = document.createElement('div');
    progressFill.className = 'chat-generated-progress-fill';
    progress.appendChild(progressFill);

    const caption = document.createElement('div');
    caption.className = 'chat-generated-caption hidden';

    const controls = document.createElement('div');
    controls.className = 'chat-generated-controls';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'chat-generated-control is-cancel';
    cancelBtn.textContent = deps.translate('ui.chat.image_cancel', 'Cancel');

    const regenerateBtn = document.createElement('button');
    regenerateBtn.type = 'button';
    regenerateBtn.className = 'chat-generated-control is-regenerate hidden';
    regenerateBtn.textContent = deps.translate('ui.chat.image_regenerate', 'Regenerate');

    const invokeControl = (button: HTMLButtonElement, action: () => void | Promise<void>): void => {
        button.disabled = true;
        Promise.resolve(action())
            .catch((error: unknown) => {
                deps.tracer.error('[ChatUI] Image generation control failed', error);
            })
            .finally(() => {
                if (!deps.isDestroyed() && button.isConnected) {
                    button.disabled = false;
                }
            });
    };

    cancelBtn.addEventListener('click', () => {
        invokeControl(cancelBtn, deps.opts.onCancel);
    });
    regenerateBtn.addEventListener('click', () => {
        invokeControl(regenerateBtn, deps.opts.onRegenerate);
    });

    controls.append(cancelBtn, regenerateBtn);
    bubble.append(media, status, progress, caption, controls);
    row.appendChild(bubble);
    deps.appendRow(row);
    deps.scrollToBottom();

    let actions: {
        actionBar: HTMLElement;
        copyBtn: HTMLElement;
        editBtn: HTMLElement | null;
    } | null = null;
    let finalImage: ChatImagePayload | null = null;

    const setProgressFromStatus = (text: string): void => {
        const dividerIndex = text.indexOf('/');
        if (dividerIndex < 0) {
            progressFill.style.width = '';
            progress.classList.remove('is-complete');
            return;
        }

        const current = Number.parseInt(text.slice(0, dividerIndex).trim(), 10);
        const total = Number.parseInt(text.slice(dividerIndex + 1).trim(), 10);
        if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
            progressFill.style.width = '';
            progress.classList.remove('is-complete');
            return;
        }

        const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
        progressFill.style.width = `${String(percent)}%`;
        progress.classList.toggle('is-complete', percent >= 100);
    };

    const showPreview = (dataUrl: string): void => {
        if (dataUrl.trim() === '') return;
        if (image.src === dataUrl) return;
        image.src = dataUrl;
        media.classList.remove('hidden');
        bubble.classList.add('chat-bubble--media');
        deps.scrollToBottom(true);
    };

    const showRegenerateOnly = (): void => {
        cancelBtn.classList.add('hidden');
        regenerateBtn.classList.remove('hidden');
    };

    const ensureImageActions = (content: string): void => {
        if (finalImage === null) {
            return;
        }
        actions ??= deps.appendMessageActions(content, 'assistant', finalImage);
        if (actions !== null && !bubble.contains(actions.actionBar)) {
            bubble.appendChild(actions.actionBar);
            deps.scheduleBubbleImageActions(bubble, actions.actionBar);
        }
    };

    return {
        setStatus: (text: string) => {
            status.textContent = text;
            setProgressFromStatus(text);
        },
        setPreview: (dataUrl: string) => {
            showPreview(dataUrl);
        },
        finalize: (result: { text: string; images: ChatImagePayload[] }) => {
            finalImage = result.images[0] ?? null;
            if (finalImage !== null) {
                showPreview(`data:${finalImage.mime};base64,${finalImage.data_base64}`);
            }

            status.textContent = deps.translate('ui.chat.image_ready', 'Generated image');
            progressFill.style.width = '100%';
            progress.classList.add('is-complete');

            caption.textContent = result.text;
            caption.classList.toggle('hidden', result.text.trim() === '');

            showRegenerateOnly();
            ensureImageActions(result.text);
            deps.scrollToBottom();
        },
        fail: (message: string) => {
            bubble.classList.add('chat-error');
            status.textContent = message;
            progress.classList.remove('is-complete');
            progressFill.style.width = '';
            caption.classList.add('hidden');
            showRegenerateOnly();
            deps.scrollToBottom();
        },
        cancel: (message = deps.translate('ui.chat.image_cancelled', 'Image generation cancelled')) => {
            status.textContent = message;
            progress.classList.remove('is-complete');
            progressFill.style.width = '';
            caption.classList.add('hidden');
            showRegenerateOnly();
            deps.scrollToBottom();
        },
        discard: () => {
            row.remove();
        },
    };
}
