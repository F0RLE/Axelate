import DOMPurify from 'dompurify';
import type { IApp } from '../../types/coreTypes';
import type { TGlobalWin } from '../../types/global_bridge_types';
import { logger } from '../../../infrastructure/logging/LoggerService';

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
        ],
        ALLOW_DATA_ATTR: true,
    };

    public createCard(
        app: IApp,
        _category: string,
        onClick: (e: MouseEvent, app: IApp) => void,
    ): HTMLElement {
        const card = document.createElement('div');
        card.className = 'app-card';
        card.dataset['appId'] = app.id;

        const isApi = this._isApiModule(app);
        const isInstalled = isApi ? true : app.installed === true;

        card.classList.toggle('is-api', isApi);
        card.classList.toggle('is-installed', isInstalled);

        const g = globalThis as TGlobalWin;
        const downloadText =
            typeof g.t === 'function' ? g.t('ui.launcher.module.download', 'Download') : 'Download';

        card.innerHTML = DOMPurify.sanitize(
            `
            ${this._getAppDeleteBadgeHtml(isApi, isInstalled)}
            ${this._getAppTypeBadgeHtml(isApi, isInstalled)}
            <div class="app-icon-wrapper">${app.icon ?? '❓'}</div>
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

        card.onclick = (e) => onClick(e, app);

        // Self-Correction: Async check for installation status to handle race conditions (Restored from AppUI history)
        if (!isInstalled && !isApi) {
            const win = globalThis as TGlobalWin;
            if (typeof win.checkModuleInstalled === 'function') {
                void (async (): Promise<void> => {
                    try {
                        const actuallyInstalled = await (
                            win.checkModuleInstalled as (id: string) => Promise<boolean>
                        )(app.id);
                        if (actuallyInstalled) {
                            app.installed = true;

                            card.classList.remove('has-download');
                            card.classList.add('has-launch', 'is-installed');
                            const overlay = card.querySelector('.app-card-overlay');
                            if (overlay) overlay.remove();

                            const typeBadge = card.querySelector('.app-type-badge');
                            if (typeBadge) {
                                typeBadge.classList.remove('not-installed');
                                typeBadge.classList.add('installed');
                            }

                            // Verify and inject delete badge if missing (Fix for intermittent visibility)
                            if (card.querySelector('.app-delete-badge') === null) {
                                // We know it's installed now, so pass true
                                const badgeHtml = this._getAppDeleteBadgeHtml(isApi, true);
                                if (badgeHtml !== '') {
                                    card.insertAdjacentHTML('afterbegin', badgeHtml);
                                }
                            }
                        }
                    } catch (err) {
                        logger.debug(
                            `[ModuleCardRenderer] Failed to check installation status for ${app.id}: ${String(err)}`,
                        );
                    }
                })();
            }
        }

        return card;
    }

    public updateCardAttributes(card: HTMLElement, app: IApp): void {
        card.dataset['currentModule'] = app.id;
        card.dataset['currentModuleName'] = app.name ?? app.id;
        card.dataset['originalHtml'] ??= card.innerHTML;
    }

    public updateCardContent(card: HTMLElement, app: IApp): void {
        this._updateCardIcon(card, app);
        this._updateCardTitle(card, app);
        this._updateCardDesc(card, app);
    }

    private _updateCardIcon(card: HTMLElement, app: IApp): void {
        const iconWrapper = card.querySelector('.model-icon-wrapper');
        if (iconWrapper === null) return;

        iconWrapper.innerHTML = DOMPurify.sanitize(
            `<div>${app.icon ?? '📦'}</div>`,
            this._purifyConfig,
        );
    }

    private _updateCardTitle(card: HTMLElement, app: IApp): void {
        const title = card.querySelector('.model-card-title');
        if (!(title instanceof HTMLElement)) return;

        if (['axelate', 'axelate-platform', 'axelate-localai'].includes(app.id)) {
            const win = globalThis as TGlobalWin;
            title.textContent =
                typeof win.t === 'function'
                    ? win.t('ui.launcher.web.app_title', 'Axelate')
                    : 'Axelate';
            delete title.dataset['i18n'];
            return;
        }

        let titleText = app.name ?? '';
        const win = globalThis as TGlobalWin;
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
        const win = globalThis as TGlobalWin;
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
                card.insertAdjacentHTML('afterbegin', badgeHtml);
            }
        }

        // Status badge updates removed as the element is no longer rendered
    }

    // --- Helpers ---

    private _isApiModule(app: IApp): boolean {
        return (
            app.type?.toLowerCase() === 'api' ||
            ['gpt', 'gemini', 'claude', 'deepseek', 'llama'].includes(app.id)
        );
    }

    private _getAppName(app: IApp): string {
        const key = app.nameKey ?? `ui.launcher.module.${app.id}.name`;
        const g = globalThis as TGlobalWin;
        if (typeof g.t === 'function') return g.t(key, app.name ?? app.id);
        return app.name ?? app.id;
    }

    private _getAppDesc(app: IApp): string {
        const key = app.descKey ?? `ui.launcher.module.${app.id}.desc`;
        const g = globalThis as TGlobalWin;
        if (typeof g.t === 'function') return g.t(key, app.desc ?? '');
        return app.desc ?? '';
    }

    private _getAppTypeBadgeHtml(isApi: boolean, isInstalled: boolean): string {
        const g = globalThis as TGlobalWin;
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
        const win = globalThis as TGlobalWin;
        const deleteText =
            typeof win.t === 'function' ? win.t('ui.launcher.module.delete', 'DELETE') : 'DELETE';

        return `
            <div class="app-delete-badge">
                <div class="badge-icon"><span style="font-size: 1.1rem; line-height: 1;">🗑️</span></div>
                <div class="badge-text">${deleteText}</div>
            </div>
        `;
    }
}
