import type { IApp } from '@/shared/types/coreTypes';

type ModuleCardTranslate = (key: string, fallback: string) => string;

type ModuleCardActionButtonDeps = {
    translate: ModuleCardTranslate;
    getDownloadLabel: () => string;
    getExtractingLabel: () => string;
};

export type ModuleCardDownloadAction = 'start' | 'pause' | 'resume' | 'cancel';

export function buildModuleCardDownloadButton(
    app: IApp,
    deps: ModuleCardActionButtonDeps,
    onDownload?: (app: IApp, action: ModuleCardDownloadAction) => void,
): HTMLButtonElement {
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'modal-btn modal-btn-primary download-btn';
    downloadBtn.style.overflow = 'hidden';
    downloadBtn.style.position = 'relative';
    downloadBtn.dataset['translateExtracting'] = deps.getExtractingLabel();
    downloadBtn.dataset['pauseLabel'] = deps.translate('ui.launcher.button.pause', 'Pause');
    downloadBtn.dataset['resumeLabel'] = deps.translate('ui.launcher.button.resume', 'Resume');
    downloadBtn.dataset['cancelLabel'] = deps.translate('ui.launcher.button.cancel', 'Cancel');

    const content = document.createElement('span');
    content.className = 'btn-content';
    content.style.cssText =
        'display:flex;align-items:center;justify-content:center;gap:6px;position:relative;z-index:2;width:100%;pointer-events:none';

    const label = document.createElement('span');
    label.className = 'download-label';
    label.textContent = deps.getDownloadLabel();

    const pct = document.createElement('span');
    pct.className = 'download-pct';
    pct.style.display = 'none';

    const pauseAction = document.createElement('span');
    pauseAction.className = 'download-hover-action download-hover-action-pause';
    pauseAction.textContent = downloadBtn.dataset['pauseLabel'];

    const cancelAction = document.createElement('span');
    cancelAction.className = 'download-hover-action download-hover-action-cancel';
    cancelAction.textContent = downloadBtn.dataset['cancelLabel'];

    content.appendChild(label);
    content.appendChild(pct);
    downloadBtn.appendChild(content);
    downloadBtn.appendChild(pauseAction);
    downloadBtn.appendChild(cancelAction);

    downloadBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        onDownload?.(app, resolveDownloadButtonAction(downloadBtn, event));
    });

    return downloadBtn;
}

export function resolveDownloadButtonAction(
    button: HTMLButtonElement,
    event: MouseEvent,
): ModuleCardDownloadAction {
    if (!button.classList.contains('downloading')) {
        return 'start';
    }

    const rect = button.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const isLeftHalf = clickX <= rect.width / 2;
    if (!isLeftHalf) {
        return 'cancel';
    }

    return button.dataset['downloadStatus'] === 'paused' ? 'resume' : 'pause';
}

export function buildModuleCardComingSoonButton(translate: ModuleCardTranslate): HTMLButtonElement {
    const button = document.createElement('button');
    const label = translate('ui.launcher.web.coming_soon', 'Coming soon');

    button.className = 'modal-btn modal-btn-secondary';
    button.textContent = label;
    button.disabled = true;
    button.title = label;
    button.setAttribute('aria-disabled', 'true');
    return button;
}

export function buildModuleCardActionButton(
    app: IApp,
    isSelected: boolean,
    translate: ModuleCardTranslate,
    onClick: (e: MouseEvent, app: IApp) => void,
): HTMLButtonElement {
    const actionBtn = document.createElement('button');
    if (isSelected) {
        actionBtn.className = 'modal-btn modal-btn-secondary';
        const i18nKey = 'ui.launcher.modules.modal.btn_remove';
        actionBtn.dataset['i18n'] = i18nKey;
        actionBtn.textContent = translate(i18nKey, 'Remove');
    } else {
        actionBtn.className = 'modal-btn modal-btn-primary';
        const i18nKey = 'ui.launcher.modules.modal.btn_select';
        actionBtn.dataset['i18n'] = i18nKey;
        actionBtn.textContent = translate(i18nKey, 'Select');
    }

    actionBtn.onclick = (event) => {
        event.stopPropagation();
        actionBtn.style.transition = 'transform 0.1s ease';
        actionBtn.style.transform = 'scale(0.92)';
        setTimeout(() => {
            actionBtn.style.transition = 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
            actionBtn.style.transform = '';
        }, 100);

        onClick(event, app);
    };

    return actionBtn;
}
