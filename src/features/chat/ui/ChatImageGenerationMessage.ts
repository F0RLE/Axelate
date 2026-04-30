import {
    buildSafeImageDataUrl,
    isSafeImageDataUrl,
    normalizeImagePayload,
    type ChatImagePayload,
} from './ChatImagePayload';

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
    isNearBottom: () => boolean;
    appendRow: (row: HTMLElement) => void;
    createMessageBubble: (opts: Record<string, unknown>) => HTMLElement;
    appendMessageActions: (
        content: string,
        role: 'user' | 'assistant',
        image: ChatImagePayload | null,
    ) => { actionBar: HTMLElement; copyBtn: HTMLElement; editBtn: HTMLElement | null } | null;
    scheduleBubbleImageActions: (bubble: HTMLElement, actionBar: HTMLElement) => void;
};

type ImageGenerationProgress = {
    percent: number;
    step: number | null;
    total: number | null;
    speed: string | null;
    elapsed: string | null;
};

const normalizeGeneratedCaption = (text: string, translate: ChatTranslate): string => {
    const trimmed = text.trim();
    const readyLabels = new Set([
        translate('ui.chat.image_ready', 'Generated image').trim(),
        'Generated image',
        'Image ready',
        'Изображение готово',
    ]);
    return readyLabels.has(trimmed) ? '' : trimmed;
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
    row.className = 'chat-row bot chat-row--generated-image';

    const bubble = deps.createMessageBubble({});
    bubble.classList.add('chat-image-generation');

    const media = document.createElement('div');
    media.className = 'chat-generated-media hidden';

    const image = document.createElement('img');
    image.className = 'chat-generated-image';
    image.alt = 'Generated preview';
    image.width = 512;
    image.height = 512;
    image.decoding = 'async';
    media.appendChild(image);

    let keepPinnedAfterImageLoad = false;

    const syncMediaSizeToImage = (): void => {
        const naturalWidth = image.naturalWidth;
        const naturalHeight = image.naturalHeight;
        if (naturalWidth <= 0 || naturalHeight <= 0) return;

        media.style.aspectRatio = `${String(naturalWidth)} / ${String(naturalHeight)}`;
        if (keepPinnedAfterImageLoad) {
            deps.scrollToBottom();
            keepPinnedAfterImageLoad = false;
        }
    };
    image.addEventListener('load', syncMediaSizeToImage);

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

    bubble.append(statusRow, progress, caption);
    row.append(media, bubble);
    deps.appendRow(row);
    deps.scrollToBottom();

    let actions: {
        actionBar: HTMLElement;
        copyBtn: HTMLElement;
        editBtn: HTMLElement | null;
    } | null = null;
    let finalImage: ChatImagePayload | null = null;
    let isCancelled = false;

    const detachMediaFromBubble = (): void => {
        if (media.parentElement === bubble) {
            row.insertBefore(media, bubble);
        }
    };

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
        if (!isSafeImageDataUrl(dataUrl)) return;
        if (image.src === dataUrl) return;
        const shouldKeepPinned = deps.isNearBottom();
        keepPinnedAfterImageLoad = shouldKeepPinned;
        detachMediaFromBubble();
        if (media.style.aspectRatio === '') {
            media.style.aspectRatio = '1 / 1';
        }
        image.src = dataUrl;
        syncMediaSizeToImage();
        media.classList.remove('hidden');
        deps.scrollToBottom(!shouldKeepPinned);
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
        if (actions !== null && !row.contains(actions.actionBar)) {
            const target = bubble.classList.contains('has-no-caption') ? media : bubble;
            target.appendChild(actions.actionBar);
            deps.scheduleBubbleImageActions(target, actions.actionBar);
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
            const shouldKeepPinned = deps.isNearBottom();
            finalImage =
                result.images[0] === undefined ? null : normalizeImagePayload(result.images[0]);
            const finalImageDataUrl =
                finalImage === null ? null : buildSafeImageDataUrl(finalImage);
            if (finalImageDataUrl !== null) {
                showPreview(finalImageDataUrl);
            }

            status.textContent = deps.translate('ui.chat.image_ready', 'Generated image');
            progressFill.style.width = '100%';
            progressSummary.textContent = '100%';
            progress.classList.add('is-complete');

            const captionText = normalizeGeneratedCaption(result.text, deps.translate);
            caption.textContent = captionText;
            const hasCaption = captionText !== '';
            caption.classList.toggle('hidden', !hasCaption);
            bubble.classList.toggle('has-caption', hasCaption);
            bubble.classList.toggle('has-no-caption', !hasCaption);

            row.classList.add('is-complete');
            bubble.classList.add('is-complete');
            ensureImageActions(result.text);
            deps.scrollToBottom(!shouldKeepPinned);
        },
        fail: (message: string) => {
            if (isCancelled) {
                return;
            }
            const shouldKeepPinned = deps.isNearBottom();
            bubble.classList.add('chat-error');
            status.textContent = message;
            hideProgress();
            caption.classList.add('hidden');
            deps.scrollToBottom(!shouldKeepPinned);
        },
        cancel: (
            message = deps.translate('ui.chat.image_cancelled', 'Image generation cancelled'),
        ) => {
            const shouldKeepPinned = deps.isNearBottom();
            isCancelled = true;
            bubble.classList.remove('chat-error');
            bubble.classList.add('is-cancelled');
            status.textContent = message;
            hideProgress();
            caption.classList.add('hidden');
            deps.scrollToBottom(!shouldKeepPinned);
        },
        discard: () => {
            row.remove();
        },
    };

    return handle;
}
