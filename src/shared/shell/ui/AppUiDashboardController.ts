import type { IApp } from '@/shared/types/coreTypes';

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
    openModuleSettings: (app: IApp) => void;
    clearModuleCard: (category: string) => void;
    removeSelectedModule: (category: string) => void;
    openAppSelection: (category: string) => void;
    updateMultiSlotBadge: () => void;
};

export class AppUiDashboardController {
    private static readonly _DASHBOARD_CARD_SELECTOR =
        '#ai-module-card, #services-module-card';

    private _pendingDashboardSwitchTimer: ReturnType<typeof setTimeout> | null = null;
    private _pendingDashboardSwitchCard: HTMLElement | null = null;

    constructor(private readonly _deps: AppUiDashboardControllerDeps) {}

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
        if (!(card instanceof HTMLElement)) return;

        card.querySelector('.module-action-badge.stack')?.remove();

        const sharedAiState = this._deps.selectionState.getSharedAiCardState(card);
        if (sharedAiState === null) return;

        const badge = this._deps.chrome.createStackBadge(
            sharedAiState.secondaryApp.name ?? sharedAiState.secondaryApp.id,
            () => {
                this._deps.openAppSelection(sharedAiState.openCapability);
            },
        );

        card.appendChild(badge);
    }

    private readonly _boundDashboardContextMenu = (e: Event) => {
        const card = this._resolveDashboardCardFromEvent(e);
        if (!(card instanceof HTMLElement)) return;
        if (!card.classList.contains('selected')) return;

        const category = this._deps.selectionState.resolveCategoryFromCard(card);
        const app = this._deps.selectionState.get(category);
        if (app === undefined) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        this._deps.tracer.info(`[AppUI] Right-click settings for ${category}:`, app.id);
        this._deps.openModuleSettings(app);
    };

    private readonly _boundDashboardMouseDown = (e: Event) => {
        const mouseEvent = e as MouseEvent;
        const card = this._resolveDashboardCardFromEvent(mouseEvent);
        if (!(card instanceof HTMLElement)) return;
        if (!card.classList.contains('selected')) return;

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
        if (card?.classList.contains('selected') !== true) return;

        const textApp = this._deps.selectionState.get('ai_text');
        const imageApp = this._deps.selectionState.get('ai_image');
        if (textApp === undefined || imageApp === undefined) return;

        const shownModule = card.dataset['currentModule'];
        const nextCategory = wheelEvent.deltaY < 0 ? 'ai_text' : 'ai_image';
        const nextApp = nextCategory === 'ai_text' ? textApp : imageApp;
        if (shownModule === nextApp.id) return;

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

            this._deps.cardRenderer.updateCardContent(card, nextApp);
            this._deps.cardRenderer.updateCardAttributes(card, nextApp, nextCategory);
            this._deps.updateMultiSlotBadge();
            this._resetDashboardSwitchStyles(card);
        }, 150);
    };

    private _resolveDashboardCardFromEvent(event: Event): HTMLElement | null {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return null;
        }

        const card = target.closest(AppUiDashboardController._DASHBOARD_CARD_SELECTOR);
        return card instanceof HTMLElement ? card : null;
    }

    private _resetDashboardSwitchStyles(card: HTMLElement | null): void {
        if (!(card instanceof HTMLElement)) return;

        card.style.removeProperty('transition');
        card.style.removeProperty('opacity');
        card.style.removeProperty('transform');
    }
}
