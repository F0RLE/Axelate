import type { IApp } from '../types/coreTypes';
import type { TGlobalWin } from '../types/global_bridge_types';
import DOMPurify from 'dompurify';
import { eventBus } from '../services/EventBus';
import { logger } from '@/infrastructure/logging/LoggerService';

import { ToastManager } from './ui/ToastManager';
import { ModuleCardRenderer } from './ui/ModuleCardRenderer';
import { ModalManager } from './ui/ModalManager';
import { SkeletonManager } from './ui/SkeletonManager';
import type { ModulePlatformService } from '../services/ModulePlatformService';

/**
 * @class AppUI
 * @description Facade for UI components. Delegates to specific managers.
 */

// Note: Window interface extensions are defined in core.ts

export class AppUI {
    private readonly _purifyConfig = {
        ALLOWED_TAGS: [
            'b',
            'i',
            'em',
            'strong',
            'a',
            'p',
            'br',
            'code',
            'pre',
            'div',
            'span',
            'svg',
            'line',
        ],
        ALLOWED_ATTR: [
            'href',
            'class',
            'style',
            'viewBox',
            'width',
            'height',
            'stroke',
            'stroke-width',
            'fill',
            'stroke-linecap',
            'stroke-linejoin',
            'x1',
            'y1',
            'x2',
            'y2',
        ],
        ALLOW_DATA_ATTR: true,
    };
    // Managers
    private readonly _toastManager: ToastManager;
    private readonly _modalManager: ModalManager;
    private readonly _cardRenderer: ModuleCardRenderer;
    private readonly _skeletonManager: SkeletonManager;
    private readonly _platformService: ModulePlatformService;

    constructor(platformService: ModulePlatformService) {
        this._platformService = platformService;
        this._toastManager = new ToastManager();
        this._cardRenderer = new ModuleCardRenderer();
        this._skeletonManager = new SkeletonManager();
        this._modalManager = new ModalManager(this._cardRenderer, (e, app, category) => {
            void this._handleAppCardClick(e, app, category);
        });

        globalThis.addEventListener('language-changed', () => {
            this._modalManager.refreshCurrentSelection();
        });

        // Close modal when navigating away from modules page
        eventBus.on('page:change', ({ pageId }: { pageId: string }) => {
            if (pageId !== 'modules' && pageId !== 'page-modules') {
                this.closeAppSelection();
            }
        });
    }

    // --- Toast System ---
    /**
     * Shows a toast notification.
     * @param {string} message - The message to display.
     * @param {string} [type='info'] - The toast type (success, error, warning, info).
     * @param {number} [duration=3000] - Duration in milliseconds.
     * @param {string|null} [title=null] - Optional toast title.
     * @param {string|null} [id=null] - Optional unique ID to prevent duplicates.
     */
    public showToast(
        message: string,
        type = 'info',
        duration = 3000,
        title: string | null = null,
        id: string | null = null,
    ): void {
        this._toastManager.show(message, type, duration, title, id);
    }

    // --- Action Feedback ---
    /**
     * Shows a brief visual feedback for an action.
     * @param {string} [type='success'] - The feedback type.
     */
    public showActionFeedback(type = 'success'): void {
        let feedback = document.getElementById('action-feedback');
        if (feedback === null) {
            feedback = document.createElement('div');
            feedback.className = 'action-feedback';
            feedback.id = 'action-feedback';
            const win = globalThis as TGlobalWin;
            feedback.innerHTML = DOMPurify.sanitize(win.t('ui.feedback', ''), this._purifyConfig);
            document.body.appendChild(feedback);
        }

        feedback.className = `action-feedback ${type}`;
        const iconElement = feedback.querySelector('.action-feedback-icon');
        if (iconElement !== null) {
            iconElement.textContent = '';
        }
        feedback.classList.add('show');

        const el = feedback;
        setTimeout(() => {
            el.classList.remove('show');
        }, 600);
    }

    // --- Skeletons ---
    /**
     * Displays skeleton loaders for a container.
     * @param {string} containerId - The ID of the container.
     * @param {number} [count=3] - Number of skeletons to show.
     */
    public showSkeletonLoaders(containerId: string, count = 3): void {
        this._skeletonManager.show(containerId, count);
    }

    public hideSkeletonLoaders(containerId: string, count = 3): void {
        this._skeletonManager.hide(containerId, count);
    }

    // --- Button State ---
    /**
     * Toggles the loading state of a button.
     * @param {HTMLButtonElement | null} button - The button to modify.
     * @param {boolean} [loading=true] - Whether it should be in loading state.
     */
    public setButtonLoading(button: HTMLButtonElement | null, loading = true): void {
        this._skeletonManager.setButtonLoading(button, loading);
    }
    // --- App Selection Modal ---
    /**
     * Opens the app selection modal for a specific category.
     * @param {string} category - 'ai' or 'services'.
     * @param {IApp[]} apps - List of apps to display.
     */
    public openAppSelection(category: string, apps: IApp[]): void {
        this._modalManager.openAppSelection(category, apps);
    }

    public closeAppSelection(): void {
        this._modalManager.closeAppSelection();
    }

    /**
     * Updates a specific module card on the dashboard.
     * @param {string} category - The module category.
     * @param {IApp} app - The app data.
     */
    public updateModuleCard(category: string, app: IApp): void {
        const cardId = category === 'ai' ? 'ai-module-card' : 'services-module-card';
        const cardLike = document.getElementById(cardId);

        if (cardLike instanceof HTMLElement) {
            this._stopPreviousModule(cardLike, app);
            this._cardRenderer.updateCardAttributes(cardLike, app);

            cardLike.classList.remove('empty');
            cardLike.classList.add('selected');

            // We still need local content update here as it's specific to dashboard cards,
            // but we can reuse renderer helpers if needed. For now, keep as is or refactor later.
            // The dashboard card structure is slightly different from modal cards.
            // Delegate content update to renderer
            this._cardRenderer.updateCardContent(cardLike, app);

            this._configureActionBtn(cardLike, app);
            this._refreshCardActions(cardLike, app, category);
        } else {
            logger.warn(`[AppUI] Could not find module card: ${cardId}`);
        }
    }

    // --- Private Helper Methods ---

    // _getSortedApps removed (delegated to ModalManager)

    // _createAppCard removed (delegated to ModuleCardRenderer)

    private async _handleAppCardClick(e: MouseEvent, app: IApp, category: string): Promise<void> {
        if (await this._tryDeleteAction(e, app, category)) return;
        if (await this._tryDownloadAction(e, app, category)) return;
        this._performSelectionAction(category, app);
    }

    private async _tryDeleteAction(e: MouseEvent, app: IApp, category: string): Promise<boolean> {
        const target = e.target as HTMLElement;
        if (target.closest('.app-delete-badge') !== null) {
            e.stopPropagation();
            await this._handleDeleteModule(app, category);
            return true;
        }
        return false;
    }

    private async _tryDownloadAction(e: MouseEvent, app: IApp, category: string): Promise<boolean> {
        const target = e.target as HTMLElement;
        const downloadBtn = target.closest('.download-btn');
        const overlay = target.closest('.app-card-overlay');
        const isApi = this._platformService.isApiModule(app);

        if (!isApi && app.installed !== true) {
            // Fallback allows any click for non-installed modules to trigger download
            if (app.repoUrl === undefined || app.repoUrl === '') {
                throw new Error('ui.launcher.web.download_url_empty'); // Key for localization
            }

            e.stopPropagation();
            const btnToAnimate = this._resolveDownloadBtn(e, downloadBtn, overlay);
            await this._handleDownloadModule(app, category, btnToAnimate);
            return true;
        }
        return false;
    }

    private _resolveDownloadBtn(
        e: MouseEvent,
        downloadBtn: Element | null,
        overlay: Element | null,
    ): HTMLElement | null {
        if (downloadBtn instanceof HTMLElement) {
            return downloadBtn;
        }
        if (overlay !== null) {
            const btn = overlay.querySelector('.download-btn');
            if (btn instanceof HTMLElement) return btn;
        }
        // Fallback check
        const currentTarget = e.currentTarget;
        if (currentTarget instanceof HTMLElement) {
            const btn = currentTarget.querySelector('.download-btn');
            if (btn instanceof HTMLElement) return btn;
        }
        return null;
    }

    private _performSelectionAction(category: string, app: IApp): void {
        const win = globalThis as TGlobalWin;
        if (typeof win.selectApp === 'function') {
            (win.selectApp as (cat: string, app: IApp) => void)(category, app);
            this.closeAppSelection();
        }
    }

    private async _handleDeleteModule(app: IApp, category: string): Promise<void> {
        logger.info('[AppUI] Remove module clicked:', app.id);
        const win = globalThis as TGlobalWin;
        try {
            await this._platformService.delete(app);
            app.installed = false;
            // Refresh logic remains in UI for now (Phase 1 can refactor this)
            const allApps = (win.getCatalogCategory as (cat: string) => IApp[])(category);
            this.openAppSelection(category, allApps);
        } catch (err: unknown) {
            logger.error('[AppUI] Delete error:', err);
            const error = err as Error;
            const msg = error.message.startsWith('ui.')
                ? error.message
                : 'ui.launcher.web.delete_model_error';
            const fallback = msg === 'ui.launcher.web.delete_model_error' ? 'Delete error' : msg;

            const g = globalThis as TGlobalWin;
            this.showToast(typeof g.t === 'function' ? g.t(msg, fallback) : fallback, 'error');
        }
    }

    private async _handleDownloadModule(
        app: IApp,
        category: string,
        btn: HTMLElement | null,
    ): Promise<void> {
        logger.info('[AppUI] Download module clicked:', app.id);
        if (btn !== null) {
            btn.classList.add('downloading');
            btn.style.pointerEvents = 'none';
        }

        try {
            await this._platformService.download(app);

            // Refresh modal to show immediate state change if possible
            // Legacy UI refresh logic
            const win = globalThis as TGlobalWin;
            const allApps = (win.getCatalogCategory as (cat: string) => IApp[])(category);
            // Small delay to let backend start emitting events
            setTimeout(() => {
                this.openAppSelection(category, allApps);
            }, 100);
        } catch (err: unknown) {
            logger.error('[AppUI] Download error:', err);
            if (btn !== null) {
                btn.classList.remove('downloading');
                btn.style.pointerEvents = 'auto';
            }
            const error = err as Error;
            const msg = error.message.startsWith('ui.')
                ? error.message
                : 'ui.launcher.web.download_error';
            const fallback = msg === 'ui.launcher.web.download_error' ? 'Download failed' : msg;
            const win = globalThis as TGlobalWin;
            this.showToast(typeof win.t === 'function' ? win.t(msg, fallback) : fallback, 'error');
        }
    }

    private _stopPreviousModule(card: HTMLElement, app: IApp): void {
        const previousModuleId = card.dataset['currentModule'];
        if (
            previousModuleId === undefined ||
            previousModuleId === '' ||
            previousModuleId === app.id
        )
            return;

        const actionBtn = card.querySelector('.model-card-action');
        if (!(actionBtn instanceof HTMLElement)) return;
        if (actionBtn.dataset['running'] !== 'true') return;

        // Create a temporary app object for previous module (minimal needed for stop)
        // We might not have the full object, but _isApiModule uses type/id.
        // Let's assume previous module follows similar ID patterns if we don't have full object.
        // Actually, logic was: checks if ID in list OR type=api.
        // We have dataset['currentModuleName'] but not type.
        // However, if we just call stop, we need an IApp.
        // Let's rely on cached module list or simply infer.
        // The Service handles inference? No, service needs IApp to check props.
        // Existing code constructed `isApi` bool locally.

        // Let's just pass `app` (the current one) ? No, we need to stop the PREVIOUS one.
        // But we don't have the previous IApp object here easily.
        // The DOM has `dataset['currentModule']`.

        // HACK: Reconstruct a partial IApp to pass to `stop`.
        // This is a limitation of the current UI storage.
        // Ideally `AppUI` should track `_currentActiveApp: IApp`.

        const prevId = previousModuleId;
        const partialApp: IApp = {
            id: prevId,
            name: card.dataset['currentModuleName'] ?? prevId,
        } as IApp;

        // We need to know if it was API to know if we should call AIBridge.
        // StartPreviousModule logic:
        // const isApi = (app.type?.toLowerCase() ?? '') === 'api' || ['gpt',...].includes(app.id);
        // We can do the checks on ID.
        // PlatformService `isApiModule` checks ID list too.

        void this._platformService.stop(partialApp).then(() => {
            const prevName = card.dataset['currentModuleName'] ?? prevId;
            // UI Toast (service handles API stop silent, local logs info)
            // If local, we might want to show toast.
            // For now, let's keep the toast here as UI feedback.
            if (!this._platformService.isApiModule(partialApp)) {
                const win = globalThis as TGlobalWin;
                if (typeof win.showToast === 'function') {
                    win.showToast(
                        typeof win.t === 'function'
                            ? win.t('ui.launcher.module.stopped', `${prevName} stopped`)
                            : `${prevName} stopped`,
                        'info',
                    );
                }
            }
        });

        logger.info('[AppUI] Stopped previous module:', previousModuleId);
    }

    // _updateCardAttributes removed (delegated to ModuleCardRenderer)

    // _markCardAsInstalled delegated
    private _markCardAsInstalled(card: HTMLElement, app: IApp): void {
        this._cardRenderer.markCardAsInstalled(card, app, (c, a) => this._configureActionBtn(c, a));
    }

    private _configureActionBtn(card: HTMLElement, app: IApp): void {
        let actionBtn = card.querySelector<HTMLElement>('.model-card-action');

        if (actionBtn === null) {
            actionBtn = document.createElement('div');
            actionBtn.className = 'model-card-action';
            actionBtn.id =
                card.id === 'ai-module-card' ? 'ai-module-add-btn' : 'services-module-add-btn';
            actionBtn.dataset['i18n'] = 'ui.launcher.button.launch';
            card.appendChild(actionBtn);
        }

        const isApi = this._platformService.isApiModule(app);

        const isInstalled = app.installed !== false;

        if (!isApi && !isInstalled) {
            this._setupDownloadActionBtn(actionBtn, app);
        } else {
            // User requested to remove Launch button entirely (selection is done via card click)
            actionBtn.style.display = 'none';
        }
    }

    private _setupDownloadActionBtn(actionBtn: HTMLElement, app: IApp): void {
        const card = actionBtn.closest('.model-card-premium');
        if (card !== null) {
            card.classList.add('has-download');
            card.classList.remove('has-launch');
        }

        actionBtn.style.display = 'block';
        const g = globalThis as TGlobalWin;
        actionBtn.textContent =
            typeof g.t === 'function' ? g.t('ui.launcher.module.download', 'Download') : 'Download';
        actionBtn.classList.remove('active-module-btn');
        actionBtn.classList.add('download-module-btn');
        actionBtn.removeAttribute('onclick'); // Clear inline handlers

        // Use extracted method to reduce complexity
        actionBtn.onclick = (e) => {
            void this._handleDownloadClick(e, actionBtn, app);
        };
    }

    private async _handleDownloadClick(
        e: MouseEvent,
        actionBtn: HTMLElement,
        app: IApp,
    ): Promise<void> {
        e.stopImmediatePropagation();
        e.preventDefault();
        logger.info('Download module clicked (card):', app.id);

        this._setDownloadLoading(actionBtn);

        try {
            await this._platformService.download(app);
            this._onDownloadSuccess(actionBtn, app);
        } catch (err) {
            this._onDownloadError(actionBtn, app, err);
        }
    }

    private _setDownloadLoading(btn: HTMLElement): void {
        const win = globalThis as TGlobalWin;
        btn.textContent =
            typeof win.t === 'function'
                ? win.t('ui.launcher.module.downloading', 'Downloading...')
                : 'Downloading...';
        btn.style.pointerEvents = 'none';
    }

    private _setDownloadReady(btn: HTMLElement): void {
        const win = globalThis as TGlobalWin;
        btn.style.pointerEvents = 'auto';
        btn.textContent =
            typeof win.t === 'function'
                ? win.t('ui.launcher.module.download', 'Download')
                : 'Download';
    }

    private _onDownloadSuccess(actionBtn: HTMLElement, app: IApp): void {
        const win = globalThis as TGlobalWin;
        if (typeof win.showToast === 'function')
            win.showToast(
                typeof win.t === 'function'
                    ? win.t('ui.launcher.web.module_downloaded', 'Module downloaded!')
                    : 'Module downloaded!',
                'success',
            );
        app.installed = true;

        let card = actionBtn.closest('.model-card-premium');
        card ??= actionBtn.closest('.app-card');

        if (card instanceof HTMLElement) {
            this._markCardAsInstalled(card, app);
        }
    }

    private _onDownloadError(actionBtn: HTMLElement, _app: IApp, err: unknown): void {
        logger.error('Download error:', err);
        const win = globalThis as TGlobalWin;
        win.showToast(
            typeof win.t === 'function'
                ? win.t('ui.launcher.web.download_error', 'Download failed')
                : 'Download failed',
            'error',
        );
        this._setDownloadReady(actionBtn);
    }

    private _addSettingsBtn(card: HTMLElement, app: IApp): void {
        const settingsBtn = document.createElement('div');
        settingsBtn.className = 'module-action-badge left settings';
        const win = globalThis as TGlobalWin;
        settingsBtn.innerHTML = DOMPurify.sanitize(
            `
            <div class="badge-icon"><span style="font-size: 1.1rem;">⚙️</span></div>
            <div class="badge-text" data-i18n="ui.launcher.module.settings_short">${typeof win.t === 'function' ? win.t('ui.launcher.module.settings_short', 'Settings') : 'Settings'}</div>
        `,
            this._purifyConfig,
        );
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            logger.info('[AppUI] Settings button clicked (event) for:', app.id);
            const win = globalThis as TGlobalWin;
            if (typeof win.openModuleSettings === 'function') win.openModuleSettings(app);
            else logger.error('[AppUI] globalThis.openModuleSettings is undefined'); // Suppress loop below if needed
        });
        settingsBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            logger.debug('[AppUI] Settings button mousedown for:', app.id);
        });
        card.appendChild(settingsBtn);
    }

    private _addCloseBtn(card: HTMLElement, category: string): void {
        const closeBtn = document.createElement('div');
        closeBtn.className = 'module-action-badge right close';
        const win = globalThis as TGlobalWin;
        closeBtn.innerHTML = DOMPurify.sanitize(
            `
            <div class="badge-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
            <div class="badge-text" data-i18n="ui.launcher.module.remove_short">${typeof win.t === 'function' ? win.t('ui.launcher.module.remove_short', 'Close') : 'Close'}</div>
        `,
            this._purifyConfig,
        );
        closeBtn.onclick = (e): void => {
            e.stopImmediatePropagation();
            card.innerHTML = card.dataset['originalHtml'] ?? '';
            card.classList.remove('selected');
            card.classList.add('empty');

            const win = globalThis as TGlobalWin;
            win.uiState.removeSelectedModule(category);
        };
        card.appendChild(closeBtn);
    }

    // --- Prompt Tab Switching (for chat/settings) ---
    public showPromptTab(tab: string, btn?: HTMLElement): void {
        document.querySelectorAll('.prompt-tab-content').forEach((t) => {
            (t as HTMLElement).style.display = 'none';
        });

        const targetTab = document.getElementById(`prompt-tab-${tab}`);
        if (targetTab !== null) targetTab.style.display = 'block';

        if (btn?.parentElement) {
            btn.parentElement.querySelectorAll('button').forEach((b) => {
                (b as HTMLElement).style.background = 'var(--surface)';
                (b as HTMLElement).style.color = 'var(--text-secondary)';
            });
            btn.style.background = 'var(--primary)';
            btn.style.color = 'white';
        }
    }
    // --- New Private Helpers ---
    // --- Private Helper Methods ---

    // --- Private Helper Methods ---
    // All previous helper methods have been moved to ModuleCardRenderer or ModalManager.
    // This section is kept for any future AppUI-specific helpers.

    private _refreshCardActions(card: HTMLElement, app: IApp, category: string): void {
        // Remove existing actions
        card.querySelectorAll('.module-action-badge').forEach((el) => {
            el.remove();
        });

        this._addSettingsBtn(card, app);
        this._addCloseBtn(card, category);
    }
}
