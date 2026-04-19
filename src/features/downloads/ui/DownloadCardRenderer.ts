import DOMPurify from 'dompurify';

import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';

type DownloadCardTranslate = (key: string, fallback: string) => string;

type DownloadCardRendererDeps = {
    translate: DownloadCardTranslate;
    formatBytes: (bytes: number) => string;
    formatSpeed: (bytesPerSec: number) => string;
    displayModuleName: (moduleId: string) => string;
    statusLabel: (status: string) => string;
    isActiveStatus: (status: string) => boolean;
    onCancel: (moduleId: string) => void;
};

export class DownloadCardRenderer {
    private static readonly _purifyConfig = {
        ALLOWED_TAGS: ['div', 'span', 'button', 'svg', 'use'],
        ALLOWED_ATTR: ['aria-label', 'class', 'href', 'style', 'title'],
        ALLOW_DATA_ATTR: false,
    };

    constructor(private readonly _deps: DownloadCardRendererDeps) {}

    public syncCards(list: HTMLElement, activeDownloads: Map<string, ModuleDownloadState>): void {
        const existingCards = list.querySelectorAll<HTMLElement>('.download-item-card');
        for (const card of existingCards) {
            const moduleId = card.dataset['moduleId'] ?? '';
            if (!activeDownloads.has(moduleId)) {
                card.remove();
            }
        }

        for (const [moduleId, state] of activeDownloads) {
            const existing = list.querySelector<HTMLElement>(
                `.download-item-card[data-module-id="${moduleId}"]`,
            );
            if (existing !== null) {
                this.patchCard(existing, state);
                continue;
            }

            list.appendChild(this.renderCard(moduleId, state));
        }
    }

    public patchCard(card: HTMLElement, state: ModuleDownloadState): void {
        const pct = state.progress < 0 ? -1 : Math.round(state.progress * 100);
        const pctText = pct < 0 ? '--' : `${String(pct)}%`;

        this.patchProgressBar(card, pct);

        const pctEl = card.querySelector('.downloads-progress-percent');
        if (pctEl) pctEl.textContent = pctText;

        this.patchStatusPill(card, state.status);
        this.patchCardTranslations(card);

        const downloaded = state.downloaded ?? 0;
        const total = state.total ?? 0;
        const speed = state.speed ?? 0;
        const statValues = card.querySelectorAll('.downloads-stat-value');
        if (statValues[0]) statValues[0].textContent = this._deps.formatBytes(downloaded);
        if (statValues[1]) statValues[1].textContent = total > 0 ? this._deps.formatBytes(total) : '--';
        if (statValues[2]) statValues[2].textContent = this._deps.formatSpeed(speed);

        const itemLabel = card.querySelector('.downloads-item-label');
        if (itemLabel !== null) {
            itemLabel.textContent = this._deps.displayModuleName(card.dataset['moduleId'] ?? '');
        }
    }

    public patchCardTranslations(card: HTMLElement): void {
        const progressLabel = card.querySelector('.downloads-progress-label');
        if (progressLabel !== null) {
            progressLabel.textContent = this._deps.translate('ui.launcher.web.progress', 'Progress');
        }

        const downloadedLabel = card.querySelector('.downloads-downloaded-label');
        if (downloadedLabel !== null) {
            downloadedLabel.textContent = this._deps.translate('ui.launcher.web.downloaded', 'Downloaded');
        }

        const totalLabel = card.querySelector('.downloads-total-label');
        if (totalLabel !== null) {
            totalLabel.textContent = this._deps.translate('ui.launcher.web.total', 'Total');
        }

        const speedLabel = card.querySelector('.downloads-speed-label');
        if (speedLabel !== null) {
            speedLabel.textContent = this._deps.translate('ui.launcher.web.speed', 'Speed');
        }

        const cancelBtn = card.querySelector('.download-cancel-btn');
        if (cancelBtn !== null) {
            const cancelText = this._deps.translate('ui.launcher.button.cancel', 'Cancel');
            cancelBtn.setAttribute('title', cancelText);
            cancelBtn.setAttribute('aria-label', cancelText);
        }

        const moduleId = card.dataset['moduleId'] ?? '';
        const itemLabel = card.querySelector('.downloads-item-label');
        if (itemLabel !== null) {
            itemLabel.textContent = this._deps.displayModuleName(moduleId);
        }
    }

    public renderCard(moduleId: string, state: ModuleDownloadState): HTMLElement {
        const card = document.createElement('div');
        card.className = 'downloads-card-main download-item-card';
        card.dataset['moduleId'] = moduleId;

        const pct = state.progress < 0 ? -1 : Math.round(state.progress * 100);
        const pctText = pct < 0 ? '--' : `${String(pct)}%`;
        const downloaded = state.downloaded ?? 0;
        const total = state.total ?? 0;
        const speed = state.speed ?? 0;

        const statusText = this._deps.statusLabel(state.status);
        let statusClass = 'active';
        if (state.status === 'complete') statusClass = 'completed';
        else if (state.status === 'error') statusClass = 'error';

        const isCancellable = this._deps.isActiveStatus(state.status);

        card.innerHTML = DOMPurify.sanitize(
            `
            <div class="downloads-card-header">
                <div class="downloads-meta-section">
                    <div class="downloads-icon-wrapper">
                        <svg class="icon downloads-file-icon"><use href="#icon-folder"></use></svg>
                    </div>
                    <div class="downloads-meta-content">
                        <div class="downloads-label">${moduleId}</div>
                        <div class="downloads-item-label">${this._deps.displayModuleName(moduleId)}</div>
                    </div>
                </div>
                <div class="downloads-card-actions">
                    <div class="downloads-status-pill ${statusClass}">${statusText}</div>
                    ${isCancellable ? `<button class="download-cancel-btn" title="${this._deps.translate('ui.launcher.button.cancel', 'Cancel')}" aria-label="${this._deps.translate('ui.launcher.button.cancel', 'Cancel')}"><span class="stop-square-icon"></span></button>` : ''}
                </div>
            </div>
            <div class="downloads-progress-section">
                <div class="downloads-progress-header">
                    <span class="downloads-progress-label">${this._deps.translate('ui.launcher.web.progress', 'Progress')}</span>
                    <span class="downloads-progress-percent">${pctText}</span>
                </div>
                <div class="downloads-bar-outer">
                    <div class="downloads-bar-inner ${pct < 0 ? 'indeterminate-bar' : ''}" style="width: ${pct < 0 ? '100' : String(Math.min(pct, 100))}%"></div>
                </div>
            </div>
            <div class="downloads-stats-grid">
                <div class="downloads-stat-item">
                    <div class="downloads-stat-label">
                        <svg class="icon icon-sm"><use href="#icon-download"></use></svg>
                        <span class="downloads-downloaded-label">${this._deps.translate('ui.launcher.web.downloaded', 'Downloaded')}</span>
                    </div>
                    <div class="downloads-stat-value">${this._deps.formatBytes(downloaded)}</div>
                </div>
                <div class="downloads-stat-item">
                    <div class="downloads-stat-label">
                        <svg class="icon icon-sm"><use href="#icon-folder"></use></svg>
                        <span class="downloads-total-label">${this._deps.translate('ui.launcher.web.total', 'Total')}</span>
                    </div>
                    <div class="downloads-stat-value">${total > 0 ? this._deps.formatBytes(total) : '--'}</div>
                </div>
                <div class="downloads-stat-item">
                    <div class="downloads-stat-label">
                        <svg class="icon icon-sm"><use href="#icon-network"></use></svg>
                        <span class="downloads-speed-label">${this._deps.translate('ui.launcher.web.speed', 'Speed')}</span>
                    </div>
                    <div class="downloads-stat-value">${this._deps.formatSpeed(speed)}</div>
                </div>
            </div>
        `,
            DownloadCardRenderer._purifyConfig,
        );

        if (isCancellable) {
            const cancelBtn = card.querySelector('.download-cancel-btn');
            cancelBtn?.addEventListener('click', () => {
                this._deps.onCancel(moduleId);
            });
        }

        return card;
    }

    private patchProgressBar(card: HTMLElement, pct: number): void {
        const bar = card.querySelector<HTMLElement>('.downloads-bar-inner');
        if (!bar) return;
        if (pct < 0) {
            bar.classList.add('indeterminate-bar');
            bar.style.width = '100%';
        } else {
            bar.classList.remove('indeterminate-bar');
            bar.style.width = `${String(Math.min(pct, 100))}%`;
        }
    }

    private patchStatusPill(card: HTMLElement, status: string): void {
        const pill = card.querySelector('.downloads-status-pill');
        if (!pill) return;
        pill.textContent = this._deps.statusLabel(status);
        pill.className = 'downloads-status-pill';
        if (status === 'complete') pill.classList.add('completed');
        else if (status === 'error') pill.classList.add('error');
        else pill.classList.add('active');
    }
}
