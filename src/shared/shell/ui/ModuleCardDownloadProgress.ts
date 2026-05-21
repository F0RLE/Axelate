export function setModuleCardDownloadProgress(
    card: HTMLElement,
    percent: number,
    status?: string,
): void {
    const btn = card.querySelector<HTMLButtonElement>('.download-btn');
    if (btn === null) return;

    btn.classList.add('downloading');
    btn.dataset['downloadStatus'] = status ?? 'downloading';
    btn.style.overflow = 'hidden';

    const isIndeterminate = percent < 0 || status === 'connecting' || status === 'pending';
    if (isIndeterminate) {
        btn.classList.add('indeterminate');
        btn.style.removeProperty('--download-progress');
    } else {
        btn.classList.remove('indeterminate');
        btn.style.setProperty('--download-progress', `${Math.min(100, percent).toFixed(1)}%`);
    }

    const pct = btn.querySelector<HTMLElement>('.download-pct');
    if (pct) {
        pct.style.display = '';
        const displayPercent = percent < 0 ? 0 : Math.round(percent);
        pct.textContent = `${displayPercent}%`;
    }

    const label = btn.querySelector<HTMLElement>('.download-label');
    if (label) {
        const extractingLabel = (btn.dataset['translateExtracting'] ?? 'Extracting').replace(
            /\.+$/,
            '',
        );
        const targetText = status === 'extracting' ? extractingLabel : '';
        if (label.textContent !== targetText) {
            label.textContent = targetText;
        }
    }

    const pauseAction = btn.querySelector<HTMLElement>('.download-hover-action-pause');
    if (pauseAction !== null) {
        pauseAction.textContent =
            status === 'paused'
                ? (btn.dataset['resumeLabel'] ?? 'Resume')
                : (btn.dataset['pauseLabel'] ?? 'Pause');
    }
}

export function clearModuleCardDownloadProgress(card: HTMLElement): void {
    const btn = card.querySelector<HTMLButtonElement>('.download-btn');
    if (btn === null) return;
    btn.classList.remove('downloading', 'indeterminate');
    delete btn.dataset['downloadStatus'];
    btn.style.removeProperty('--download-progress');
}

export function markModuleCardDownloadPaused(btn: HTMLElement): void {
    btn.dataset['downloadStatus'] = 'paused';
    const pauseAction = btn.querySelector<HTMLElement>('.download-hover-action-pause');
    if (pauseAction !== null) {
        pauseAction.textContent = btn.dataset['resumeLabel'] ?? 'Resume';
    }
}

export function markModuleCardDownloadResuming(btn: HTMLElement): void {
    btn.dataset['downloadStatus'] = 'downloading';
    const pauseAction = btn.querySelector<HTMLElement>('.download-hover-action-pause');
    if (pauseAction !== null) {
        pauseAction.textContent = btn.dataset['pauseLabel'] ?? 'Pause';
    }
}
