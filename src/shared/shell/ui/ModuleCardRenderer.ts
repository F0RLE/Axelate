import DOMPurify from 'dompurify';
import type { IApp } from '../../types/coreTypes';
import { getGlobalWin } from '../../utils/globalAccessor';
import { tracer } from '../../../infrastructure/logging/LoggerService';
import { isApiApp } from '../../utils/moduleTypeUtils';

/**
 * @class ModuleCardRenderer
 * @description Handles the generation of HTML for module cards.
 */
export class ModuleCardRenderer {
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
            'use',
            'line',
            'path',
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
            'd',
            'aria-hidden',
        ],
        ALLOW_DATA_ATTR: true,
    };

    public createCard(
        app: IApp,
        _category: string,
        isSelected: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
        onDownload?: (app: IApp) => void,
    ): HTMLElement {
        const card = document.createElement('div');
        card.className = 'app-card module-picker-card';
        if (isSelected) {
            card.classList.add('selected');
        }
        card.dataset['appId'] = app.id;

        const isApi = this._isApiModule(app);
        const isComingSoon = app.comingSoon === true;
        const isInstalled = isApi ? true : !isComingSoon && app.installed === true;

        card.classList.toggle('is-api', isApi);
        card.classList.toggle('is-installed', isInstalled);
        card.classList.toggle('is-coming-soon', isComingSoon);

        const template = document.getElementById('tpl-module-card') as HTMLTemplateElement | null;
        if (!template) {
            tracer.error('[ModuleCardRenderer] template #tpl-module-card not found');
            return card;
        }

        const clone = template.content.cloneNode(true) as DocumentFragment;

        this._injectBadges(clone, isApi, isInstalled);
        this._injectCoreContent(clone, app);
        this._injectStatusAndActions(
            clone,
            app,
            isApi,
            isInstalled,
            isComingSoon,
            isSelected,
            onClick,
            onDownload,
        );

        card.appendChild(clone);

        this._attachEventHandlers(card, app, isApi, onClick);
        this._startAsyncInstallCheck(card, app, isApi, isInstalled, isComingSoon, onClick);

        return card;
    }

    private _injectBadges(clone: DocumentFragment, isApi: boolean, isInstalled: boolean): void {
        const deleteBadgeHtml = this._getAppDeleteBadgeHtml(isApi, isInstalled);
        if (deleteBadgeHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = DOMPurify.sanitize(deleteBadgeHtml, this._purifyConfig);
            if (tempDiv.firstElementChild) {
                clone.insertBefore(tempDiv.firstElementChild, clone.firstChild);
            }
        }

        const typeBadgeHtml = this._getAppTypeBadgeHtml(isApi, isInstalled);
        if (typeBadgeHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = DOMPurify.sanitize(typeBadgeHtml, this._purifyConfig);
            if (tempDiv.firstElementChild) {
                const iconWrapper = clone.querySelector('.app-icon-wrapper');
                if (iconWrapper) {
                    clone.insertBefore(tempDiv.firstElementChild, iconWrapper);
                }
            }
        }
    }

    private _injectCoreContent(clone: DocumentFragment, app: IApp): void {
        const iconWrapper = clone.querySelector('.app-icon-wrapper');
        if (iconWrapper) {
            iconWrapper.innerHTML = this._getSanitizedIconMarkup(app);
        }

        const titleEl = clone.querySelector('.app-card-title');
        if (titleEl) titleEl.textContent = this._getAppName(app);

        const descEl = clone.querySelector('.app-card-desc');
        if (descEl) descEl.textContent = this._getAppDesc(app);
    }

    private _injectStatusAndActions(
        clone: DocumentFragment,
        app: IApp,
        isApi: boolean,
        isInstalled: boolean,
        isComingSoon: boolean,
        isSelected: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
        onDownload?: (app: IApp) => void,
    ): void {
        const statusHtml = this._getAppStatusHtml(isApi, isInstalled);
        if (statusHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = DOMPurify.sanitize(statusHtml, this._purifyConfig);
            if (tempDiv.firstElementChild) {
                clone.appendChild(tempDiv.firstElementChild);
            }
        }

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'app-card-hover-actions';

        if (isComingSoon) {
            actionsContainer.appendChild(this._buildComingSoonButton());
        } else if (!isInstalled && !isApi) {
            actionsContainer.appendChild(this._buildDownloadButton(app, onDownload));
        } else {
            actionsContainer.appendChild(this._buildActionButton(app, isSelected, onClick));
        }

        clone.appendChild(actionsContainer);
    }

    private _buildDownloadButton(app: IApp, onDownload?: (app: IApp) => void): HTMLButtonElement {
        const downloadBtn = document.createElement('button');
        const g = getGlobalWin();
        const downloadText =
            typeof g.t === 'function' ? g.t('ui.launcher.module.download', 'Download') : 'Download';
        downloadBtn.className = 'modal-btn modal-btn-primary download-btn';
        // overflow:hidden keeps the ::before progress fill from leaking outside the button
        downloadBtn.style.overflow = 'hidden';
        downloadBtn.style.position = 'relative';

        // .btn-content wrapper — required by home-and-modules-legacy.css ::before/z-index layering
        const content = document.createElement('span');
        content.className = 'btn-content';
        content.style.cssText =
            'display:flex;align-items:center;justify-content:center;gap:6px;position:relative;z-index:2;width:100%;pointer-events:none';

        const label = document.createElement('span');
        label.className = 'download-label';
        label.textContent = downloadText;

        const pct = document.createElement('span');
        pct.className = 'download-pct';
        pct.style.display = 'none'; // hidden until download starts

        content.appendChild(label);
        content.appendChild(pct);
        downloadBtn.appendChild(content);

        // Wire the click to the injected callback
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onDownload?.(app);
        });

        return downloadBtn;
    }

    private _buildComingSoonButton(): HTMLButtonElement {
        const button = document.createElement('button');
        const g = getGlobalWin();
        const label =
            typeof g.t === 'function'
                ? g.t('ui.launcher.web.coming_soon', 'Coming soon')
                : 'Coming soon';

        button.className = 'modal-btn modal-btn-secondary';
        button.textContent = label;
        button.disabled = true;
        button.title = label;
        button.setAttribute('aria-disabled', 'true');
        return button;
    }

    /**
     * Updates visual download progress on a `.download-btn` inside a card.
     *
     * @param card    - The `.app-card` element containing the button
     * @param percent - 0-100; pass -1 for indeterminate (connecting state)
     * @param status  - Optional Rust status string; controls label text and pct visibility
     */
    public static setDownloadProgress(card: HTMLElement, percent: number, status?: string): void {
        const btn = card.querySelector<HTMLButtonElement>('.download-btn');
        if (btn === null) return;

        btn.classList.add('downloading');
        btn.style.overflow = 'hidden';

        const isIndeterminate = ModuleCardRenderer._isStatusIndeterminate(percent, status);
        if (isIndeterminate) {
            btn.classList.add('indeterminate');
            btn.style.removeProperty('--download-progress');
        } else {
            btn.classList.remove('indeterminate');
            btn.style.setProperty('--download-progress', `${Math.min(100, percent).toFixed(1)}%`);
        }

        const pct = btn.querySelector<HTMLElement>('.download-pct');
        if (pct) ModuleCardRenderer._updatePctDisplay(pct, percent);

        const label = btn.querySelector<HTMLElement>('.download-label');
        if (label) ModuleCardRenderer._updateLabelDisplay(label, status);
    }

    private static _isStatusIndeterminate(percent: number, status?: string): boolean {
        return percent < 0 || status === 'connecting' || status === 'pending';
    }

    private static _updatePctDisplay(pct: HTMLElement, percent: number): void {
        pct.style.display = '';
        const displayPercent = percent < 0 ? 0 : Math.round(percent);
        pct.textContent = `${displayPercent}%`;
    }

    private static _updateLabelDisplay(label: HTMLElement, status?: string): void {
        const g = getGlobalWin();
        const t = typeof g.t === 'function' ? g.t.bind(g) : (_k: string, d: string) => d;

        let targetText = '';
        if (status === 'extracting') {
            const rawText = t('ui.launcher.module.extracting', 'Extracting').replace(/\.+$/, '');
            targetText = typeof rawText === 'string' ? rawText : 'Extracting';
        }

        if (label.textContent !== targetText) {
            label.textContent = targetText;
        }
    }

    /**
     * Marks a download button in a card as complete and resets its state.
     */
    public static clearDownloadProgress(card: HTMLElement): void {
        const btn = card.querySelector<HTMLButtonElement>('.download-btn');
        if (btn === null) return;
        btn.classList.remove('downloading', 'indeterminate');
        btn.style.removeProperty('--download-progress');
    }

    private _buildActionButton(
        app: IApp,
        isSelected: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
    ): HTMLButtonElement {
        const actionBtn = document.createElement('button');
        const winConfig = getGlobalWin() as unknown as {
            aiBridge?: { getState: () => { activeProviderId?: string } };
            t?: (k: string, d: string) => string;
        };

        const aiState = winConfig.aiBridge?.getState();
        const isRunning = aiState?.activeProviderId === app.id;

        if (isSelected) {
            actionBtn.className = 'modal-btn modal-btn-secondary';
            if (isRunning) {
                actionBtn.classList.add('active-module-btn', 'stop-btn');
                const i18nKey = 'ui.launcher.modules.modal.btn_running';
                actionBtn.dataset['i18n'] = i18nKey;
                actionBtn.textContent =
                    typeof winConfig.t === 'function' ? winConfig.t(i18nKey, 'Running') : 'Running';
            } else {
                const i18nKey = 'ui.launcher.modules.modal.btn_remove';
                actionBtn.dataset['i18n'] = i18nKey;
                actionBtn.textContent =
                    typeof winConfig.t === 'function' ? winConfig.t(i18nKey, 'Remove') : 'Remove';
            }
        } else {
            actionBtn.className = 'modal-btn modal-btn-primary';
            const i18nKey = 'ui.launcher.modules.modal.btn_select';
            actionBtn.dataset['i18n'] = i18nKey;
            actionBtn.textContent =
                typeof winConfig.t === 'function' ? winConfig.t(i18nKey, 'Select') : 'Select';
        }

        actionBtn.onclick = (e) => {
            e.stopPropagation();

            // Tactile press animation
            actionBtn.style.transition = 'transform 0.1s ease';
            actionBtn.style.transform = 'scale(0.92)';
            setTimeout(() => {
                actionBtn.style.transition = 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
                actionBtn.style.transform = '';
            }, 100);

            onClick(e, app);
        };

        return actionBtn;
    }

    private _attachEventHandlers(
        card: HTMLElement,
        app: IApp,
        isApi: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
    ): void {
        card.onclick = (e) => onClick(e, app);

        card.addEventListener(
            'contextmenu',
            (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const isEffectivelyInstalled = isApi || card.classList.contains('is-installed');
                if (!isEffectivelyInstalled) {
                    tracer.debug(
                        `[ModuleCardRenderer] Ignored right-click on uninstalled module: ${app.id}`,
                    );
                    return;
                }

                tracer.info('[ModuleCardRenderer] Isolated right-click on module card:', app.id);
                const win = getGlobalWin();
                if (typeof win.openModuleSettings === 'function') {
                    win.openModuleSettings(app);
                }
            },
            { capture: true },
        );

        card.addEventListener(
            'mousedown',
            (e: MouseEvent) => {
                if (e.button === 2) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }
            },
            { capture: true },
        );
    }

    private _startAsyncInstallCheck(
        card: HTMLElement,
        app: IApp,
        isApi: boolean,
        isInstalled: boolean,
        isComingSoon: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
    ): void {
        if (!isInstalled && !isApi && !isComingSoon) {
            const win = getGlobalWin();
            if (typeof win.checkModuleInstalled === 'function') {
                void (async (): Promise<void> => {
                    try {
                        const actuallyInstalled = await (
                            win.checkModuleInstalled as (id: string) => Promise<boolean>
                        )(app.id);
                        if (actuallyInstalled) {
                            this._handleAsyncInstallSuccess(card, app, isApi, onClick);
                        }
                    } catch (err) {
                        tracer.debug(
                            `[ModuleCardRenderer] Failed to check installation status for ${app.id}: ${String(err)}`,
                        );
                    }
                })();
            }
        }
    }

    private _handleAsyncInstallSuccess(
        card: HTMLElement,
        app: IApp,
        isApi: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
    ): void {
        if (!card.isConnected) return;
        if (card.dataset['appId'] !== app.id) return;

        app.installed = true;

        card.classList.remove('has-download');
        card.classList.add('has-launch', 'is-installed');

        const actionsContainer = card.querySelector('.app-card-hover-actions');
        if (actionsContainer) {
            actionsContainer.innerHTML = '';
            const actionBtn = document.createElement('button');
            actionBtn.className = 'modal-btn modal-btn-primary';
            const i18nKey = 'ui.launcher.modules.modal.btn_select';
            const defaultText = 'Select';
            actionBtn.dataset['i18n'] = i18nKey;

            const winConfig = getGlobalWin();
            actionBtn.textContent =
                typeof winConfig.t === 'function' ? winConfig.t(i18nKey, defaultText) : defaultText;

            actionBtn.onclick = (e) => {
                e.stopPropagation();
                onClick(e, app);
            };
            actionsContainer.appendChild(actionBtn);
        }

        const typeBadge = card.querySelector('.app-type-badge');
        if (typeBadge) {
            typeBadge.classList.remove('not-installed');
            typeBadge.classList.add('installed');
        }

        if (card.querySelector('.app-delete-badge') === null) {
            const badgeHtml = this._getAppDeleteBadgeHtml(isApi, true);
            if (badgeHtml !== '') {
                card.insertAdjacentHTML(
                    'afterbegin',
                    DOMPurify.sanitize(badgeHtml, this._purifyConfig),
                );
            }
        }
    }

    public updateCardAttributes(card: HTMLElement, app: IApp, capability?: string): void {
        card.dataset['currentModule'] = app.id;
        card.dataset['currentModuleName'] = app.name ?? app.id;
        if (capability !== undefined && capability !== '') {
            card.dataset['currentCapability'] = capability;
        } else {
            delete card.dataset['currentCapability'];
        }
        card.dataset['originalHtml'] ??= card.innerHTML;
    }

    /**
     * Updates the icon, title, and description of a **dashboard card** (`.model-card-premium`).
     *
     * NOTE: This method targets `.model-icon-wrapper`, `.model-card-title`, `.model-card-desc` —
     * the CSS classes used by the static HTML in `modules.html`. These are intentionally
     * different from the `.app-icon-wrapper`/`.app-card-title`/`.app-card-desc` classes that
     * `createCard()` generates for modal cards. Do NOT call this on modal `.app-card` elements.
     */
    public updateCardContent(card: HTMLElement, app: IApp): void {
        this._updateCardIcon(card, app);
        this._updateCardTitle(card, app);
        this._updateCardDesc(card, app);
    }

    private _updateCardIcon(card: HTMLElement, app: IApp): void {
        const iconWrapper = card.querySelector('.model-icon-wrapper');
        if (iconWrapper === null) return;

        iconWrapper.innerHTML = this._getSanitizedIconMarkup(
            app,
            (icon) => `<span class="model-icon-glyph">${icon}</span>`,
        );
    }

    private _updateCardTitle(card: HTMLElement, app: IApp): void {
        const title = card.querySelector('.model-card-title');
        if (!(title instanceof HTMLElement)) return;

        if (['axelate', 'axelate-platform'].includes(app.id)) {
            const win = getGlobalWin();
            title.textContent =
                typeof win.t === 'function'
                    ? win.t('ui.launcher.web.app_title', 'Axelate')
                    : 'Axelate';
            delete title.dataset['i18n'];
            return;
        }

        let titleText = app.name ?? '';
        const win = getGlobalWin();
        if (typeof win.t === 'function' && (app.nameKey ?? '') !== '') {
            title.dataset['i18n'] = app.nameKey;
            titleText = win.t(app.nameKey ?? '', titleText);
        } else {
            delete title.dataset['i18n'];
        }
        title.textContent = titleText;
    }

    private _updateCardDesc(card: HTMLElement, app: IApp): void {
        const desc = card.querySelector('.model-card-desc');
        if (!(desc instanceof HTMLElement)) return;

        let descText = app.desc ?? '';
        const win = getGlobalWin();
        if (typeof win.t === 'function' && (app.descKey ?? '') !== '') {
            desc.dataset['i18n'] = app.descKey ?? '';
            const translated = win.t(app.descKey ?? '', descText);
            descText = translated || descText;
        } else {
            delete desc.dataset['i18n'];
        }
        desc.textContent = descText;
    }

    public markCardAsInstalled(
        card: HTMLElement,
        app: IApp,
        configureActionBtn: (card: HTMLElement, app: IApp) => void,
    ): void {
        card.classList.remove('has-download');
        card.classList.add('has-launch', 'is-installed');

        const overlay = card.querySelector('.app-card-overlay');
        if (overlay !== null) overlay.remove();

        configureActionBtn(card, app);

        const typeBadge = card.querySelector('.app-type-badge');
        if (typeBadge !== null) {
            typeBadge.classList.remove('not-installed');
            typeBadge.classList.add('installed');
        }

        // Verify and inject delete badge if missing
        if (card.querySelector('.app-delete-badge') === null) {
            const isApi = this._isApiModule(app);
            const badgeHtml = this._getAppDeleteBadgeHtml(isApi, true);
            if (badgeHtml !== '') {
                card.insertAdjacentHTML(
                    'afterbegin',
                    DOMPurify.sanitize(badgeHtml, this._purifyConfig),
                );
            }
        }

        // Status badge updates removed as the element is no longer rendered
    }

    // --- Helpers ---

    private _isApiModule(app: IApp): boolean {
        return isApiApp(app);
    }

    private _getAppName(app: IApp): string {
        const key = app.nameKey ?? `ui.launcher.module.${app.id}.name`;
        const g = getGlobalWin();
        if (typeof g.t === 'function') return g.t(key, app.name ?? app.id);
        return app.name ?? app.id;
    }

    private _getAppDesc(app: IApp): string {
        const key = app.descKey ?? `ui.launcher.module.${app.id}.desc`;
        const g = getGlobalWin();
        if (typeof g.t === 'function') return g.t(key, app.desc ?? '');
        return app.desc ?? '';
    }

    private _getSanitizedIconMarkup(
        app: IApp,
        wrap?: (icon: string) => string,
        fallback = '❓',
    ): string {
        const icon = app.icon ?? fallback;
        const markup = wrap?.(icon) ?? icon;
        return DOMPurify.sanitize(markup, this._purifyConfig);
    }

    private _getAppTypeBadgeHtml(isApi: boolean, isInstalled: boolean): string {
        const g = getGlobalWin();
        let text: string;
        let iconHtml: string;

        if (isApi) {
            text = typeof g.t === 'function' ? g.t('ui.launcher.badge.cloud', 'CLOUD') : 'CLOUD';
            // Cloud Emoji
            iconHtml = '<span style="font-size: 1.1rem;">☁️</span>';
        } else {
            text = typeof g.t === 'function' ? g.t('ui.launcher.badge.local', 'LOCAL') : 'LOCAL';
            // House Emoji (restored from history)
            iconHtml = '<span style="font-size: 1.1rem;">🏠</span>';
        }

        const defaultClass = isApi ? 'api' : 'local';
        const installClass = isApi || isInstalled ? 'installed' : 'not-installed';

        return `
            <div class="app-type-badge ${defaultClass} ${installClass}">
                <div class="badge-text">${text}</div>
                <div class="badge-icon">${iconHtml}</div>
            </div>
        `;
    }

    private _getAppStatusHtml(_isApi: boolean, _isInstalled: boolean): string {
        return '';
    }

    private _getAppDeleteBadgeHtml(isApi: boolean, isInstalled: boolean): string {
        if (isApi || !isInstalled) return '';
        const win = getGlobalWin();
        const deleteText =
            typeof win.t === 'function' ? win.t('ui.launcher.module.delete', 'DELETE') : 'DELETE';

        return `
            <div class="app-delete-badge">
                <div class="badge-icon">
                    <span style="font-size: 1.1rem; line-height: 1;">🗑️</span>
                </div>
                <div class="badge-text">${deleteText}</div>
            </div>
        `;
    }
}
