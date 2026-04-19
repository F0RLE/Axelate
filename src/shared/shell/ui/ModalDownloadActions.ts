import { ModuleCardRenderer } from './ModuleCardRenderer';
import type { IApp } from '../../types/coreTypes';

type TranslateFunc = (key: string, fallback: string) => string;

export async function cancelModalDownload(options: {
    app: IApp;
    card: HTMLElement | null | undefined;
    button: HTMLButtonElement;
    onCancelDownloadRequest: (app: IApp) => Promise<void>;
    translate: TranslateFunc;
}): Promise<void> {
    await options.onCancelDownloadRequest(options.app);

    if (options.card !== null && options.card !== undefined) {
        ModuleCardRenderer.clearDownloadProgress(options.card);
    }

    resetModalDownloadButton(options.button, options.translate);
}

export function resetModalDownloadButton(
    button: HTMLButtonElement,
    translate: TranslateFunc,
): void {
    const progress = button.querySelector<HTMLElement>('.download-pct');
    if (progress !== null) {
        progress.style.display = 'none';
    }

    const label = button.querySelector<HTMLElement>('.download-label');
    if (label !== null) {
        label.style.display = '';
        label.textContent = translate('ui.launcher.module.download', 'Download');
    }
}
