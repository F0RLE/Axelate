/**
 * @module downloader/ui/DownloadUI
 * @description UI management for the downloader module, including progress tracking and settings
 */

import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';
import type { DownloadProgress, DownloadSettings } from '../types/downloaderTypes';
import type { DownloadSettingsService } from '@/shared/services/downloads/DownloadSettingsService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';

export class DownloadUI {
    private _settings: DownloadSettings = {
        limitEnabled: false,
        maxSpeed: 50,
    };

    private static readonly SELECTORS = {
        PROGRESS_BAR: 'downloads-progress-bar',
        PROGRESS_TEXT: 'downloads-progress-text',
        SPEED: 'downloads-speed',
        DOWNLOADED: 'downloads-downloaded',
        TOTAL: 'downloads-total',
        ITEM_LABEL: 'downloads-item-label',
        STATUS: 'downloads-status',
        ETA: 'downloads-eta',
        MAIN_CARD: 'downloads-main-card',
        EMPTY_TEXT: 'downloads-empty-text',
        BODY: 'downloads-body',
        HEADER: '.downloads-header',
        CONTAINER: 'downloads-container',
        OVERLAY: 'download-settings-overlay',
        TOGGLE: 'download-speed-limit-toggle',
        SLIDER: 'download-speed-slider',
        SPEED_VALUE: 'speed-limit-value',
        SPEED_CONTROLS: 'speed-limit-controls',
        MODEL_DOWNLOAD_MODAL: 'model-download-modal',
        MODEL_NAME: 'download-model-name',
        MODAL_PROGRESS_BAR: 'download-progress-bar',
        MODAL_PROGRESS_TEXT: 'download-progress-text',
        MODAL_SPEED: 'download-speed-text',
        MODAL_DOWNLOADED: 'download-downloaded',
        MODAL_TOTAL: 'download-total',
        SD_MODEL_URL_FIELD: 'field-sd-model-url',
        DYNAMIC_LIST: 'downloads-dynamic-list',
    };

    private _boundHandleUpdate: ((e: Event) => void) | null = null;
    /** Tracks active downloads keyed by module_id */
    private readonly _activeDownloads = new Map<string, ModuleDownloadState>();
    private _onCancel: ((moduleId: string) => void) | null = null;

    constructor(
        private readonly _downloadSettings: DownloadSettingsService,
        private readonly _i18n: I18nService,
        private readonly _navigation: NavigationService,
    ) {
        this.loadSettings();
    }

    /**
     * Sets the cancel callback (injected after construction to avoid circular deps).
     */
    public setOnCancel(cb: (moduleId: string) => void): void {
        this._onCancel = cb;
    }

    /**
     * Initializes the downloader UI.
     */
    public init(): void {
        this.startDownloadsPolling();
        this._initSettingsListeners();
    }

    /**
     * Cleans up listeners to prevent memory leaks.
     * MANDATORY cleanup method required by Section 4.3.
     */
    public destroy(): void {
        if (this._boundHandleUpdate) {
            globalThis.removeEventListener('download-progress-update', this._boundHandleUpdate);
            this._boundHandleUpdate = null;
        }
    }

    /**
     * Gets DOM elements for download progress display.
     */
    private _getElements() {
        return {
            bar: document.getElementById(DownloadUI.SELECTORS.PROGRESS_BAR),
            text: document.getElementById(DownloadUI.SELECTORS.PROGRESS_TEXT),
            speedEl: document.getElementById(DownloadUI.SELECTORS.SPEED),
            downloadedEl: document.getElementById(DownloadUI.SELECTORS.DOWNLOADED),
            totalEl: document.getElementById(DownloadUI.SELECTORS.TOTAL),
            labelEl: document.getElementById(DownloadUI.SELECTORS.ITEM_LABEL),
            statusEl: document.getElementById(DownloadUI.SELECTORS.STATUS),
            etaEl: document.getElementById(DownloadUI.SELECTORS.ETA),
            mainCard: document.getElementById(DownloadUI.SELECTORS.MAIN_CARD),
            emptyText: document.getElementById(DownloadUI.SELECTORS.EMPTY_TEXT),
            downloadsBody: document.getElementById(DownloadUI.SELECTORS.BODY),
            downloadsHeader: document.querySelector<HTMLElement>(DownloadUI.SELECTORS.HEADER),
            downloadsContainer: document.getElementById(DownloadUI.SELECTORS.CONTAINER),
        };
    }

    /**
     * Renders download progress in the UI.
     */
    public renderDownloadsProgress(progress: Partial<DownloadProgress> = {}): void {
        const els = this._getElements();
        const state = this._parseProgressState(progress);

        this._updateDownloadsLayout(els, state.hasActive);
        this._updateEmptyText(els, state.hasActive);
        this._updateProgressVisuals(els, state);
        this._updateStatus(els, state);
        this._updateEta(els, state);
    }

    /**
     * Parses a raw progress payload into a normalized DownloadProgress object.
     */
    private _parseProgressState(progress: Partial<DownloadProgress>): DownloadProgress {
        const percent = progress.percent ?? 0;
        const downloaded = progress.downloaded ?? 0;
        const total = progress.total ?? 0;
        const speed = progress.speed ?? 0;
        const completed = progress.completed === true;
        const error = progress.error ?? null;
        const label = progress.label ?? '';

        const hasActive =
            (progress.hasActive ?? false) ||
            ((percent > 0 || downloaded > 0) &&
                !completed &&
                error === null &&
                total > 0 &&
                label.trim() !== '') ||
            (completed && label.trim() !== '');

        return { percent, downloaded, total, speed, completed, error, label, hasActive };
    }

    /**
     * Updates the layout (visibility and classes) of the downloads area.
     */
    private _updateDownloadsLayout(
        els: {
            mainCard: HTMLElement | null;
            downloadsBody: HTMLElement | null;
            downloadsHeader: HTMLElement | null;
            downloadsContainer: HTMLElement | null;
        },
        hasActive: boolean,
    ): void {
        if (els.mainCard) els.mainCard.classList.toggle('hidden', !hasActive);
        if (els.downloadsBody) els.downloadsBody.classList.toggle('empty-state', !hasActive);
        if (els.downloadsHeader) {
            els.downloadsHeader.classList.toggle('compact', hasActive);
            els.downloadsHeader.classList.toggle('full', !hasActive);
        }
        if (els.downloadsContainer)
            els.downloadsContainer.classList.toggle('active-download', hasActive);
    }

    /**
     * Updates the empty state text visibility.
     */
    private _updateEmptyText(els: { emptyText: HTMLElement | null }, hasActive: boolean): void {
        if (els.emptyText) els.emptyText.classList.toggle('hidden', hasActive);
    }

    /**
     * Updates the progress bar and labels.
     */
    private _updateProgressVisuals(
        els: {
            bar: HTMLElement | null;
            text: HTMLElement | null;
            speedEl: HTMLElement | null;
            downloadedEl: HTMLElement | null;
            totalEl: HTMLElement | null;
            labelEl: HTMLElement | null;
        },
        state: DownloadProgress,
    ): void {
        const { percent, speed, downloaded, total, label, hasActive } = state;

        if (percent < 0) {
            if (els.bar) {
                els.bar.style.width = '100%';
                els.bar.classList.add('indeterminate-bar');
            }
            if (els.text) els.text.textContent = '--%';
        } else {
            if (els.bar) {
                els.bar.style.width = `${String(Math.min(percent, 100))}%`;
                els.bar.classList.remove('indeterminate-bar');
            }
            if (els.text) els.text.textContent = `${percent.toFixed(1)}%`;
        }

        this._updateMetaStats(els, speed, downloaded, total);
        this._updateLabel(els.labelEl, label, hasActive);
    }

    private _updateMetaStats(
        els: {
            speedEl: HTMLElement | null;
            downloadedEl: HTMLElement | null;
            totalEl: HTMLElement | null;
        },
        speed: number,
        downloaded: number,
        total: number,
    ): void {
        if (els.speedEl) els.speedEl.textContent = this._formatSpeed(speed);
        if (els.downloadedEl) els.downloadedEl.textContent = this._formatBytes(downloaded);
        if (els.totalEl) els.totalEl.textContent = total > 0 ? this._formatBytes(total) : '--';
    }

    private _updateLabel(el: HTMLElement | null, label: string, hasActive: boolean): void {
        if (!el) return;
        const fallback = this._i18n.t('ui.downloads.no_active', 'No active downloads');

        let text = label;
        if (!hasActive) {
            if (label === '') {
                text = fallback;
            } else {
                text = label;
            }
        }
        el.textContent = text;
        el.title = label;
    }

    /**
     * Formats speed in MB/s or KB/s.
     */
    private _formatSpeed(bytesPerSec: number): string {
        if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
        if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
        return `${bytesPerSec.toFixed(0)} B/s`;
    }

    /**
     * Formats bytes in GB, MB, or KB.
     */
    private _formatBytes(bytes: number): string {
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes.toFixed(0)} B`;
    }

    /**
     * Updates the download status label.
     */
    private _updateStatus(els: { statusEl: HTMLElement | null }, state: DownloadProgress): void {
        if (!els.statusEl) return;
        const { completed, error, hasActive } = state;

        els.statusEl.classList.remove('active', 'completed', 'error');
        if (completed) {
            els.statusEl.textContent = this._i18n.t('ui.downloads.status.completed', 'Completed');
            els.statusEl.classList.add('completed');
        } else if (error !== null) {
            els.statusEl.textContent = this._i18n.t('ui.downloads.status.error', 'Error');
            els.statusEl.classList.add('error');
        } else if (hasActive) {
            els.statusEl.textContent = this._i18n.t(
                'ui.downloads.status.in_progress',
                'In Progress',
            );
            els.statusEl.classList.add('active');
        } else {
            els.statusEl.textContent = this._i18n.t('ui.downloads.status.waiting', 'Waiting');
        }
    }

    /**
     * Updates the ETA label.
     */
    private _updateEta(els: { etaEl: HTMLElement | null }, state: DownloadProgress): void {
        if (!els.etaEl) return;
        const { completed, error, speed, total, downloaded } = state;

        if (completed) {
            els.etaEl.textContent = this._i18n.t('ui.downloads.status.ready', 'Ready');
        } else if (error !== null) {
            els.etaEl.textContent = error;
        } else if (speed > 0 && total > 0) {
            const remainingBytes = Math.max(total - downloaded, 0);
            const seconds = remainingBytes / speed;
            const s = this._i18n.t('ui.common.time.s', 's');
            const m = this._i18n.t('ui.common.time.m', 'm');

            if (seconds < 60) {
                els.etaEl.textContent = `${Math.floor(seconds).toString()}${s}`;
            } else {
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                els.etaEl.textContent = `${mins.toString()}${m} ${secs.toString()}${s}`;
            }
        } else {
            els.etaEl.textContent = '--';
        }
    }

    /**
     * Initializes polling for download progress (legacy).
     */
    public startDownloadsPolling(): void {
        const mainCard = document.getElementById(DownloadUI.SELECTORS.MAIN_CARD);
        const emptyText = document.getElementById(DownloadUI.SELECTORS.EMPTY_TEXT);
        if (mainCard !== null) mainCard.classList.add('hidden');
        if (emptyText !== null) emptyText.classList.remove('hidden');

        // Ensure the dynamic list container exists
        this._ensureDynamicList();

        this._boundHandleUpdate = (e: Event) => {
            const payload = (e as CustomEvent).detail as ModuleDownloadState & {
                module_id?: string;
            };
            const moduleId = payload.module_id ?? '';
            if (moduleId === '') return;

            // Update active downloads map
            if (
                payload.status === 'complete' ||
                payload.status === 'error' ||
                (payload.status as string) === 'cancelled'
            ) {
                // Remove after a short delay so the user sees the final state
                setTimeout(() => {
                    this._activeDownloads.delete(moduleId);
                    this._renderDynamicList();
                }, 2000);
                // Still update with terminal state briefly
                this._activeDownloads.set(moduleId, payload);
            } else {
                this._activeDownloads.set(moduleId, payload);
            }

            this._renderDynamicList();

            // Also update legacy single-card UI for backward compat
            this.renderDownloadsProgress({
                percent: payload.progress * 100,
                downloaded: payload.downloaded ?? 0,
                total: payload.total ?? 0,
                label: payload.message ?? moduleId,
                hasActive:
                    payload.status === 'downloading' ||
                    payload.status === 'connecting' ||
                    payload.status === 'extracting',
                completed: payload.status === 'complete',
                error:
                    payload.status === 'error'
                        ? (payload.error as string) || 'Unknown error'
                        : null,
            });
        };

        globalThis.addEventListener('download-progress-update', this._boundHandleUpdate);
    }

    /**
     * Loads download settings from UI state.
     */
    public loadSettings(): void {
        this._settings = this._downloadSettings.getDownloadSettings();
    }

    /**
     * Saves download settings to UI state.
     */
    public saveSettings(): void {
        const toggle = document.getElementById(
            DownloadUI.SELECTORS.TOGGLE,
        ) as HTMLInputElement | null;
        const slider = document.getElementById(
            DownloadUI.SELECTORS.SLIDER,
        ) as HTMLInputElement | null;
        const controls = document.getElementById(DownloadUI.SELECTORS.SPEED_CONTROLS);

        if (toggle instanceof HTMLInputElement && slider instanceof HTMLInputElement) {
            this._settings.limitEnabled = toggle.checked;
            this._settings.maxSpeed = Number.parseInt(slider.value, 10);

            if (controls instanceof HTMLElement) {
                controls.classList.add(this._settings.limitEnabled ? 'opacity-50' : 'opacity-100');
            }

            toggle.style.background = toggle.checked ? 'var(--primary)' : 'var(--bg-light)';

            this._downloadSettings.setDownloadSettings(
                this._settings.limitEnabled,
                this._settings.maxSpeed,
            );
        }
    }

    /**
     * Updates the custom speed display label.
     */
    public updateSpeedDisplay(value: string | number): void {
        const display = document.getElementById(DownloadUI.SELECTORS.SPEED_VALUE);
        const slider = document.getElementById(
            DownloadUI.SELECTORS.SLIDER,
        ) as HTMLInputElement | null;
        if (display !== null) display.textContent = value.toString();

        if (slider !== null) {
            const val = typeof value === 'string' ? Number.parseInt(value, 10) : value;
            const percent = ((val - 1) / (200 - 1)) * 100;
            slider.style.background = `linear-gradient(to right, var(--primary) ${percent.toString()}%, var(--bg-light) ${percent.toString()}%)`;
        }
    }

    /**
     * Opens the download settings overlay.
     */
    public openSettings(): void {
        this.loadSettings();
        const overlay = document.getElementById(
            DownloadUI.SELECTORS.OVERLAY,
        ) as HTMLDialogElement | null;
        const toggle = document.getElementById(
            DownloadUI.SELECTORS.TOGGLE,
        ) as HTMLInputElement | null;
        const slider = document.getElementById(
            DownloadUI.SELECTORS.SLIDER,
        ) as HTMLInputElement | null;
        const controls = document.getElementById(DownloadUI.SELECTORS.SPEED_CONTROLS);

        if (toggle !== null) {
            toggle.checked = this._settings.limitEnabled;
            toggle.style.background = toggle.checked ? 'var(--primary)' : 'var(--bg-light)';
        }
        if (slider !== null) {
            slider.value = this._settings.maxSpeed.toString();
            this.updateSpeedDisplay(this._settings.maxSpeed);
        }
        if (controls !== null) {
            controls.style.opacity = this._settings.limitEnabled ? '1' : '0.5';
            controls.style.pointerEvents = this._settings.limitEnabled ? 'auto' : 'none';
        }
        if (overlay) {
            this._navigation.pushBackAction(
                'download-settings-overlay',
                () => {
                    this.closeSettings();
                },
                () => {
                    this.openSettings();
                },
            );
            overlay.showModal();
        }
    }

    /**
     * Closes the download settings overlay.
     */
    public closeSettings(): void {
        this._navigation.removeBackAction('download-settings-overlay');
        const overlay = document.getElementById(
            DownloadUI.SELECTORS.OVERLAY,
        ) as HTMLDialogElement | null;
        if (overlay?.open === true) overlay.close();
    }

    /**
     * Binds native setting input listeners.
     */
    private _initSettingsListeners(): void {
        const toggle = document.getElementById(DownloadUI.SELECTORS.TOGGLE);
        const slider = document.getElementById(DownloadUI.SELECTORS.SLIDER);

        toggle?.addEventListener('change', () => {
            this.saveSettings();
        });
        slider?.addEventListener('input', (e) => {
            const val = (e.target as HTMLInputElement).value;
            this.updateSpeedDisplay(val);
            this.saveSettings();
        });
    }

    /**
     * Hides the model download modal.
     */
    public hideModelDownloadModal(): void {
        const modal = document.getElementById(DownloadUI.SELECTORS.MODEL_DOWNLOAD_MODAL);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('show');
        }
    }

    // ─── Dynamic Multi-Download List ───────────────────────────

    /**
     * Creates the dynamic list container inside the downloads body if it doesn't already exist.
     */
    private _ensureDynamicList(): void {
        if (document.getElementById(DownloadUI.SELECTORS.DYNAMIC_LIST)) return;

        const body = document.getElementById(DownloadUI.SELECTORS.BODY);
        if (!body) return;

        const list = document.createElement('div');
        list.id = DownloadUI.SELECTORS.DYNAMIC_LIST;
        list.className = 'downloads-dynamic-list';
        body.prepend(list);
    }

    /**
     * Patches the dynamic download list in-place — avoids re-creating
     * the entire DOM on every progress tick so cards don't flash.
     */
    private _renderDynamicList(): void {
        const list = document.getElementById(DownloadUI.SELECTORS.DYNAMIC_LIST);
        if (!list) return;

        const emptyText = document.getElementById(DownloadUI.SELECTORS.EMPTY_TEXT);
        const mainCard = document.getElementById(DownloadUI.SELECTORS.MAIN_CARD);

        if (this._activeDownloads.size === 0) {
            list.innerHTML = '';
            if (emptyText) emptyText.classList.remove('hidden');
            if (mainCard) mainCard.style.display = 'none';
            return;
        }

        // Hide empty text and legacy card when dynamic list is shown
        if (emptyText) emptyText.classList.add('hidden');
        if (mainCard) mainCard.style.display = 'none';

        // Remove cards whose downloads are no longer tracked
        const existingCards = list.querySelectorAll<HTMLElement>('.download-item-card');
        for (const card of existingCards) {
            const mid: string = card.dataset['moduleId'] ?? '';
            if (!this._activeDownloads.has(mid)) {
                card.remove();
            }
        }

        // Add or update cards
        for (const [moduleId, state] of this._activeDownloads) {
            const existing = list.querySelector<HTMLElement>(
                `.download-item-card[data-module-id="${moduleId}"]`,
            );
            if (existing) {
                this._patchCard(existing, state);
            } else {
                list.appendChild(this._renderSingleCard(moduleId, state));
            }
        }
    }

    /**
     * Updates an existing card's dynamic content without recreating it.
     */
    private _patchCard(card: HTMLElement, state: ModuleDownloadState): void {
        const pct = state.progress < 0 ? -1 : Math.round(state.progress * 100);
        const pctText = pct < 0 ? '--' : `${String(pct)}%`;

        this._patchProgressBar(card, pct);

        const pctEl = card.querySelector('.downloads-progress-percent');
        if (pctEl) pctEl.textContent = pctText;

        this._patchStatusPill(card, state.status);

        // Stats
        const downloaded = state.downloaded ?? 0;
        const total = state.total ?? 0;
        const statValues = card.querySelectorAll('.downloads-stat-value');
        if (statValues[0]) statValues[0].textContent = this._formatBytes(downloaded);
        if (statValues[1]) statValues[1].textContent = total > 0 ? this._formatBytes(total) : '--';

        // Message
        const itemLabel = card.querySelector('.downloads-item-label');
        if (itemLabel !== null && state.message !== undefined && state.message !== '') {
            itemLabel.textContent = state.message;
        }
    }

    private _patchProgressBar(card: HTMLElement, pct: number): void {
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

    private _patchStatusPill(card: HTMLElement, status: string): void {
        const pill = card.querySelector('.downloads-status-pill');
        if (!pill) return;
        pill.textContent = this._statusLabel(status);
        pill.className = 'downloads-status-pill';
        if (status === 'complete') pill.classList.add('completed');
        else if (status === 'error') pill.classList.add('error');
        else pill.classList.add('active');
    }

    /**
     * Creates a single download card element.
     */
    private _renderSingleCard(moduleId: string, state: ModuleDownloadState): HTMLElement {
        const card = document.createElement('div');
        card.className = 'downloads-card-main download-item-card';
        card.dataset['moduleId'] = moduleId;

        const pct = state.progress < 0 ? -1 : Math.round(state.progress * 100);
        const pctText = pct < 0 ? '--' : `${String(pct)}%`;
        const downloaded = state.downloaded ?? 0;
        const total = state.total ?? 0;
        const speed = 0; // Speed is not tracked per-module in current state, left for future

        const statusText = this._statusLabel(state.status);
        let statusClass = 'active';
        if (state.status === 'complete') statusClass = 'completed';
        else if (state.status === 'error') statusClass = 'error';

        const isCancellable =
            state.status === 'downloading' ||
            state.status === 'connecting' ||
            state.status === 'extracting';

        card.innerHTML = `
            <div class="downloads-card-header">
                <div class="downloads-meta-section">
                    <div class="downloads-icon-wrapper">
                        <svg class="icon downloads-file-icon"><use href="#icon-folder"></use></svg>
                    </div>
                    <div class="downloads-meta-content">
                        <div class="downloads-label">${moduleId}</div>
                        <div class="downloads-item-label">${state.message ?? moduleId}</div>
                    </div>
                </div>
                <div class="downloads-card-actions">
                    <div class="downloads-status-pill ${statusClass}">${statusText}</div>
                    ${isCancellable ? '<button class="download-cancel-btn" title="Cancel"><span class="stop-square-icon"></span></button>' : ''}
                </div>
            </div>
            <div class="downloads-progress-section">
                <div class="downloads-progress-header">
                    <span class="downloads-progress-label">${this._i18n.t('ui.launcher.web.progress', 'Progress')}</span>
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
                        <span>${this._i18n.t('ui.launcher.web.downloaded', 'Downloaded')}</span>
                    </div>
                    <div class="downloads-stat-value">${this._formatBytes(downloaded)}</div>
                </div>
                <div class="downloads-stat-item">
                    <div class="downloads-stat-label">
                        <svg class="icon icon-sm"><use href="#icon-folder"></use></svg>
                        <span>${this._i18n.t('ui.launcher.web.total', 'Total')}</span>
                    </div>
                    <div class="downloads-stat-value">${total > 0 ? this._formatBytes(total) : '--'}</div>
                </div>
                <div class="downloads-stat-item">
                    <div class="downloads-stat-label">
                        <svg class="icon icon-sm"><use href="#icon-network"></use></svg>
                        <span>${this._i18n.t('ui.launcher.web.speed', 'Speed')}</span>
                    </div>
                    <div class="downloads-stat-value">${this._formatSpeed(speed)}</div>
                </div>
            </div>
        `;

        // Wire cancel button
        if (isCancellable) {
            const cancelBtn = card.querySelector('.download-cancel-btn');
            cancelBtn?.addEventListener('click', () => {
                this._onCancel?.(moduleId);
            });
        }

        return card;
    }

    /**
     * Maps backend status string to a localized label.
     */
    private _statusLabel(status: string): string {
        switch (status) {
            case 'connecting':
                return this._i18n.t('ui.downloads.status.connecting', 'Connecting');
            case 'downloading':
                return this._i18n.t('ui.downloads.status.in_progress', 'Downloading');
            case 'extracting':
                return this._i18n.t('ui.downloads.status.extracting', 'Extracting');
            case 'complete':
                return this._i18n.t('ui.downloads.status.completed', 'Completed');
            case 'error':
                return this._i18n.t('ui.downloads.status.error', 'Error');
            case 'cancelled':
                return this._i18n.t('ui.downloads.status.cancelled', 'Cancelled');
            default:
                return this._i18n.t('ui.downloads.status.waiting', 'Waiting');
        }
    }
}
