export function setModuleCardDownloadProgress(
    card: HTMLElement,
    percent: number,
    status?: string,
): void {
    const btn = card.querySelector<HTMLButtonElement>('.download-btn');
    if (btn === null) return;

    btn.classList.add('downloading');
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
        const cardEl = label.closest<HTMLElement>('.app-card');
        const extractingLabel = (cardEl?.dataset['translateExtracting'] ?? 'Extracting').replace(
            /\.+$/,
            '',
        );
        const targetText = status === 'extracting' ? extractingLabel : '';
        if (label.textContent !== targetText) {
            label.textContent = targetText;
        }
    }
}

export function clearModuleCardDownloadProgress(card: HTMLElement): void {
    const btn = card.querySelector<HTMLButtonElement>('.download-btn');
    if (btn === null) return;
    btn.classList.remove('downloading', 'indeterminate');
    btn.style.removeProperty('--download-progress');
}
