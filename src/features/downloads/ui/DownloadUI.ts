/**
 * @module downloader/ui/DownloadUI
 * @description UI management for the downloader module, including progress tracking
 */

import type { DownloadProgress } from '../types/downloaderTypes';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';
import { DownloadCardRenderer } from './DownloadCardRenderer';
import { DownloadProgressPresenter } from './DownloadProgressPresenter';
import { DownloadUiDynamicListController } from './DownloadUiDynamicListController';
import { getDownloadUiElements, type DownloadUiElements } from './DownloadUiDom';
import { DownloadUiTerminalCleanupController } from './DownloadUiTerminalCleanupController';
import { DownloadUiStateController } from './DownloadUiStateController';
import { DownloadUiEventController } from './DownloadUiEventController';

type DownloadUiRuntime = {
    addEventListener: typeof globalThis.addEventListener;
    removeEventListener: typeof globalThis.removeEventListener;
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
};

function createDefaultDownloadUiRuntime(): DownloadUiRuntime {
    return {
        addEventListener: globalThis.addEventListener.bind(globalThis),
        removeEventListener: globalThis.removeEventListener.bind(globalThis),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
}

export class DownloadUI {
    private _boundHandleUpdate: ((e: Event) => void) | null = null;
    private readonly _boundLanguageChanged = () => {
        this._refreshTranslations();
    };
    private readonly _cardRenderer: DownloadCardRenderer;
    private readonly _dynamicListController: DownloadUiDynamicListController;
    private readonly _eventController: DownloadUiEventController;
    private readonly _presenter: DownloadProgressPresenter;
    private readonly _runtime: DownloadUiRuntime;
    private readonly _stateController = new DownloadUiStateController();
    private readonly _terminalCleanupController: DownloadUiTerminalCleanupController;
    private _onCancel: ((moduleId: string) => void) | null = null;
    private _onPause: ((moduleId: string) => void) | null = null;
    private _onResume: ((moduleId: string) => void) | null = null;
    private _initialized = false;

    constructor(
        private readonly _i18n: I18nService,
        runtime: DownloadUiRuntime = createDefaultDownloadUiRuntime(),
    ) {
        this._runtime = runtime;
        this._presenter = new DownloadProgressPresenter(this._createPresenterDeps());
        this._cardRenderer = new DownloadCardRenderer(this._createCardRendererDeps());
        this._dynamicListController = new DownloadUiDynamicListController({
            syncCards: (list, activeDownloads) =>
                this._cardRenderer.syncCards(list, activeDownloads),
        });
        this._terminalCleanupController = new DownloadUiTerminalCleanupController(
            this._runtime,
            (moduleId) => {
                this._stateController.delete(moduleId);
                this._renderDownloadStateList();
            },
        );
        this._eventController = new DownloadUiEventController(this._createEventControllerDeps());
    }

    private _createPresenterDeps(): ConstructorParameters<typeof DownloadProgressPresenter>[0] {
        return {
            translate: (key, fallback) => this._i18n.t(key, fallback),
        };
    }

    private _createCardRendererDeps(): ConstructorParameters<typeof DownloadCardRenderer>[0] {
        return {
            translate: (key, fallback) => this._i18n.t(key, fallback),
            formatBytes: (bytes) => this._formatBytes(bytes),
            formatSpeed: (bytesPerSec) => this._formatSpeed(bytesPerSec),
            displayModuleName: (moduleId) => this._displayModuleName(moduleId),
            statusLabel: (status) => this._statusLabel(status),
            isPausableStatus: (status) => this._presenter.isPausableStatus(status),
            isResumableStatus: (status) => this._presenter.isResumableStatus(status),
            isCancellableStatus: (status) => this._presenter.isCancellableStatus(status),
            onPause: (moduleId) => this._onPause?.(moduleId),
            onResume: (moduleId) => this._onResume?.(moduleId),
            onCancel: (moduleId) => this._onCancel?.(moduleId),
        };
    }

    private _createEventControllerDeps(): ConstructorParameters<
        typeof DownloadUiEventController
    >[0] {
        return {
            clearTerminalCleanup: (moduleId) => this._terminalCleanupController.clear(moduleId),
            scheduleTerminalCleanup: (moduleId, delayMs) =>
                this._terminalCleanupController.schedule(moduleId, delayMs),
            updateState: (moduleId, state) => this._stateController.set(moduleId, state),
            renderState: () => this._renderDownloadStateList(),
            renderProgressFromState: (moduleId, state) => {
                this._renderProgressFromModuleState(moduleId, state);
            },
        };
    }

    /**
     * Sets the cancel callback (injected after construction to avoid circular deps).
     */
    public setOnCancel(cb: (moduleId: string) => void): void {
        this._onCancel = cb;
    }

    /**
     * Sets the pause callback for active downloads.
     */
    public setOnPause(cb: (moduleId: string) => void): void {
        this._onPause = cb;
    }

    /**
     * Sets the resume callback for paused downloads.
     */
    public setOnResume(cb: (moduleId: string) => void): void {
        this._onResume = cb;
    }

    /**
     * Initializes the downloader UI.
     */
    public init(): void {
        if (this._initialized) return;
        this._initialized = true;
        this.bindDownloadProgressEvents();
        this._runtime.addEventListener('language-changed', this._boundLanguageChanged);
    }

    /**
     * Cleans up listeners to prevent memory leaks.
     * MANDATORY cleanup method required by Section 4.3.
     */
    public destroy(): void {
        if (this._boundHandleUpdate) {
            this._runtime.removeEventListener('download-progress-update', this._boundHandleUpdate);
            this._boundHandleUpdate = null;
        }
        this._runtime.removeEventListener('language-changed', this._boundLanguageChanged);
        this._terminalCleanupController.clearAll();
        this._stateController.reset();
        this._initialized = false;
    }

    /**
     * Renders download progress in the UI.
     */
    public renderDownloadsProgress(progress: Partial<DownloadProgress> = {}): void {
        const els = getDownloadUiElements();
        const state = this._presenter.buildProgressState(progress);

        this._applyProgressState(els, state);
    }

    private _applyProgressState(els: DownloadUiElements, state: DownloadProgress): void {
        this._updateDownloadsLayout(els, state.hasActive);
        this._updateEmptyText(els, state.hasActive);
        this._updateProgressVisuals(els, state);
        this._updateStatus(els, state);
        this._updateEta(els, state);
    }

    /**
     * Updates the layout (visibility and classes) of the downloads area.
     */
    private _updateDownloadsLayout(
        els: Pick<
            DownloadUiElements,
            | 'mainCard'
            | 'infoCard'
            | 'downloadsBody'
            | 'downloadsHeader'
            | 'downloadsContainer'
            | 'pageDownloads'
        >,
        hasActive: boolean,
    ): void {
        if (els.mainCard) els.mainCard.classList.toggle('hidden', !hasActive);
        if (els.infoCard) els.infoCard.classList.toggle('hidden', hasActive);
        if (els.downloadsBody) {
            els.downloadsBody.classList.toggle('empty-state', !hasActive);
            els.downloadsBody.classList.remove('hidden');
        }
        if (els.downloadsHeader) {
            els.downloadsHeader.classList.toggle('hidden', hasActive);
            els.downloadsHeader.classList.toggle('full', !hasActive);
        }
        if (els.pageDownloads) els.pageDownloads.classList.toggle('active-download', hasActive);
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
        return this._presenter.formatSpeed(bytesPerSec);
    }

    private _displayModuleName(moduleId: string): string {
        return this._presenter.displayModuleName(moduleId);
    }

    /**
     * Formats bytes in GB, MB, or KB.
     */
    private _formatBytes(bytes: number): string {
        return this._presenter.formatBytes(bytes);
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
        els.etaEl.textContent = this._presenter.etaLabel(state);
    }

    /**
     * Subscribes the downloads view to launcher progress events.
     */
    public bindDownloadProgressEvents(): void {
        if (this._boundHandleUpdate !== null) {
            this._runtime.removeEventListener('download-progress-update', this._boundHandleUpdate);
        }

        this._resetProgressSurface();

        this._dynamicListController.ensureList();
        this.renderDownloadsProgress({ hasActive: false });

        this._boundHandleUpdate = (e: Event) => {
            this._eventController.handleProgressEvent(e);
        };

        this._runtime.addEventListener('download-progress-update', this._boundHandleUpdate);
    }

    private _resetProgressSurface(): void {
        const { mainCard, emptyText } = getDownloadUiElements();
        if (mainCard !== null) mainCard.classList.add('hidden');
        if (emptyText !== null) emptyText.classList.add('hidden');
    }

    private _renderDownloadStateList(): void {
        this._dynamicListController.render(this._stateController.getAll());
    }

    private _renderProgressFromModuleState(moduleId: string, state: ModuleDownloadState): void {
        const progress = this._presenter.buildProgressFromModuleState(moduleId, state);
        progress.hasActive = this._stateController.getAll().size > 0;
        this.renderDownloadsProgress(progress);
    }

    private _refreshTranslations(): void {
        this._renderDownloadStateList();

        const firstEntry = this._stateController.getPrimaryEntry();

        if (firstEntry === undefined) {
            this.renderDownloadsProgress({ hasActive: false });
            return;
        }

        const [moduleId, firstDownload] = firstEntry;

        this.renderDownloadsProgress({
            ...this._presenter.buildProgressFromModuleState(moduleId, firstDownload),
        });
    }

    /**
     * Maps backend status string to a localized label.
     */
    private _statusLabel(status: string): string {
        return this._presenter.statusLabel(status);
    }
}
