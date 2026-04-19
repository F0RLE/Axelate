import { ModuleCardRenderer } from './ModuleCardRenderer';

type DownloadProgressPayload = {
    module_id: string;
    status: string;
    progress: number;
};

type ProgressEventHandler = (event: Event) => void;

export function createModalDownloadProgressHandler(): ProgressEventHandler {
    const throttleMap = new Map<string, number>();

    return (event: Event) => {
        const payload = (event as CustomEvent).detail as DownloadProgressPayload;
        if (!payload.module_id) return;

        const now = Date.now();
        const isTerminal =
            payload.status === 'complete' ||
            payload.status === 'error' ||
            payload.status === 'cancelled';

        const lastRender = throttleMap.get(payload.module_id) ?? 0;
        const withinThrottle = isTerminal === false && now - lastRender < 150;
        if (withinThrottle) return;
        throttleMap.set(payload.module_id, now);

        const list = document.getElementById('app-modal-list');
        if (list === null) return;

        const card = list.querySelector<HTMLElement>(`.app-card[data-app-id="${payload.module_id}"]`);
        if (card === null) return;

        if (isTerminal) {
            throttleMap.delete(payload.module_id);
            ModuleCardRenderer.clearDownloadProgress(card);
            if (payload.status === 'complete') {
                card.classList.add('is-installed');
            }
            return;
        }

        const progressPercent = payload.progress < 0 ? -1 : Math.round(payload.progress * 100);
        ModuleCardRenderer.setDownloadProgress(card, progressPercent, payload.status);
    };
}
