import DOMPurify from 'dompurify';
import type { IApp } from '../../types/coreTypes';

type PurifyConfig = {
    ALLOWED_TAGS: string[];
    ALLOWED_ATTR: string[];
    ALLOW_DATA_ATTR: boolean;
};
type Translate = (key: string, fallback: string) => string;

export class ModuleCardPresentationHelper {
    public constructor(
        private readonly _purifyConfig: PurifyConfig,
        private readonly _translate: Translate,
    ) {}

    public getAppName(app: IApp): string {
        const previewTitle = app.preview?.title?.trim();
        if (previewTitle !== undefined && previewTitle !== '') {
            return previewTitle;
        }

        const key = app.nameKey ?? `ui.launcher.module.${app.id}.name`;
        return this._translate(key, app.name ?? app.id);
    }

    public getAppDesc(app: IApp): string {
        const previewDescription = app.preview?.description?.trim();
        if (previewDescription !== undefined && previewDescription !== '') {
            return previewDescription;
        }

        const key = app.descKey ?? `ui.launcher.module.${app.id}.desc`;
        return this._translate(key, app.desc ?? '');
    }

    public getSanitizedIconMarkup(
        app: IApp,
        wrap?: (icon: string) => string,
        fallback = '❓',
    ): string {
        if (app.preview?.image !== undefined && app.preview.image !== null) {
            const image = app.preview.image.trim();
            if (image !== '') {
                return DOMPurify.sanitize(
                    `<img class="module-card-preview-image" src="${image}" alt="" aria-hidden="true">`,
                    this._purifyConfig,
                );
            }
        }

        const icon = app.preview?.sticker ?? app.icon ?? fallback;
        const markup = wrap?.(icon) ?? icon;
        return DOMPurify.sanitize(markup, this._purifyConfig);
    }

    public getTypeBadgeHtml(isApi: boolean, isInstalled: boolean): string {
        const text = this._translate(
            isApi ? 'ui.launcher.badge.cloud' : 'ui.launcher.badge.local',
            isApi ? 'CLOUD' : 'LOCAL',
        );
        const iconHtml = isApi
            ? '<span style="font-size: 1.1rem;">☁️</span>'
            : '<span style="font-size: 1.1rem;">🏠</span>';
        const defaultClass = isApi ? 'api' : 'local';
        const installClass = isApi || isInstalled ? 'installed' : 'not-installed';

        return `
            <div class="app-type-badge ${defaultClass} ${installClass}">
                <div class="badge-text">${text}</div>
                <div class="badge-icon">${iconHtml}</div>
            </div>
        `;
    }

    public getDeleteBadgeHtml(isApi: boolean, isInstalled: boolean): string {
        if (isApi || !isInstalled) {
            return '';
        }

        const deleteText = this._translate('ui.launcher.module.delete', 'DELETE');

        return `
            <div class="app-delete-badge">
                <div class="badge-icon">
                    <span style="font-size: 1.1rem; line-height: 1;">🗑️</span>
                </div>
                <div class="badge-text">${deleteText}</div>
            </div>
        `;
    }

    public getDownloadLabel(): string {
        return this._translate('ui.launcher.module.download', 'Download');
    }

    public getExtractingLabel(): string {
        const rawText = this._translate('ui.launcher.module.extracting', 'Extracting').replace(
            /\.+$/,
            '',
        );

        return typeof rawText === 'string' ? rawText : 'Extracting';
    }

    public sanitizeHtml(html: string): string {
        return DOMPurify.sanitize(html, this._purifyConfig);
    }
}
