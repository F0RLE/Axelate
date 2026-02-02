import { IApp } from '../types/coreTypes';
import DOMPurify from 'dompurify';

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
    }

    // --- Toast System ---
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
            contentEl.innerHTML = DOMPurify.sanitize(`
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            `);
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

        toast.innerHTML = DOMPurify.sanitize(`
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
        `);

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
    public showActionFeedback(type: string = 'success') {
        let feedback = document.getElementById('action-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'action-feedback';
            feedback.id = 'action-feedback';
            feedback.innerHTML = DOMPurify.sanitize('<div class="action-feedback-icon"></div>');
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
    public showSkeletonLoaders(containerId: string, count: number = 3) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (typeof globalThis.showSkeletonLoaders === 'function') {
            globalThis.showSkeletonLoaders(containerId, count);
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

        const isApi = app.type === 'api' || ['gpt', 'gemini'].includes(app.id);
        const isInstalled = isApi ? true : app.installed === true;

        card.innerHTML = DOMPurify.sanitize(`
            ${this._getAppDeleteBadgeHtml(isApi, isInstalled)}
            ${this._getAppTypeBadgeHtml(isApi)}
            <div class="app-icon-wrapper">${app.icon || '❓'}</div>
            <div class="app-card-title">${this._getAppName(app)}</div>
            <div class="app-card-desc">${this._getAppDesc(app)}</div>
            ${this._getAppStatusHtml(isApi, isInstalled)}
        `);

        card.onclick = (e) => this._handleAppCardClick(e, app, category);
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
        const isApi = app.type === 'api' || ['gpt', 'gemini'].includes(app.id);
        if (downloadBtn && !isApi && !app.installed) {
            e.stopPropagation();
            await this._handleDownloadModule(app, category, downloadBtn as HTMLElement);
            return;
        }

        if (!isApi && !app.installed) {
            if (globalThis.showToast) {
                globalThis.showToast(
                    globalThis.t
                        ? globalThis.t(
                              'ui.launcher.web.download_first',
                              'Download the module first',
                          )
                        : 'Download the module first',
                    'info',
                );
            }
            return;
        }

        if (typeof globalThis.selectApp === 'function') {
            globalThis.selectApp?.(category, app);
            this.closeAppSelection();
        }
    }

    private async _handleDeleteModule(app: IApp, category: string) {
        console.log('Remove module clicked:', app.id);
        try {
            if (globalThis.__TAURI__?.core) {
                await globalThis.__TAURI__.core.invoke('delete_module', { moduleId: app.id });
                app.installed = false;
                const allApps = globalThis.APP_DATA?.[category] || [];
                this.openAppSelection(category, allApps);
            } else if (typeof globalThis.deleteModule === 'function') {
                await globalThis.deleteModule(app.id);
                app.installed = false;
                const allApps = globalThis.APP_DATA?.[category] || [];
                this.openAppSelection(category, allApps);
            } else {
                this.showToast('Delete not available', 'warning');
            }
        } catch (err) {
            console.error('Delete error:', err);
            this.showToast(
                globalThis.t
                    ? globalThis.t('ui.launcher.web.delete_model_error', 'Delete error')
                    : 'Delete error',
                'error',
            );
        }
    }

    private async _handleDownloadModule(app: IApp, category: string, btn: HTMLElement) {
        console.log('Download module clicked:', app.id);
        btn.classList.add('downloading');
        btn.style.pointerEvents = 'none';

        try {
            if (app.repoUrl && globalThis.downloadModule) {
                await globalThis.downloadModule(app.id, app.repoUrl);
                app.installed = true;
                const allApps = globalThis.APP_DATA?.[category] || [];
                this.openAppSelection(category, allApps); // Refresh
            } else {
                this.showToast('Download not available', 'warning');
            }
        } catch (err) {
            console.error('Download error:', err);
            this.showToast('Download failed', 'error');
        } finally {
            btn.classList.remove('downloading');
            btn.style.pointerEvents = 'auto';
        }
    }

    private _stopPreviousModule(card: HTMLElement, app: IApp) {
        const previousModuleId = card.dataset.currentModule;
        if (!previousModuleId || previousModuleId === app.id) return;

        const actionBtn = card.querySelector('.model-card-action') as HTMLElement;
        if (actionBtn?.dataset?.running !== 'true') return;

        if (['gpt', 'gemini'].includes(previousModuleId)) {
            if (globalThis.aiBridge) globalThis.aiBridge.stopProvider();
        } else if (globalThis.showToast) {
            const prevName = card.dataset.currentModuleName || previousModuleId;
            globalThis.showToast(
                globalThis.t
                    ? globalThis.t('ui.launcher.module.stopped', `${prevName} stopped`)
                    : `${prevName} stopped`,
                'info',
            );
        }
        console.log('Stopped previous module:', previousModuleId);
    }

    private _updateCardAttributes(card: HTMLElement, app: IApp) {
        card.dataset.currentModule = app.id;
        card.dataset.currentModuleName = app.name || app.id;
        if (!card.dataset.originalHtml) {
            card.dataset.originalHtml = card.innerHTML;
        }
    }

    private _configureActionBtn(card: HTMLElement, app: IApp) {
        let actionBtn = card.querySelector('.model-card-action') as HTMLElement;

        if (!actionBtn) {
            actionBtn = document.createElement('div');
            actionBtn.className = 'model-card-action';
            actionBtn.id =
                card.id === 'ai-module-card' ? 'ai-module-add-btn' : 'services-module-add-btn';
            actionBtn.dataset.i18n = 'ui.launcher.button.launch';
            card.appendChild(actionBtn);
        }

        const isApi = app.type === 'api' || ['gpt', 'gemini'].includes(app.id);
        const isInstalled = app.installed !== false;

        if (!isApi && !isInstalled) {
            this._setupDownloadActionBtn(actionBtn, app);
        } else {
            this._setupLaunchActionBtn(actionBtn, app);
        }
    }

    private _setupDownloadActionBtn(actionBtn: HTMLElement, app: IApp) {
        const card = actionBtn.closest('.model-card-premium') as HTMLElement;
        if (card) {
            card.classList.add('has-download');
            card.classList.remove('has-launch');
        }

        actionBtn.style.display = 'block';
        actionBtn.textContent = globalThis.t
            ? globalThis.t('ui.launcher.module.download', 'Download')
            : 'Download';
        actionBtn.classList.remove('active-module-btn');
        actionBtn.classList.add('download-module-btn');
        actionBtn.removeAttribute('onclick'); // Clear inline handlers
        actionBtn.onclick = async (e) => {
            e.stopImmediatePropagation();
            e.preventDefault();
            console.log('Download module clicked (card):', app.id);
            actionBtn.textContent = globalThis.t
                ? globalThis.t('ui.launcher.module.downloading', 'Downloading...')
                : 'Downloading...';
            actionBtn.style.pointerEvents = 'none';

            try {
                if (globalThis.downloadModule && app.repoUrl) {
                    await globalThis.downloadModule(app.id, app.repoUrl);
                    if (globalThis.showToast) globalThis.showToast('Module downloaded!', 'success');
                    app.installed = true;
                    this._configureActionBtn(
                        (actionBtn.closest('.model-card-premium') as HTMLElement) ||
                            (actionBtn.parentElement?.parentElement as HTMLElement),
                        app,
                    ); // Refresh btn
                } else if (globalThis.showToast) {
                    globalThis.showToast('Download not available', 'warning');
                }
            } catch (err) {
                console.error('Download error:', err);
                if (globalThis.showToast) globalThis.showToast('Download failed', 'error');
            }
            actionBtn.style.pointerEvents = 'auto';
            if (!app.installed)
                actionBtn.textContent = globalThis.t
                    ? globalThis.t('ui.launcher.module.download', 'Download')
                    : 'Download';
        };
    }

    private _setupLaunchActionBtn(actionBtn: HTMLElement, app: IApp) {
        const card = actionBtn.closest('.model-card-premium') as HTMLElement;
        if (card) {
            card.classList.add('has-launch');
            card.classList.remove('has-download');
        }

        actionBtn.style.display = 'block';
        actionBtn.classList.add('active-module-btn');
        actionBtn.classList.remove('download-module-btn');

        const isApi = app.type === 'api' || ['gpt', 'gemini'].includes(app.id);

        const setupRunning = () => this._setBtnStateRunning(actionBtn);
        const setupStopped = () => this._setBtnStateStopped(actionBtn);

        this._checkModuleStatus(app, isApi).then((running) => {
            // Set running state via dataset for styles/logic
            actionBtn.dataset.running = running ? 'true' : 'false';
            if (running) {
                setupRunning();
            } else {
                setupStopped();
            }
        });

        actionBtn.onclick = (e) =>
            this._handleLaunchClick(e, app, actionBtn, setupStopped, setupRunning);
    }

    private _addSettingsBtn(card: HTMLElement, app: IApp) {
        const settingsBtn = document.createElement('div');
        settingsBtn.className = 'module-action-badge left settings';
        settingsBtn.innerHTML = DOMPurify.sanitize(`
            <div class="badge-icon"><span style="font-size: 1.1rem;">⚙️</span></div>
            <div class="badge-text" data-i18n="ui.launcher.module.settings_short">${globalThis.t ? globalThis.t('ui.launcher.module.settings_short', 'Settings') : 'Settings'}</div>
        `);
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log('[AppUI] Settings button clicked (event) for:', app.id);
            if (globalThis.openModuleSettings) globalThis.openModuleSettings(app);
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
        closeBtn.innerHTML = DOMPurify.sanitize(`
             <div class="badge-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
             </div>
             <div class="badge-text" data-i18n="ui.launcher.module.remove_short">${globalThis.t ? globalThis.t('ui.launcher.module.remove_short', 'Close') : 'Close'}</div>
        `);
        closeBtn.onclick = (e) => {
            e.stopImmediatePropagation();
            card.innerHTML = card.dataset.originalHtml || '';
            card.classList.remove('selected');
            card.classList.add('empty');
            if (globalThis.uiState) {
                globalThis.uiState.removeSelectedModule?.(category);
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
            if (typeof globalThis.openAppSelection === 'function') {
                globalThis.openAppSelection(category);
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

        if (globalThis.t) {
            // Try to translate with explicit key or constructed key
            // We pass 'desc' as fallback. If constructed key doesn't exist, it returns fallback.
            const translated = globalThis.t(key, desc);
            if (translated !== key) {
                return translated;
            }
        }
        return desc;
    }

    private _getAppDeleteBadgeHtml(isApi: boolean, isInstalled: boolean): string {
        if (isApi || !isInstalled) return '';
        const deleteText = globalThis.t
            ? globalThis.t('ui.launcher.module.delete', 'DELETE')
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
        if (isApi) {
            typeText = globalThis.t ? globalThis.t('ui.launcher.module.type_api', 'API') : 'API';
        } else {
            typeText = globalThis.t
                ? globalThis.t('ui.launcher.module.type_local', 'LOCAL')
                : 'LOCAL';
        }

        const typeClass = isApi ? 'api' : 'local';
        return `
            <div class="module-type-badge ${typeClass}">
                <div class="badge-icon">${typeIcon}</div>
                <div class="badge-text">${typeText}</div>
            </div>`;
    }

    private _getAppStatusHtml(isApi: boolean, isInstalled: boolean): string {
        if (isApi || isInstalled) {
            // User requested to remove the 'ACTIVE' label to keep these cards cleaner
            return '';
        }
        const txt = globalThis.t
            ? globalThis.t('ui.launcher.module.download', 'Download')
            : 'Download';
        return `<div class="app-status download-btn">${txt}</div>`;
    }

    private _setBtnStateRunning(actionBtn: HTMLElement) {
        const setRunningText = () => {
            actionBtn.textContent = globalThis.t
                ? globalThis.t('ui.launcher.status.running', 'Running')
                : 'Running';
            actionBtn.classList.remove('stop-btn');
        };
        setRunningText();

        actionBtn.onmouseenter = () => {
            if (actionBtn.dataset.running === 'true') {
                actionBtn.textContent = globalThis.t
                    ? globalThis.t('ui.launcher.button.stop', 'Stop')
                    : 'Stop';
                actionBtn.classList.add('stop-btn');
            }
        };
        actionBtn.onmouseleave = () => {
            if (actionBtn.dataset.running === 'true') {
                setRunningText();
            }
        };
    }

    private _setBtnStateStopped(actionBtn: HTMLElement) {
        actionBtn.textContent = globalThis.t
            ? globalThis.t('ui.launcher.button.launch', 'Launch')
            : 'Launch';
        actionBtn.classList.remove('stop-btn');
        actionBtn.onmouseenter = null;
        actionBtn.onmouseleave = null;
    }

    private async _checkModuleStatus(app: IApp, isApi: boolean): Promise<boolean> {
        if (!isApi && globalThis.__TAURI__?.core) {
            try {
                const status = await globalThis.__TAURI__.core.invoke('get_module_status', {
                    moduleId: app.id,
                });
                return String(status) === 'running';
            } catch (err) {
                console.warn('Status check failed:', err);
            }
        }
        return false;
    }

    private async _handleLaunchClick(
        e: MouseEvent,
        app: IApp,
        actionBtn: HTMLElement,
        updateToStopped: () => void,
        updateToRunning: () => void,
    ) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const currentlyRunning = actionBtn.dataset.running === 'true';

        if (currentlyRunning) {
            this._handleStopModule(app, updateToStopped, actionBtn);
        } else {
            await this._handleStartModule(app, updateToRunning, actionBtn);
        }
    }

    private _handleStopModule(app: IApp, updateToStopped: () => void, actionBtn: HTMLElement) {
        console.log('[AppUI] Stop app clicked:', app.id);
        const isAiModule = actionBtn.id.includes('ai-') || ['gpt', 'gemini'].includes(app.id) || app.type === 'api';
        
        if (isAiModule) {
            if (globalThis.aiBridge) globalThis.aiBridge.stopProvider();
        } else {
            const moduleName = app.name || app.id;
            if (globalThis.showToast)
                globalThis.showToast(
                    globalThis.t
                        ? globalThis.t('ui.launcher.module.stopped', `${moduleName} stopped`)
                        : `${moduleName} stopped`,
                    'info',
                );
        }
        actionBtn.dataset.running = 'false';
        updateToStopped();
    }

    private async _handleStartModule(
        app: IApp,
        updateToRunning: () => void,
        actionBtn: HTMLElement,
    ) {
        console.log('[AppUI] Launch app clicked:', app.id);
        const isAiModule = actionBtn.id.includes('ai-') || ['gpt', 'gemini'].includes(app.id) || app.type === 'api';

        if (isAiModule) {
            if (globalThis.aiBridge) {
                const success = await globalThis.aiBridge.startProvider(app.id);
                if (success) {
                    actionBtn.dataset.running = 'true';
                    updateToRunning();
                }
            } else if (globalThis.showToast) {
                globalThis.showToast('AI Bridge not initialized', 'error');
            }
        } else {
            const moduleName = app.name || app.id;
            if (globalThis.showToast)
                globalThis.showToast(
                    globalThis.t
                        ? globalThis.t('ui.launcher.module.launched', `${moduleName} launched`)
                        : `${moduleName} launched`,
                    'success',
                );
            actionBtn.dataset.running = 'true';
            updateToRunning();
        }
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

        if (globalThis.t) {
            titleEl.textContent = globalThis.t(key, defaultTitle);
        } else {
            titleEl.textContent = defaultTitle;
        }
    }

    private _populateAppList(listEl: HTMLElement, apps: IApp[], category: string) {
        listEl.innerHTML = '';

        if (!apps || apps.length === 0) {
            listEl.innerHTML = DOMPurify.sanitize(
                '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No apps found</div>',
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
            iconWrapper.innerHTML = DOMPurify.sanitize(`<div>${app.icon || '📦'}</div>`);

        const title = card.querySelector('.model-card-title');
        if (title) {
            if (['axelate', 'axelate-platform', 'axelate-localai'].includes(app.id)) {
                title.textContent = 'Axelate Local AI';
            } else {
                let titleText = app.name || '';
                if (globalThis.t && app.nameKey) {
                    titleText = globalThis.t(app.nameKey, titleText);
                }
                title.textContent = titleText;
            }
        }

        const desc = card.querySelector('.model-card-desc');
        if (desc) {
            let descText = app.desc || '';
            if (globalThis.t && app.descKey) {
                descText = globalThis.t(app.descKey, descText);
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
