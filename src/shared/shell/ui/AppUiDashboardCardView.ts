import type { IApp } from '../../types/coreTypes';
import type { AppUiChrome } from './AppUiChrome';
import type { ModuleCardRenderer } from './ModuleCardRenderer';

type AppUiDashboardCardViewDeps = {
    chrome: AppUiChrome;
    cardRenderer: ModuleCardRenderer;
    isApiModule: (app: IApp) => boolean;
    openModuleSettings: (app: IApp) => void;
    clearModuleCard: (category: string) => void;
    removeSelectedModule: (category: string) => void;
};

export class AppUiDashboardCardView {
    public constructor(private readonly _deps: AppUiDashboardCardViewDeps) {}

    public getCardId(category: string): string {
        if (category === 'ai' || category.startsWith('ai_')) {
            return 'ai-module-card';
        }

        return 'services-module-card';
    }

    public resolveCatalogCategory(category: string): string {
        return category.startsWith('ai') ? 'ai' : category;
    }

    public resolveModalCategory(category: string): string {
        return category === 'ai' ? 'ai_text' : category;
    }

    public getDashboardCard(category: string): HTMLElement | null {
        const card = document.getElementById(this.getCardId(category));
        return card instanceof HTMLElement ? card : null;
    }

    public applySelectedCardState(card: HTMLElement, app: IApp, category: string): void {
        this._deps.cardRenderer.updateCardAttributes(card, app, category);
        card.classList.remove('empty');
        card.classList.add('selected');
        this._deps.cardRenderer.updateCardContent(card, app);
        this._configureActionButton(card, app);
        this._refreshCardActions(card, app, category);
    }

    public resetCardToEmpty(card: HTMLElement): void {
        card.classList.remove('selected', 'has-download', 'has-launch');
        card.classList.add('empty');
        delete card.dataset['currentModule'];
        delete card.dataset['currentModuleName'];
        delete card.dataset['currentCapability'];

        const originalHtml = card.dataset['originalHtml'];
        if (originalHtml !== undefined && originalHtml !== '') {
            card.innerHTML = originalHtml;
        }
    }

    public markCardAsInstalled(card: HTMLElement, app: IApp): void {
        this._deps.cardRenderer.markCardAsInstalled(card, app, (currentCard, currentApp) => {
            this._configureActionButton(currentCard, currentApp);
        });
    }

    private _configureActionButton(card: HTMLElement, app: IApp): void {
        let actionButton = card.querySelector<HTMLElement>('.model-card-action');

        if (actionButton === null) {
            actionButton = document.createElement('div');
            actionButton.className = 'model-card-action';
            actionButton.id =
                card.id === 'ai-module-card' ? 'ai-module-add-btn' : 'services-module-add-btn';
            actionButton.dataset['i18n'] = 'ui.launcher.button.launch';
            card.appendChild(actionButton);
        }

        const isApi = this._deps.isApiModule(app);
        const isInstalled = app.installed !== false;

        actionButton.style.display = 'none';
        actionButton.classList.remove('download-module-btn', 'active-module-btn', 'has-download');

        if (!isApi && !isInstalled) {
            return;
        }
    }

    private _refreshCardActions(card: HTMLElement, app: IApp, category: string): void {
        card.querySelectorAll('.module-action-badge').forEach((element) => {
            element.remove();
        });

        const settingsButton = this._deps.chrome.createSettingsBadge(app, (targetApp) => {
            this._deps.openModuleSettings(targetApp);
        });
        card.appendChild(settingsButton);

        const closeButton = this._deps.chrome.createCloseBadge(category, (resolvedCategory) => {
            this._deps.clearModuleCard(resolvedCategory);
            this._deps.removeSelectedModule(resolvedCategory);
        });
        card.appendChild(closeButton);
    }
}
