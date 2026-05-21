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
    };
};

type ImageGenerationProgress = {
    percent: number;
    step: number | null;
    total: number | null;
    speed: string | null;
    elapsed: string | null;
};

const parseImageGenerationProgress = (text: string): ImageGenerationProgress => {
    let percent = 0;
    let step: number | null = null;
    let total: number | null = null;
    const percentMatch = text.match(/\bpercent=(\d+(?:\.\d+)?)/u);
    if (percentMatch !== null) {
        const parsedPercent = Number.parseFloat(percentMatch[1] ?? '');
        if (Number.isFinite(parsedPercent)) {
            percent = Math.max(0, Math.min(100, Math.round(parsedPercent)));
        }
    }

    const stepMatch = text.match(/\bstep=(\d+)\s+total=(\d+)/u);
    if (stepMatch !== null) {
        const parsedStep = Number.parseInt(stepMatch[1] ?? '', 10);
        const parsedTotal = Number.parseInt(stepMatch[2] ?? '', 10);
        if (Number.isFinite(parsedStep) && Number.isFinite(parsedTotal) && parsedTotal > 0) {
            step = parsedStep;
            total = parsedTotal;
            if (percentMatch === null) {
                percent = Math.max(0, Math.min(100, Math.round((parsedStep / parsedTotal) * 100)));
            }
        }
    }

    const speedMatch = text.match(/\bspeed=([^\s]+)/u);
    const speed = speedMatch?.[1]?.replace(/(it\/s|s\/it)$/iu, ' $1').toLowerCase() ?? null;
    const elapsedMatch = text.match(/\belapsed=([^\s]+)/u);
    const elapsed = elapsedMatch?.[1] ?? null;

    return { percent, step, total, speed, elapsed };
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
    image.width = 512;
    image.height = 512;
    image.decoding = 'async';
    media.appendChild(image);

    const status = document.createElement('div');
    status.className = 'chat-generated-status';
    status.textContent = deps.translate('ui.chat.image_generating', 'Rendering image');

    const statusRow = document.createElement('div');
    statusRow.className = 'chat-generated-status-row';

    const progressSummary = document.createElement('span');
    progressSummary.className = 'chat-generated-progress-summary';
    progressSummary.textContent = '0%';
    statusRow.append(status, progressSummary);

    const progress = document.createElement('div');
    progress.className = 'chat-generated-progress';

    const progressFill = document.createElement('div');
    progressFill.className = 'chat-generated-progress-fill';
    progress.appendChild(progressFill);

    const caption = document.createElement('div');
    caption.className = 'chat-generated-caption markdown-body hidden';

    const controls = document.createElement('div');
    controls.className = 'chat-generated-controls';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'chat-generated-control is-cancel';
    cancelBtn.textContent = deps.translate('ui.chat.image_cancel', 'Cancel');
    cancelBtn.title = deps.translate('ui.chat.image_cancel', 'Cancel');
    cancelBtn.setAttribute('aria-label', deps.translate('ui.chat.image_cancel', 'Cancel'));

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
        handle.cancel();
        invokeControl(cancelBtn, deps.opts.onCancel);
    });
    controls.append(cancelBtn);
    bubble.append(media, statusRow, progress, caption, controls);
    row.appendChild(bubble);
    deps.appendRow(row);
    deps.scrollToBottom();

    let actions: {
        actionBar: HTMLElement;
        copyBtn: HTMLElement;
        editBtn: HTMLElement | null;
    } | null = null;
    let finalImage: ChatImagePayload | null = null;
    let isCancelled = false;

    const setProgressFromStatus = (text: string): void => {
        const { elapsed, percent, speed, step, total } = parseImageGenerationProgress(text);
        progressFill.style.width = `${String(percent)}%`;
        const details: string[] = [];
        if (step !== null && total !== null) {
            details.push(`${String(step)}/${String(total)} steps`);
        }
        if (speed !== null) {
            details.push(speed);
        }
        if (elapsed !== null) {
            details.push(elapsed);
        }
        progressSummary.textContent =
            details.length === 0
                ? `${String(percent)}%`
                : `${String(percent)}% · ${details.join(' · ')}`;
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

    const hideControls = (): void => {
        controls.classList.add('hidden');
    };

    const hideProgress = (): void => {
        progress.classList.add('hidden');
        progressSummary.classList.add('hidden');
        progress.classList.remove('is-complete');
        progressFill.style.width = '';
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

    const handle: ImageGenerationMessageHandle = {
        setStatus: (text: string) => {
            if (isCancelled) return;
            status.textContent = deps.translate('ui.chat.image_generating', 'Rendering image');
            setProgressFromStatus(text);
        },
        setPreview: (dataUrl: string) => {
            if (isCancelled) return;
            showPreview(dataUrl);
        },
        finalize: (result: { text: string; images: ChatImagePayload[] }) => {
            if (isCancelled) return;
            finalImage = result.images[0] ?? null;
            if (finalImage !== null) {
                showPreview(`data:${finalImage.mime};base64,${finalImage.data_base64}`);
            }

            status.textContent = deps.translate('ui.chat.image_ready', 'Generated image');
            progressFill.style.width = '100%';
            progressSummary.textContent = '100%';
            progress.classList.add('is-complete');

            caption.textContent = result.text;
            caption.classList.toggle('hidden', result.text.trim() === '');

            bubble.classList.add('is-complete');
            hideControls();
            ensureImageActions(result.text);
            deps.scrollToBottom();
        },
        fail: (message: string) => {
            if (isCancelled) {
                return;
            }
            bubble.classList.add('chat-error');
            status.textContent = message;
            hideProgress();
            caption.classList.add('hidden');
            hideControls();
            deps.scrollToBottom();
        },
        cancel: (
            message = deps.translate('ui.chat.image_cancelled', 'Image generation cancelled'),
        ) => {
            isCancelled = true;
            bubble.classList.remove('chat-error');
            bubble.classList.add('is-cancelled');
            status.textContent = message;
            hideProgress();
            caption.classList.add('hidden');
            hideControls();
            deps.scrollToBottom();
        },
        discard: () => {
            row.remove();
        },
    };

    return handle;
}
