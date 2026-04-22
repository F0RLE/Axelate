import DOMPurify from 'dompurify';

import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';

type DownloadCardTranslate = (key: string, fallback: string) => string;

type DownloadCardRendererDeps = {
    translate: DownloadCardTranslate;
    formatBytes: (bytes: number) => string;
    formatSpeed: (bytesPerSec: number) => string;
    displayModuleName: (moduleId: string) => string;
    statusLabel: (status: string) => string;
    isPausableStatus: (status: string) => boolean;
    isResumableStatus: (status: string) => boolean;
    isCancellableStatus: (status: string) => boolean;
    onPause: (moduleId: string) => void;
    onResume: (moduleId: string) => void;
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
        const moduleId = card.dataset['moduleId'] ?? '';
        const pct = state.progress < 0 ? -1 : Math.round(state.progress * 100);
        const pctText = pct < 0 ? '--' : `${String(pct)}%`;

        this.patchProgressBar(card, pct);

        const pctEl = card.querySelector('.downloads-progress-percent');
        if (pctEl !== null) {
            pctEl.textContent = pctText;
        }

        this.patchCardTranslations(card);
        this.patchActionArea(card, moduleId, state.status);

        const moduleCode = card.querySelector('.downloads-label');
        if (moduleCode !== null) {
            moduleCode.textContent = moduleId.toUpperCase();
        }

        const downloaded = state.downloaded ?? 0;
        const total = state.total ?? 0;
        const speed = state.speed ?? 0;
        const statValues = card.querySelectorAll('.downloads-stat-value');
        if (statValues[0]) statValues[0].textContent = this._deps.formatBytes(downloaded);
        if (statValues[1]) {
            statValues[1].textContent = total > 0 ? this._deps.formatBytes(total) : '--';
        }
        if (statValues[2]) statValues[2].textContent = this._deps.formatSpeed(speed);

        const itemLabel = card.querySelector('.downloads-item-label');
        if (itemLabel !== null) {
            itemLabel.textContent = this._deps.displayModuleName(moduleId);
        }
    }

    public patchCardTranslations(card: HTMLElement): void {
        const progressLabel = card.querySelector('.downloads-progress-label');
        if (progressLabel !== null) {
            progressLabel.textContent = this._deps.translate(
                'ui.launcher.web.progress',
                'Progress',
            );
        }

        const downloadedLabel = card.querySelector('.downloads-downloaded-label');
        if (downloadedLabel !== null) {
            downloadedLabel.textContent = this._deps.translate(
                'ui.launcher.web.downloaded',
                'Downloaded',
            );
        }

        const totalLabel = card.querySelector('.downloads-total-label');
        if (totalLabel !== null) {
            totalLabel.textContent = this._deps.translate('ui.launcher.web.total', 'Total');
        }

        const speedLabel = card.querySelector('.downloads-speed-label');
        if (speedLabel !== null) {
            speedLabel.textContent = this._deps.translate('ui.launcher.web.speed', 'Speed');
        }

        const moduleId = card.dataset['moduleId'] ?? '';
        const itemLabel = card.querySelector('.downloads-item-label');
        if (itemLabel !== null) {
            itemLabel.textContent = this._deps.displayModuleName(moduleId);
        }
    }

    public renderCard(moduleId: string, state: ModuleDownloadState): HTMLElement {
        const card = document.createElement('div');
        card.className = 'downloads-card-main launcher-glass-panel download-item-card';
        card.dataset['moduleId'] = moduleId;

        const pct = state.progress < 0 ? -1 : Math.round(state.progress * 100);
        const pctText = pct < 0 ? '--' : `${String(pct)}%`;
        const downloaded = state.downloaded ?? 0;
        const total = state.total ?? 0;
        const speed = state.speed ?? 0;

        card.innerHTML = DOMPurify.sanitize(
            `
            <div class="downloads-card-header">
                <div class="downloads-meta-section">
                    <div class="downloads-icon-wrapper">
                        <svg class="icon downloads-file-icon"><use href="#icon-folder"></use></svg>
                    </div>
                    <div class="downloads-meta-content">
                        <div class="downloads-label">${moduleId.toUpperCase()}</div>
                        <div class="downloads-item-label">${this._deps.displayModuleName(moduleId)}</div>
                    </div>
                </div>
                <div class="downloads-card-actions">
                    ${this.renderActionArea(state.status)}
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

        this.bindActionButtons(card, moduleId, state.status);
        return card;
    }

    private patchActionArea(card: HTMLElement, moduleId: string, status: string): void {
        const actionArea = card.querySelector<HTMLElement>('.downloads-card-actions');
        if (actionArea === null) {
            return;
        }

        actionArea.innerHTML = DOMPurify.sanitize(
            this.renderActionArea(status),
            DownloadCardRenderer._purifyConfig,
        );
        this.bindActionButtons(card, moduleId, status);
    }

    private renderActionArea(status: string): string {
        const buttons: string[] = [];
        const pauseTitle = this._deps.translate('ui.launcher.button.pause', 'Pause');
        const resumeTitle = this._deps.translate('ui.launcher.button.resume', 'Resume');
        const cancelTitle = this._deps.translate('ui.launcher.button.cancel', 'Cancel');

        if (this._deps.isPausableStatus(status)) {
            buttons.push(
                this.renderActionButton('download-pause-btn pause', pauseTitle, '#icon-pause'),
            );
        }
        if (this._deps.isResumableStatus(status)) {
            buttons.push(
                this.renderActionButton('download-resume-btn resume', resumeTitle, '#icon-start'),
            );
        }
        if (this._deps.isCancellableStatus(status)) {
            buttons.push(
                this.renderActionButton('download-cancel-btn cancel', cancelTitle, '#icon-stop'),
            );
        }

        const controls =
            buttons.length > 0
                ? `<div class="downloads-control-group">${buttons.join('')}</div>`
                : '';

        return `
            <div class="downloads-status-pill ${this.statusClass(status)}">${this._deps.statusLabel(status)}</div>
            ${controls}
        `;
    }

    private renderActionButton(className: string, title: string, iconHref: string): string {
        return `
            <button class="downloads-action-btn ${className}" title="${title}" aria-label="${title}">
                <svg class="icon downloads-action-icon"><use href="${iconHref}"></use></svg>
            </button>
        `;
    }

    private bindActionButtons(card: HTMLElement, moduleId: string, status: string): void {
        if (this._deps.isPausableStatus(status)) {
            card.querySelector('.download-pause-btn')?.addEventListener('click', () => {
                this._deps.onPause(moduleId);
            });
        }

        if (this._deps.isResumableStatus(status)) {
            card.querySelector('.download-resume-btn')?.addEventListener('click', () => {
                this._deps.onResume(moduleId);
            });
        }

        if (this._deps.isCancellableStatus(status)) {
            card.querySelector('.download-cancel-btn')?.addEventListener('click', () => {
                this._deps.onCancel(moduleId);
            });
        }
    }

    private patchProgressBar(card: HTMLElement, pct: number): void {
        const bar = card.querySelector<HTMLElement>('.downloads-bar-inner');
        if (bar === null) return;

        if (pct < 0) {
            bar.classList.add('indeterminate-bar');
            bar.style.width = '100%';
            return;
        }

        bar.classList.remove('indeterminate-bar');
        bar.style.width = `${String(Math.min(pct, 100))}%`;
    }

    private statusClass(status: string): string {
        switch (status) {
            case 'downloading':
                return 'active';
            case 'connecting':
                return 'processing';
            case 'paused':
                return 'paused';
            case 'verifying':
            case 'extracting':
                return 'processing';
            case 'complete':
                return 'completed';
            case 'error':
                return 'error';
            case 'cancelled':
                return 'cancelled';
            default:
                return 'waiting';
        }
    }
}
