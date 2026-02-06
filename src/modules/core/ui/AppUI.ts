import type { IApp } from '../types/coreTypes';
import type { TGlobalWin } from '../types/global_bridge_types';
import DOMPurify from 'dompurify';
import { eventBus } from '../services/EventBus';

/**
 * @class AppUI
 * @description Handles global UI components like toasts, module cards, and modals with secure DOM patterns.
 */

// --- Types ---
interface ToastElement extends HTMLElement {
    _timeout?: ReturnType<typeof setTimeout>;
}

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
    private toastQueue: ToastElement[] = [];
    private _currentCategory: string | null = null;
    private _currentApps: IApp[] = [];

    constructor() {
        globalThis.addEventListener('language-changed', () => {
            const modal = document.getElementById('app-selection-modal');
            if (this._currentCategory && modal && !modal.classList.contains('hidden')) {
                console.log('[AppUI] Refreshing app selection modal for language change');
                this.openAppSelection(this._currentCategory, this._currentApps);
            }
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
        type: string = 'info',
        duration: number = 3000,
        title: string | null = null,
        id: string | null = null,
    ) {
        const container = this._ensureToastContainer();

        // Check for existing toast with this ID
        if (id) {
            const existingToast = document.getElementById(`toast-${id}`);
            if (existingToast) {
                this._updateExistingToast(existingToast as ToastElement, message, title, duration);
                return;
            }
        }

        this._createToast(container, message, type, duration, title, id);
    }

    private _ensureToastContainer(): HTMLElement {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    private _updateExistingToast(
        toast: ToastElement,
        message: string,
        title: string | null,
        duration: number,
    ) {
        const contentEl = toast.querySelector('.toast-content');
        if (contentEl) {
            contentEl.innerHTML = DOMPurify.sanitize(
                `
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            `,
                this._purifyConfig,
            );
        }

        // Reset timer
        if (toast._timeout) clearTimeout(toast._timeout);

        toast.classList.remove('leaving');

        toast._timeout = setTimeout(() => {
            toast.classList.add('leaving');
            setTimeout(() => {
                toast.remove();
                this.toastQueue = this.toastQueue.filter((t) => t !== toast);
            }, 300);
        }, duration);
    }

    private _createToast(
        container: HTMLElement,
        message: string,
        type: string,
        duration: number,
        title: string | null,
        id: string | null,
    ) {
        const toast = document.createElement('div') as ToastElement;
        toast.className = `toast ${type}`;
        if (id) toast.id = `toast-${id}`;

        toast.innerHTML = DOMPurify.sanitize(
            `
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
        `,
            this._purifyConfig,
        );

        container.appendChild(toast);
        this.toastQueue.push(toast);

        toast._timeout = setTimeout(() => {
            toast.classList.add('leaving');
            setTimeout(() => {
                toast.remove();
                this.toastQueue = this.toastQueue.filter((t) => t !== toast);
            }, 300);
        }, duration);
    }

    // --- Action Feedback ---
    /**
     * Shows a brief visual feedback for an action.
     * @param {string} [type='success'] - The feedback type.
     */
    public showActionFeedback(type: string = 'success') {
        let feedback = document.getElementById('action-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'action-feedback';
            feedback.id = 'action-feedback';
            feedback.innerHTML = DOMPurify.sanitize(
                '<div class="action-feedback-icon"></div>',
                this._purifyConfig,
            );
            document.body.appendChild(feedback);
        }

        if (feedback) {
            feedback.className = `action-feedback ${type}`;
            const iconElement = feedback.querySelector('.action-feedback-icon');
            if (iconElement) {
                iconElement.textContent = '';
            }
            feedback.classList.add('show');

            setTimeout(() => {
                feedback?.classList.remove('show');
            }, 600);
        }
    }

    // --- Skeletons ---
    /**
     * Displays skeleton loaders for a container.
     * @param {string} containerId - The ID of the container.
     * @param {number} [count=3] - Number of skeletons to show.
     */
    public showSkeletonLoaders(containerId: string, count: number = 3) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const win = globalThis as TGlobalWin;
        if (typeof win['showSkeletonLoaders'] === 'function') {
            (win['showSkeletonLoaders'] as (id: string, count: number) => void)(containerId, count);
            return;
        }

        for (let i = 1; i <= count; i++) {
            const skeleton = document.getElementById(`${containerId}-skeleton-${i}`);
            if (skeleton) {
                skeleton.style.display = 'block';
            }
        }
    }

    public hideSkeletonLoaders(containerId: string, count: number = 3) {
        for (let i = 1; i <= count; i++) {
            const skeleton = document.getElementById(`${containerId}-skeleton-${i}`);
            if (skeleton) {
                skeleton.style.display = 'none';
            }
        }
    }

    // --- Button State ---
    /**
     * Toggles the loading state of a button.
     * @param {HTMLButtonElement | null} button - The button to modify.
     * @param {boolean} [loading=true] - Whether it should be in loading state.
     */
    public setButtonLoading(button: HTMLButtonElement | null, loading: boolean = true) {
        if (!button) return;
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }
    // --- App Selection Modal ---
    /**
     * Opens the app selection modal for a specific category.
     * @param {string} category - 'ai' or 'services'.
     * @param {IApp[]} apps - List of apps to display.
     */
    public openAppSelection(category: string, apps: IApp[]) {
        const modal = document.getElementById('app-selection-modal');
        const listEl = document.getElementById('app-modal-list');

        if (!modal || !listEl) return;

        this._currentCategory = category;
        this._currentApps = apps;

        this._updateAppModalTitle(category);
        this._populateAppList(listEl, apps, category);

        modal.classList.remove('hidden');

        // Close on overlay click
        modal.onclick = (e) => {
            if (e.target === modal) this.closeAppSelection();
        };
    }

    public closeAppSelection() {
        const modal = document.getElementById('app-selection-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    /**
     * Updates a specific module card on the dashboard.
     * @param {string} category - The module category.
     * @param {IApp} app - The app data.
     */
    public updateModuleCard(category: string, app: IApp) {
        const selector =
            category === 'ai' ? '.model-card-premium.ai' : '.model-card-premium.services';
        const card = document.querySelector(selector) as HTMLElement;
        if (!card) return;

        this._stopPreviousModule(card, app);
        this._updateCardAttributes(card, app);

        card.classList.remove('empty');
        card.classList.add('selected');

        this._updateCardContent(card, app);
        this._configureActionBtn(card, app);
        this._refreshCardActions(card, app, category);

        // Card background click
        card.onclick = (e) => this._handleModuleCardClick(e, card, category);
    }

    // --- Private Helper Methods ---

    private _getSortedApps(apps: IApp[]): IApp[] {
        const priority = ['axelate', 'gpt', 'gemini'];
        return [...apps].sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            const getP = (n: string) => {
                const idx = priority.findIndex((p) => n.includes(p));
                return idx === -1 ? 999 : idx;
            };
            const priorityDiff = getP(nameA) - getP(nameB);
            if (priorityDiff !== 0) return priorityDiff;
            return nameA.localeCompare(nameB);
        });
    }

    private _createAppCard(app: IApp, category: string): HTMLElement {
        const card = document.createElement('div');
        card.className = 'app-card';

        const isApi =
            app.type?.toLowerCase() === 'api' ||
            ['gpt', 'gemini', 'claude', 'deepseek', 'llama'].includes(app.id);
        const isInstalled = isApi ? true : app.installed === true;

        card.classList.toggle('is-api', isApi);
        card.classList.toggle('is-installed', isInstalled);

        const g = globalThis as TGlobalWin;
        const downloadText =
            typeof g['t'] === 'function'
                ? g['t']('ui.launcher.module.download', 'Download')
                : 'Download';
        card.innerHTML = DOMPurify.sanitize(
            `
            ${this._getAppDeleteBadgeHtml(isApi, isInstalled)}
            ${this._getAppTypeBadgeHtml(isApi)}
            <div class="app-icon-wrapper">${app.icon || '❓'}</div>
            <div class="app-card-title">${this._getAppName(app)}</div>
            <div class="app-card-desc">${this._getAppDesc(app)}</div>
            ${this._getAppStatusHtml(isApi, isInstalled)}
            ${
                !isInstalled && !isApi
                    ? `
                <div class="app-card-overlay">
                    <div class="app-status download-btn centered">
                        ${downloadText}
                    </div>
                </div>
            `
                    : ''
            }
        `,
            this._purifyConfig,
        );

        card.onclick = (e) => this._handleAppCardClick(e, app, category);

        // Self-Correction: Async check for installation status to handle race conditions
        if (!isInstalled && !isApi) {
            const win = globalThis as TGlobalWin;
            if (typeof win['checkModuleInstalled'] === 'function') {
                (win['checkModuleInstalled'] as (id: string) => Promise<boolean>)(app.id)
                    .then((actuallyInstalled: boolean) => {
                        if (actuallyInstalled) {
                            console.log(`[AppUI] Correcting installation status for ${app.id}`);
                            app.installed = true;
                            this._markCardAsInstalled(card, app);
                        }
                    })
                    .catch((err: unknown) => console.warn('[AppUI] Install check failed:', err));
            }
        }

        return card;
    }

    private async _handleAppCardClick(e: MouseEvent, app: IApp, category: string) {
        const target = e.target as HTMLElement;
        const removeBtn = target.closest('.app-delete-badge');
        if (removeBtn) {
            e.stopPropagation();
            await this._handleDeleteModule(app, category);
            return;
        }

        const downloadBtn = target.closest('.download-btn');
        const overlay = target.closest('.app-card-overlay');
        const isApi =
            app.type?.toLowerCase() === 'api' ||
            ['gpt', 'gemini', 'claude', 'deepseek', 'llama'].includes(app.id);

        if (!isApi && !app.installed && (downloadBtn || overlay)) {
            e.stopPropagation();
            const btnToAnimate =
                (downloadBtn as HTMLElement) ||
                (overlay?.querySelector('.download-btn') as HTMLElement);
            await this._handleDownloadModule(app, category, btnToAnimate);
            return;
        }

        if (!isApi && !app.installed) {
            // Fallback: any click on a non-installed local card should trigger download now
            e.stopPropagation();
            const overlayInCard = (e.currentTarget as HTMLElement).querySelector(
                '.download-btn',
            ) as HTMLElement;
            await this._handleDownloadModule(app, category, overlayInCard);
            return;
        }

        const win = globalThis as TGlobalWin;
        if (typeof win['selectApp'] === 'function') {
            (win['selectApp'] as (cat: string, app: IApp) => void)(category, app);
            this.closeAppSelection();
        }
    }

    private async _handleDeleteModule(app: IApp, category: string) {
        console.log('[AppUI] Remove module clicked:', app.id);
        const win = globalThis as TGlobalWin;
        try {
            if (win['__TAURI__']?.core) {
                await win['__TAURI__'].core.invoke('delete_module', { moduleId: app.id });
                app.installed = false;
                const allApps = (win['getCatalogCategory'] as (cat: string) => IApp[])(category);
                this.openAppSelection(category, allApps);
            } else if (typeof win['deleteModule'] === 'function') {
                await (win['deleteModule'] as (id: string) => Promise<void>)(app.id);
                app.installed = false;
                const allApps = (win['getCatalogCategory'] as (cat: string) => IApp[])(category);
                this.openAppSelection(category, allApps);
            } else {
                this.showToast('Delete not available', 'warning');
            }
        } catch (err) {
            console.error('[AppUI] Delete error:', err);
            const g = globalThis as TGlobalWin;
            this.showToast(
                typeof g['t'] === 'function'
                    ? g['t']('ui.launcher.web.delete_model_error', 'Delete error')
                    : 'Delete error',
                'error',
            );
        }
    }

    private async _handleDownloadModule(app: IApp, category: string, btn: HTMLElement | null) {
        console.log('[AppUI] Download module clicked:', app.id);
        if (btn) {
            btn.classList.add('downloading');
            btn.style.pointerEvents = 'none';
        }

        try {
            const win = globalThis as TGlobalWin;
            if (app.repoUrl && typeof win['downloadModule'] === 'function') {
                await win['downloadModule'](app.id, app.repoUrl, app.expectedHash);

                // Refresh modal to show immediate state change if possible
                const allApps = (win['getCatalogCategory'] as (cat: string) => IApp[])(category);
                // Small delay to let backend start emitting events
                setTimeout(() => this.openAppSelection(category, allApps), 100);
            } else {
                const g = globalThis as TGlobalWin;
                this.showToast(
                    typeof g['t'] === 'function'
                        ? g['t']('ui.launcher.web.download_unavailable', 'Download not available')
                        : 'Download not available',
                    'warning',
                );
            }
        } catch (err) {
            console.error('[AppUI] Download error:', err);
            if (btn) {
                btn.classList.remove('downloading');
                btn.style.pointerEvents = 'auto';
            }
            const win = globalThis as TGlobalWin;
            this.showToast(
                typeof win['t'] === 'function'
                    ? win['t']('ui.launcher.web.download_error', 'Download failed')
                    : 'Download failed',
                'error',
            );
        }
    }

    private _stopPreviousModule(card: HTMLElement, app: IApp) {
        const previousModuleId = card.dataset['currentModule'];
        if (!previousModuleId || previousModuleId === app.id) return;

        const actionBtn = card.querySelector('.model-card-action') as HTMLElement;
        if (actionBtn?.dataset?.['running'] !== 'true') return;

        const isApi =
            app.type?.toLowerCase() === 'api' ||
            ['gpt', 'gemini', 'claude', 'deepseek', 'llama'].includes(app.id);

        const win = globalThis as TGlobalWin;
        if (isApi) {
            if (win['aiBridge']) win['aiBridge'].stopProvider();
        } else if (win['showToast']) {
            const prevName = card.dataset['currentModuleName'] || previousModuleId;
            win['showToast'](
                typeof win['t'] === 'function'
                    ? win['t']('ui.launcher.module.stopped', `${prevName} stopped`)
                    : `${prevName} stopped`,
                'info',
            );
        }
        console.log('[AppUI] Stopped previous module:', previousModuleId);
    }

    private _updateCardAttributes(card: HTMLElement, app: IApp) {
        card.dataset['currentModule'] = app.id;
        card.dataset['currentModuleName'] = app.name || app.id;
        if (!card.dataset['originalHtml']) {
            card.dataset['originalHtml'] = card.innerHTML;
        }
    }

    /**
     * Helper to update card UI when app is installed
     */
    private _markCardAsInstalled(card: HTMLElement, app: IApp) {
        card.classList.remove('has-download');
        card.classList.add('has-launch', 'is-installed');

        // Find overlay and remove/hide it
        const overlay = card.querySelector('.app-card-overlay');
        if (overlay) overlay.remove();

        // Re-configure button to launch/settings
        this._configureActionBtn(card, app);

        // Update type badge
        const typeBadge = card.querySelector('.module-type-badge');
        if (typeBadge) {
            typeBadge.classList.remove('not-installed');
            typeBadge.classList.add('installed');
        }

        // Verify and inject delete badge if missing
        if (!card.querySelector('.app-delete-badge')) {
            const isApi =
                app.type === 'api' ||
                ['gpt', 'gemini', 'claude', 'deepseek', 'llama'].includes(app.id);
            const badgeHtml = this._getAppDeleteBadgeHtml(isApi, true);
            if (badgeHtml) {
                card.insertAdjacentHTML('afterbegin', badgeHtml);
            }
        }
    }

    private _configureActionBtn(card: HTMLElement, app: IApp) {
        let actionBtn = card.querySelector('.model-card-action') as HTMLElement;

        if (!actionBtn) {
            actionBtn = document.createElement('div');
            actionBtn.className = 'model-card-action';
            actionBtn.id =
                card.id === 'ai-module-card' ? 'ai-module-add-btn' : 'services-module-add-btn';
            actionBtn.dataset['i18n'] = 'ui.launcher.button.launch';
            card.appendChild(actionBtn);
        }

        const isApi =
            app.type?.toLowerCase() === 'api' ||
            ['gpt', 'gemini', 'claude', 'deepseek', 'llama'].includes(app.id);
        const isInstalled = app.installed !== false;

        if (!isApi && !isInstalled) {
            this._setupDownloadActionBtn(actionBtn, app);
        } else {
            // User requested to remove Launch button entirely (selection is done via card click)
            actionBtn.style.display = 'none';
        }
    }

    private _setupDownloadActionBtn(actionBtn: HTMLElement, app: IApp) {
        const card = actionBtn.closest('.model-card-premium') as HTMLElement;
        if (card) {
            card.classList.add('has-download');
            card.classList.remove('has-launch');
        }

        actionBtn.style.display = 'block';
        const g = globalThis as TGlobalWin;
        actionBtn.textContent =
            typeof g['t'] === 'function'
                ? g['t']('ui.launcher.module.download', 'Download')
                : 'Download';
        actionBtn.classList.remove('active-module-btn');
        actionBtn.classList.add('download-module-btn');
        actionBtn.removeAttribute('onclick'); // Clear inline handlers

        // Use extracted method to reduce complexity
        actionBtn.onclick = (e) => this._handleDownloadClick(e, actionBtn, app);
    }

    private async _handleDownloadClick(e: MouseEvent, actionBtn: HTMLElement, app: IApp) {
        e.stopImmediatePropagation();
        e.preventDefault();
        console.log('Download module clicked (card):', app.id);

        this._setDownloadLoading(actionBtn);

        try {
            const win = globalThis as TGlobalWin;
            if (typeof win['downloadModule'] === 'function' && app.repoUrl) {
                await win['downloadModule'](app.id, app.repoUrl, app.expectedHash);
                this._onDownloadSuccess(actionBtn, app);
            } else {
                this._notifyDownloadUnavailable();
            }
        } catch (err) {
            this._onDownloadError(actionBtn, app, err);
        }
    }

    private _setDownloadLoading(btn: HTMLElement) {
        const win = globalThis as TGlobalWin;
        btn.textContent =
            typeof win['t'] === 'function'
                ? win['t']('ui.launcher.module.downloading', 'Downloading...')
                : 'Downloading...';
        btn.style.pointerEvents = 'none';
    }

    private _setDownloadReady(btn: HTMLElement) {
        const win = globalThis as TGlobalWin;
        btn.style.pointerEvents = 'auto';
        btn.textContent =
            typeof win['t'] === 'function'
                ? win['t']('ui.launcher.module.download', 'Download')
                : 'Download';
    }

    private _onDownloadSuccess(actionBtn: HTMLElement, app: IApp) {
        const win = globalThis as TGlobalWin;
        if (win['showToast']) win['showToast']('Module downloaded!', 'success');
        app.installed = true;

        const card =
            (actionBtn.closest('.model-card-premium') as HTMLElement) ||
            (actionBtn.closest('.app-card') as HTMLElement);

        if (card) {
            this._markCardAsInstalled(card, app);
        }
    }

    private _onDownloadError(actionBtn: HTMLElement, _app: IApp, err: unknown) {
        console.error('Download error:', err);
        const win = globalThis as TGlobalWin;
        if (win['showToast']) win['showToast']('Download failed', 'error');
        this._setDownloadReady(actionBtn);
    }

    private _notifyDownloadUnavailable() {
        const win = globalThis as TGlobalWin;
        if (win['showToast']) {
            win['showToast']('Download not available', 'warning');
        }
    }

    private _addSettingsBtn(card: HTMLElement, app: IApp) {
        const settingsBtn = document.createElement('div');
        settingsBtn.className = 'module-action-badge left settings';
        const win = globalThis as TGlobalWin;
        settingsBtn.innerHTML = DOMPurify.sanitize(
            `
            <div class="badge-icon"><span style="font-size: 1.1rem;">⚙️</span></div>
            <div class="badge-text" data-i18n="ui.launcher.module.settings_short">${typeof win['t'] === 'function' ? win['t']('ui.launcher.module.settings_short', 'Settings') : 'Settings'}</div>
        `,
            this._purifyConfig,
        );
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log('[AppUI] Settings button clicked (event) for:', app.id);
            const win = globalThis as TGlobalWin;
            if (typeof win['openModuleSettings'] === 'function') win['openModuleSettings'](app);
            else console.error('[AppUI] globalThis.openModuleSettings is undefined');
        });
        settingsBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[AppUI] Settings button mousedown for:', app.id);
        });
        card.appendChild(settingsBtn);
    }

    private _addCloseBtn(card: HTMLElement, category: string) {
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
             <div class="badge-text" data-i18n="ui.launcher.module.remove_short">${typeof win['t'] === 'function' ? win['t']('ui.launcher.module.remove_short', 'Close') : 'Close'}</div>
        `,
            this._purifyConfig,
        );
        closeBtn.onclick = (e) => {
            e.stopImmediatePropagation();
            card.innerHTML = card.dataset['originalHtml'] || '';
            card.classList.remove('selected');
            card.classList.add('empty');
            const win = globalThis as TGlobalWin;
            if (win['uiState']) {
                win['uiState'].removeSelectedModule?.(category);
            }
        };
        card.appendChild(closeBtn);
    }

    private _handleModuleCardClick(e: MouseEvent, card: HTMLElement, category: string) {
        const target = e.target as HTMLElement;
        if (!target) return;
        const isOnBackground =
            target === card ||
            target.classList.contains('model-icon-wrapper') ||
            target.classList.contains('model-card-title') ||
            target.classList.contains('model-card-desc') ||
            target.closest('.model-icon-wrapper');

        if (isOnBackground) {
            const win = globalThis as TGlobalWin;
            if (typeof win['openAppSelection'] === 'function') {
                (win['openAppSelection'] as (cat: string) => void)(category);
            }
        }
    }

    // --- Prompt Tab Switching (for chat/settings) ---
    public showPromptTab(tab: string, btn?: HTMLElement) {
        document.querySelectorAll('.prompt-tab-content').forEach((t) => {
            (t as HTMLElement).style.display = 'none';
        });

        const targetTab = document.getElementById('prompt-tab-' + tab);
        if (targetTab) targetTab.style.display = 'block';

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
    private _getAppName(app: IApp): string {
        if (['axelate', 'axelate-platform', 'axelate-localai'].includes(app.id)) {
            return 'Axelate Local AI';
        }
        return app.name || 'Unknown';
    }

    private _getAppDesc(app: IApp): string {
        const desc = app.desc || '';
        const key = app.descKey || `ui.launcher.app.${app.id}.desc`;

        const win = globalThis as TGlobalWin;
        if (typeof win['t'] === 'function') {
            // Try to translate with explicit key or constructed key
            // We pass 'desc' as fallback. If constructed key doesn't exist, it returns fallback.
            const translated = win['t'](key, desc);
            if (translated !== key) {
                return translated;
            }
        }
        return desc;
    }

    private _getAppDeleteBadgeHtml(isApi: boolean, isInstalled: boolean): string {
        if (isApi || !isInstalled) return '';
        const win = globalThis as TGlobalWin;
        const deleteText =
            typeof win['t'] === 'function'
                ? win['t']('ui.launcher.module.delete', 'DELETE')
                : 'DELETE';
        return `
            <div class="app-delete-badge">
                <div class="badge-icon"><span style="font-size: 1.1rem; line-height: 1;">🗑️</span></div>
                <div class="badge-text">${deleteText}</div>
            </div>`;
    }

    private _getAppTypeBadgeHtml(isApi: boolean): string {
        const typeIcon = isApi
            ? '<span style="font-size: 1.1rem;">☁️</span>'
            : '<span style="font-size: 1.1rem;">🏠</span>';
        let typeText;
        const win = globalThis as TGlobalWin;
        if (isApi) {
            typeText =
                typeof win['t'] === 'function'
                    ? win['t']('ui.launcher.module.type_api', 'API')
                    : 'API';
        } else {
            typeText =
                typeof win['t'] === 'function'
                    ? win['t']('ui.launcher.module.type_local', 'LOCAL')
                    : 'LOCAL';
        }

        const typeClass = isApi ? 'api' : 'local';
        return `
            <div class="module-type-badge ${typeClass}">
                <div class="badge-icon">${typeIcon}</div>
                <div class="badge-text">${typeText}</div>
            </div>`;
    }

    private _getAppStatusHtml(_isApi: boolean, _isInstalled: boolean): string {
        // Download button is now moved to the centered hover overlay in _createAppCard
        return '';
    }

    private _updateAppModalTitle(category: string) {
        const titleEl = document.getElementById('app-modal-title');
        if (!titleEl) return;

        const titles: Record<string, string> = {
            ai: 'AI Applications',
            services: 'Services Manager',
        };
        const key =
            category === 'ai'
                ? 'ui.launcher.modules.modal.ai_title'
                : 'ui.launcher.modules.modal.services_title';
        const defaultTitle = titles[category] || category;

        const win = globalThis as TGlobalWin;
        if (typeof win['t'] === 'function') {
            titleEl.textContent = win['t'](key, defaultTitle);
        } else {
            titleEl.textContent = defaultTitle;
        }
    }

    private _populateAppList(listEl: HTMLElement, apps: IApp[], category: string) {
        listEl.innerHTML = '';

        if (!apps || apps.length === 0) {
            listEl.innerHTML = DOMPurify.sanitize(
                '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No apps found</div>',
                this._purifyConfig,
            );
            return;
        }

        const sortedApps = this._getSortedApps(apps);
        for (const app of sortedApps) {
            const card = this._createAppCard(app, category);
            listEl.appendChild(card);
        }
    }

    private _updateCardContent(card: HTMLElement, app: IApp) {
        const iconWrapper = card.querySelector('.model-icon-wrapper');
        if (iconWrapper)
            iconWrapper.innerHTML = DOMPurify.sanitize(
                `<div>${app.icon || '📦'}</div>`,
                this._purifyConfig,
            );

        const title = card.querySelector('.model-card-title');
        if (title) {
            if (['axelate', 'axelate-platform', 'axelate-localai'].includes(app.id)) {
                title.textContent = 'Axelate Local AI';
            } else {
                let titleText = app.name || '';
                const win = globalThis as TGlobalWin;
                if (typeof win['t'] === 'function' && app.nameKey) {
                    titleText = win['t'](app.nameKey, titleText);
                }
                title.textContent = titleText;
            }
        }

        const desc = card.querySelector('.model-card-desc');
        if (desc) {
            let descText = app.desc || '';
            const win = globalThis as TGlobalWin;
            if (typeof win['t'] === 'function' && app.descKey) {
                descText = win['t'](app.descKey, descText);
            }
            desc.textContent = descText;
        }
    }

    private _refreshCardActions(card: HTMLElement, app: IApp, category: string) {
        // Remove existing actions
        card.querySelectorAll('.module-action-badge').forEach((el) => el.remove());

        this._addSettingsBtn(card, app);
        this._addCloseBtn(card, category);
    }
}
