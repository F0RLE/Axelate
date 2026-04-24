import type { IApp } from '../../types/coreTypes';
import { CategoryKey } from '../../types/categoryKeys';
import { supportsModuleSettings } from '../../utils/moduleSettingsSupport';
import {
    isAiCategory,
    resolveCatalogCategory as resolveCatalogCategoryKey,
    resolveModalCategory as resolveModalCategoryKey,
} from '../../utils/moduleCategoryPolicy';

import type { AppUiSelectionState } from './AppUiSelectionState';
import type { ModuleCardRenderer } from './ModuleCardRenderer';
import type { AppUiChrome } from './AppUiChrome';

type DashboardTracer = {
    info: (message: string, ...args: unknown[]) => void;
};

type AppUiDashboardControllerDeps = {
    tracer: DashboardTracer;
    chrome: AppUiChrome;
    cardRenderer: ModuleCardRenderer;
    selectionState: AppUiSelectionState;
    isApiModule: (app: IApp) => boolean;
    openModuleSettings: (app: IApp) => void;
    clearModuleCard: (category: string) => void;
    removeSelectedModule: (category: string) => void;
    openAppSelection: (category: string) => void;
    updateMultiSlotBadge: () => void;
    activateAiSlot: (category: 'ai_text' | 'ai_image', app: IApp) => void;
};

export class AppUiDashboardSupport {
    private static readonly _DASHBOARD_CARD_SELECTOR = '#ai-module-card, #services-module-card';

    private _pendingDashboardSwitchTimer: ReturnType<typeof setTimeout> | null = null;
    private _pendingDashboardSwitchCard: HTMLElement | null = null;

    public constructor(private readonly _deps: AppUiDashboardControllerDeps) {}

    public initListeners(): void {
        document.body.addEventListener('contextmenu', this._boundDashboardContextMenu);
        document.body.addEventListener('mousedown', this._boundDashboardMouseDown);
        document.body.addEventListener('wheel', this._boundDashboardWheel, { passive: false });
    }

    public destroy(): void {
        this.cancelPendingSwitch();
        document.body.removeEventListener('contextmenu', this._boundDashboardContextMenu);
        document.body.removeEventListener('mousedown', this._boundDashboardMouseDown);
        document.body.removeEventListener('wheel', this._boundDashboardWheel);
    }

    public cancelPendingSwitch(): void {
        if (this._pendingDashboardSwitchTimer !== null) {
            globalThis.clearTimeout(this._pendingDashboardSwitchTimer);
            this._pendingDashboardSwitchTimer = null;
        }

        this._resetDashboardSwitchStyles(this._pendingDashboardSwitchCard);
        this._pendingDashboardSwitchCard = null;
    }

    public updateMultiSlotBadge(): void {
        const card = document.getElementById('ai-module-card');
        if (!(card instanceof HTMLElement)) {
            return;
        }

        card.querySelector('.module-action-badge.stack')?.remove();

        const sharedAiState = this._deps.selectionState.getSharedAiCardState(card);
        if (sharedAiState === null) {
            return;
        }

        const badge = this._deps.chrome.createStackBadge(
            sharedAiState.secondaryApp.name ?? sharedAiState.secondaryApp.id,
            () => {
                this._deps.openAppSelection(sharedAiState.openCapability);
            },
        );

        card.appendChild(badge);
    }

    public getCardId(category: string): string {
        if (isAiCategory(category)) {
            return 'ai-module-card';
        }

        return 'services-module-card';
    }

    public resolveCatalogCategory(category: string): string {
        return resolveCatalogCategoryKey(category);
    }

    public resolveModalCategory(category: string): string {
        return resolveModalCategoryKey(category);
    }

    public getDashboardCard(category: string): HTMLElement | null {
        const card = document.getElementById(this.getCardId(category));
        return card instanceof HTMLElement ? card : null;
    }

    public applySelectedCardState(card: HTMLElement, app: IApp, category: string): void {
        this._deps.cardRenderer.updateSlotCardAttributes(card, app, category);
        card.classList.remove('empty');
        card.classList.add('selected');
        this._deps.cardRenderer.updateSlotCardContent(card, app);
        this._deps.cardRenderer.updateSlotCardRuntimeStatus(card, app.status);
        this._configureActionButton(card, app);
        this._refreshCardActions(card, app, category);
    }

    public resetCardToEmpty(card: HTMLElement): void {
        card.classList.remove(
            'selected',
            'has-download',
            'has-launch',
            'module-running',
            'module-stopped',
        );
        card.classList.add('empty');
        delete card.dataset['currentModule'];
        delete card.dataset['currentModuleName'];
        delete card.dataset['currentCapability'];
        delete card.dataset['runtimeStatus'];

        const originalHtml = card.dataset['originalHtml'];
        if (originalHtml !== undefined && originalHtml !== '') {
            card.innerHTML = originalHtml;
        }
    }

    public markSlotCardAsInstalled(card: HTMLElement, app: IApp): void {
        this._deps.cardRenderer.markSlotCardAsInstalled(card, app, (currentCard, currentApp) => {
            this._configureActionButton(currentCard, currentApp);
        });
    }

    public updateRuntimeStatus(category: string, app: IApp, status: string): void {
        app.status = status;

        const card = this.getDashboardCard(category);
        if (!(card instanceof HTMLElement)) {
            return;
        }

        if (card.dataset['currentModule'] !== app.id) {
            return;
        }

        this._deps.cardRenderer.updateSlotCardRuntimeStatus(card, status);
    }

    private readonly _boundDashboardContextMenu = (e: Event) => {
        const card = this._resolveDashboardCardFromEvent(e);
        if (!(card instanceof HTMLElement)) {
            return;
        }
        if (!card.classList.contains('selected')) {
            return;
        }

        const category = this._deps.selectionState.resolveCategoryFromCard(card);
        const app = this._deps.selectionState.get(category);
        if (app === undefined) {
            return;
        }

        if (!supportsModuleSettings(app)) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        this._deps.tracer.info(`[AppUI] Right-click settings for ${category}:`, app.id);
        this._deps.openModuleSettings(app);
    };

    private readonly _boundDashboardMouseDown = (e: Event) => {
        const mouseEvent = e as MouseEvent;
        const card = this._resolveDashboardCardFromEvent(mouseEvent);
        if (!(card instanceof HTMLElement)) {
            return;
        }
        if (!card.classList.contains('selected')) {
            return;
        }

        if (mouseEvent.button === 1) {
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
            const category = this._deps.selectionState.resolveCategoryFromCard(card);
            this._deps.tracer.info(`[AppUI] Middle-click close for ${category}`);
            this._deps.clearModuleCard(category);
            this._deps.removeSelectedModule(category);
        } else if (mouseEvent.button === 2) {
            mouseEvent.stopPropagation();
            mouseEvent.stopImmediatePropagation();
        }
    };

    private readonly _boundDashboardWheel = (e: Event) => {
        const wheelEvent = e as WheelEvent;
        const target = wheelEvent.target as HTMLElement;
        const card = target.closest<HTMLElement>('#ai-module-card');
        if (card?.classList.contains('selected') !== true) {
            return;
        }

        const textApp = this._deps.selectionState.get(CategoryKey.AI_TEXT);
        const imageApp = this._deps.selectionState.get(CategoryKey.AI_IMAGE);
        if (textApp === undefined || imageApp === undefined) {
            return;
        }

        const shownModule = card.dataset['currentModule'];
        const nextCategory = wheelEvent.deltaY < 0 ? CategoryKey.AI_TEXT : CategoryKey.AI_IMAGE;
        const nextApp = nextCategory === CategoryKey.AI_TEXT ? textApp : imageApp;
        if (shownModule === nextApp.id) {
            return;
        }

        wheelEvent.preventDefault();
        this.cancelPendingSwitch();

        card.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateY(4px)';
        this._pendingDashboardSwitchCard = card;

        this._pendingDashboardSwitchTimer = globalThis.setTimeout(() => {
            this._pendingDashboardSwitchTimer = null;
            this._pendingDashboardSwitchCard = null;

            const currentNextApp = this._deps.selectionState.get(nextCategory);
            if (
                !card.isConnected ||
                !card.classList.contains('selected') ||
                currentNextApp?.id !== nextApp.id
            ) {
                this._resetDashboardSwitchStyles(card);
                return;
            }

            this.applySelectedCardState(card, nextApp, nextCategory);
            this._deps.updateMultiSlotBadge();
            this._deps.activateAiSlot(nextCategory, nextApp);
            this._resetDashboardSwitchStyles(card);
        }, 150);
    };

    private _configureActionButton(card: HTMLElement, app: IApp): void {
        let actionButton = card.querySelector<HTMLElement>('.module-slot-card-action');

        if (actionButton === null) {
            actionButton = document.createElement('div');
            actionButton.className = 'module-slot-card-action';
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

        if (supportsModuleSettings(app)) {
            const settingsButton = this._deps.chrome.createSettingsBadge(app, (targetApp) => {
                this._deps.openModuleSettings(targetApp);
            });
            card.appendChild(settingsButton);
        }

        const closeButton = this._deps.chrome.createCloseBadge(category, (resolvedCategory) => {
            this._deps.clearModuleCard(resolvedCategory);
            this._deps.removeSelectedModule(resolvedCategory);
        });
        card.appendChild(closeButton);
    }

    private _resolveDashboardCardFromEvent(event: Event): HTMLElement | null {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return null;
        }

        const card = target.closest(AppUiDashboardSupport._DASHBOARD_CARD_SELECTOR);
        return card instanceof HTMLElement ? card : null;
    }

    private _resetDashboardSwitchStyles(card: HTMLElement | null): void {
        if (!(card instanceof HTMLElement)) {
            return;
        }

        card.style.removeProperty('transition');
        card.style.removeProperty('opacity');
        card.style.removeProperty('transform');
    }
}
