import DOMPurify from 'dompurify';
import type { IApp } from '../../types/coreTypes';
import { getGlobalWin } from '../../utils/globalAccessor';
import { tracer } from '../../../infrastructure/logging/LoggerService';

export class AppUiChrome {
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
            'symbol',
            'line',
            'path',
            'polyline',
            'polygon',
            'rect',
            'circle',
            'ellipse',
        ],
        ALLOWED_ATTR: [
            'href',
            'class',
            'style',
            'viewBox',
            'width',
            'height',
            'fill',
            'stroke',
            'stroke-width',
            'stroke-linecap',
            'stroke-linejoin',
            'd',
            'points',
            'x',
            'y',
            'x1',
            'y1',
            'x2',
            'y2',
            'cx',
            'cy',
            'r',
            'rx',
            'ry',
        ],
        ALLOW_DATA_ATTR: true,
    };

    public translate(key: string, fallback: string): string {
        const win = getGlobalWin();
        return typeof win.t === 'function' ? win.t(key, fallback) : fallback;
    }

    public ensureActionFeedback(): HTMLElement {
        let feedback = document.getElementById('action-feedback');
        if (feedback instanceof HTMLElement) {
            return feedback;
        }

        feedback = document.createElement('div');
        feedback.className = 'action-feedback';
        feedback.id = 'action-feedback';
        feedback.innerHTML = this._sanitize(this.translate('ui.feedback', ''));
        document.body.appendChild(feedback);
        return feedback;
    }

    public createSettingsBadge(
        app: IApp,
        onOpenSettings: (app: IApp) => void,
    ): HTMLDivElement {
        const badge = this.createActionBadge(
            'module-action-badge left settings',
            `
            <div class="badge-icon"><span style="font-size: 1.1rem;">⚙️</span></div>
            <div class="badge-text" data-i18n="ui.launcher.module.settings_short">${this.translate('ui.launcher.module.settings_short', 'Settings')}</div>
        `,
        );

        badge.addEventListener('click', (event) => {
            event.stopPropagation();
            event.stopImmediatePropagation();
            tracer.info('[AppUiChrome] Settings button clicked for:', app.id);
            onOpenSettings(app);
        });
        badge.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        return badge;
    }

    public createCloseBadge(
        category: string,
        onClose: (category: string) => void,
    ): HTMLDivElement {
        const badge = this.createActionBadge(
            'module-action-badge right close',
            `
            <div class="badge-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
            <div class="badge-text" data-i18n="ui.launcher.module.remove_short">${this.translate('ui.launcher.module.remove_short', 'Close')}</div>
        `,
        );

        badge.onclick = (event): void => {
            event.stopImmediatePropagation();
            onClose(category);
        };

        return badge;
    }

    public createStackBadge(
        label: string,
        onOpenSelection: () => void,
    ): HTMLDivElement {
        const badge = this.createActionBadge(
            'module-action-badge bottom-right stack',
            `
            <div class="badge-text">${label}</div>
            <div class="badge-icon">+1</div>
        `,
        );

        badge.addEventListener('click', (event) => {
            event.stopPropagation();
            event.stopImmediatePropagation();
            onOpenSelection();
        });

        badge.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        return badge;
    }

    public createActionBadge(className: string, html: string): HTMLDivElement {
        const badge = document.createElement('div');
        badge.className = className;
        badge.innerHTML = this._sanitize(html);
        return badge;
    }

    private _sanitize(html: string): string {
        return DOMPurify.sanitize(html, this._purifyConfig);
    }
}
