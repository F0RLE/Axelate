import type { IApp } from '../../types/coreTypes';
import type { LoggerService } from '../../../infrastructure/logging/LoggerService';
import { isApiApp } from '../../utils/moduleTypeUtils';
import {
    buildModuleCardActionButton,
    buildModuleCardComingSoonButton,
    buildModuleCardDownloadButton,
} from './ModuleCardActions';
import {
    clearModuleCardDownloadProgress,
    setModuleCardDownloadProgress,
} from './ModuleCardDownloadProgress';
import { ModuleCardPresentationHelper } from './ModuleCardPresentationHelper';

type ModuleCardRendererDeps = {
    checkInstalled?: (moduleId: string) => Promise<boolean>;
    translate?: (key: string, fallback: string) => string;
    openModuleSettings?: (app: IApp) => void;
    tracer?: LoggerService;
};

type CardState = {
    isApi: boolean;
    isInstalled: boolean;
    isComingSoon: boolean;
};

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
    private readonly _deps: ModuleCardRendererDeps;
    private readonly _translate: (key: string, fallback: string) => string;
    private readonly _presentation: ModuleCardPresentationHelper;
    private readonly _tracer: LoggerService | undefined;

    public constructor(deps: ModuleCardRendererDeps = {}) {
        this._deps = deps;
        this._translate = deps.translate ?? ((_key, fallback) => fallback);
        this._presentation = new ModuleCardPresentationHelper(this._purifyConfig, this._translate);
        this._tracer = deps.tracer;
    }

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

        const state = this._resolveCardState(app);
        this._applyCardState(card, state);

        const template = document.getElementById('tpl-module-card') as HTMLTemplateElement | null;
        if (!template) {
            this._tracer?.error('[ModuleCardRenderer] template #tpl-module-card not found');
            return card;
        }

        const clone = template.content.cloneNode(true) as DocumentFragment;

        this._injectBadges(clone, state);
        this._injectCoreContent(clone, app);
        this._injectStatusAndActions(
            clone,
            app,
            state,
            isSelected,
            onClick,
            onDownload,
        );

        card.appendChild(clone);

        this._attachEventHandlers(card, app, state.isApi, onClick);
        this._startAsyncInstallCheck(card, app, state, onClick);

        return card;
    }

    private _resolveCardState(app: IApp): CardState {
        const isApi = this._isApiModule(app);
        const isComingSoon = app.comingSoon === true;
        const isInstalled = isApi || (!isComingSoon && app.installed === true);

        return {
            isApi,
            isInstalled,
            isComingSoon,
        };
    }

    private _applyCardState(card: HTMLElement, state: CardState): void {
        card.classList.toggle('is-api', state.isApi);
        card.classList.toggle('is-installed', state.isInstalled);
        card.classList.toggle('is-coming-soon', state.isComingSoon);
    }

    private _injectBadges(clone: DocumentFragment, state: CardState): void {
        const deleteBadge = this._createHtmlFragmentElement(
            this._presentation.getDeleteBadgeHtml(state.isApi, state.isInstalled),
        );
        if (deleteBadge !== null) {
            clone.insertBefore(deleteBadge, clone.firstChild);
        }

        const iconWrapper = clone.querySelector('.app-icon-wrapper');
        const typeBadge = this._createHtmlFragmentElement(
            this._presentation.getTypeBadgeHtml(state.isApi, state.isInstalled),
        );
        if (iconWrapper !== null && typeBadge !== null) {
            clone.insertBefore(typeBadge, iconWrapper);
        }
    }

    private _injectCoreContent(clone: DocumentFragment, app: IApp): void {
        const iconWrapper = clone.querySelector('.app-icon-wrapper');
        if (iconWrapper) {
            iconWrapper.innerHTML = this._presentation.getSanitizedIconMarkup(app);
        }

        const titleEl = clone.querySelector('.app-card-title');
        if (titleEl) titleEl.textContent = this._presentation.getAppName(app);

        const descEl = clone.querySelector('.app-card-desc');
        if (descEl) descEl.textContent = this._presentation.getAppDesc(app);
    }

    private _injectStatusAndActions(
        clone: DocumentFragment,
        app: IApp,
        state: CardState,
        isSelected: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
        onDownload?: (app: IApp) => void,
    ): void {
        const status = this._createHtmlFragmentElement(
            this._getAppStatusHtml(state.isApi, state.isInstalled),
        );
        if (status !== null) {
            clone.appendChild(status);
        }

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'app-card-hover-actions';

        if (state.isComingSoon) {
            actionsContainer.appendChild(buildModuleCardComingSoonButton(this._translate));
        } else if (!state.isInstalled && !state.isApi) {
            actionsContainer.appendChild(
                buildModuleCardDownloadButton(
                    app,
                    {
                        translate: this._translate,
                        getDownloadLabel: () => this._presentation.getDownloadLabel(),
                        getExtractingLabel: () => this._presentation.getExtractingLabel(),
                    },
                    onDownload,
                ),
            );
        } else {
            actionsContainer.appendChild(
                buildModuleCardActionButton(app, isSelected, this._translate, onClick),
            );
        }

        clone.appendChild(actionsContainer);
    }

    /**
     * Updates visual download progress on a `.download-btn` inside a card.
     *
     * @param card    - The `.app-card` element containing the button
     * @param percent - 0-100; pass -1 for indeterminate (connecting state)
     * @param status  - Optional Rust status string; controls label text and pct visibility
     */
    public static setDownloadProgress(card: HTMLElement, percent: number, status?: string): void {
        setModuleCardDownloadProgress(card, percent, status);
    }

    /**
     * Marks a download button in a card as complete and resets its state.
     */
    public static clearDownloadProgress(card: HTMLElement): void {
        clearModuleCardDownloadProgress(card);
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
                    this._tracer?.debug(
                        `[ModuleCardRenderer] Ignored right-click on uninstalled module: ${app.id}`,
                    );
                    return;
                }

                this._tracer?.info('[ModuleCardRenderer] Isolated right-click on module card:', app.id);
                if (this._deps.openModuleSettings !== undefined) {
                    this._deps.openModuleSettings(app);
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
        state: CardState,
        onClick: (e: MouseEvent, app: IApp) => void,
    ): void {
        if (state.isInstalled || state.isApi || state.isComingSoon) {
            return;
        }

        const checkInstalled = this._deps.checkInstalled;
        if (checkInstalled === undefined) {
            return;
        }

        void this._runAsyncInstallCheck(card, app, state.isApi, onClick, checkInstalled);
    }

    private async _runAsyncInstallCheck(
        card: HTMLElement,
        app: IApp,
        isApi: boolean,
        onClick: (e: MouseEvent, app: IApp) => void,
        checkInstalled: (moduleId: string) => Promise<boolean>,
    ): Promise<void> {
        try {
            if (await checkInstalled(app.id)) {
                this._handleAsyncInstallSuccess(card, app, isApi, onClick);
            }
        } catch (err) {
            this._tracer?.debug(
                `[ModuleCardRenderer] Failed to check installation status for ${app.id}: ${String(err)}`,
            );
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

        this._applyInstalledCardAppearance(card);
        this._replaceCardActions(card, buildModuleCardActionButton(app, false, this._translate, onClick));
        this._ensureDeleteBadge(card, isApi);
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

        iconWrapper.innerHTML = this._presentation.getSanitizedIconMarkup(
            app,
            (icon) => `<span class="model-icon-glyph">${icon}</span>`,
        );
    }

    private _updateCardTitle(card: HTMLElement, app: IApp): void {
        const title = card.querySelector('.model-card-title');
        if (!(title instanceof HTMLElement)) return;

        if (['axelate', 'axelate-platform'].includes(app.id)) {
            title.textContent = this._translate('ui.launcher.web.app_title', 'Axelate');
            delete title.dataset['i18n'];
            return;
        }

        title.textContent = this._resolveTranslatedText(title.dataset, app.nameKey, app.name ?? '');
    }

    private _updateCardDesc(card: HTMLElement, app: IApp): void {
        const desc = card.querySelector('.model-card-desc');
        if (!(desc instanceof HTMLElement)) return;

        desc.textContent = this._resolveTranslatedText(desc.dataset, app.descKey, app.desc ?? '');
    }

    public markCardAsInstalled(
        card: HTMLElement,
        app: IApp,
        configureActionBtn: (card: HTMLElement, app: IApp) => void,
    ): void {
        this._applyInstalledCardAppearance(card);

        const overlay = card.querySelector('.app-card-overlay');
        if (overlay !== null) overlay.remove();

        configureActionBtn(card, app);

        this._ensureDeleteBadge(card, this._isApiModule(app));

        // Status badge updates removed as the element is no longer rendered
    }

    private _applyInstalledCardAppearance(card: HTMLElement): void {
        card.classList.remove('has-download');
        card.classList.add('has-launch', 'is-installed');

        const typeBadge = card.querySelector('.app-type-badge');
        if (typeBadge !== null) {
            typeBadge.classList.remove('not-installed');
            typeBadge.classList.add('installed');
        }
    }

    private _replaceCardActions(card: HTMLElement, actionButton: HTMLElement): void {
        const actionsContainer = card.querySelector('.app-card-hover-actions');
        if (actionsContainer === null) {
            return;
        }

        actionsContainer.innerHTML = '';
        actionsContainer.appendChild(actionButton);
    }

    private _ensureDeleteBadge(card: HTMLElement, isApi: boolean): void {
        if (card.querySelector('.app-delete-badge') !== null) {
            return;
        }

        const badge = this._createHtmlFragmentElement(
            this._presentation.getDeleteBadgeHtml(isApi, true),
        );
        if (badge !== null) {
            card.insertAdjacentElement('afterbegin', badge);
        }
    }

    private _resolveTranslatedText(
        dataset: DOMStringMap,
        translationKey: string | undefined,
        fallback: string,
    ): string {
        if ((translationKey ?? '') === '') {
            delete dataset['i18n'];
            return fallback;
        }

        const key = translationKey ?? '';
        dataset['i18n'] = key;
        return this._translate(key, fallback) || fallback;
    }

    private _createHtmlFragmentElement(html: string): Element | null {
        if (html === '') {
            return null;
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this._presentation.sanitizeHtml(html);
        return tempDiv.firstElementChild;
    }

    // --- Helpers ---

    private _isApiModule(app: IApp): boolean {
        return isApiApp(app);
    }

    private _getAppStatusHtml(_isApi: boolean, _isInstalled: boolean): string {
        return '';
    }
}
