import type { IApp } from '../../types/coreTypes';
import type { TGlobalWin } from '../../types/global_bridge_types';
import { logger } from '@/infrastructure/logging/LoggerService';
import { type ModuleCardRenderer } from './ModuleCardRenderer';

/**
 * @class ModalManager
 * @description Handles the App Selection modal and other potential overlays.
 */
export class ModalManager {
    private readonly _cardRenderer: ModuleCardRenderer;
    private _currentCategory: string | null = null;
    private _currentApps: IApp[] = [];

    // Callback for app interactions (Download, Delete, Select)
    private readonly _onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void;

    constructor(
        cardRenderer: ModuleCardRenderer,
        onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void,
    ) {
        this._cardRenderer = cardRenderer;
        this._onAppInteraction = onAppInteraction;
    }

    // --- App Selection Modal ---

    public openAppSelection(category: string, apps: IApp[]): void {
        const modal = document.getElementById('app-selection-modal');
        const listEl = document.getElementById('app-modal-list');

        logger.info(
            `[ModalManager] Opening selection modal for ${category} with ${String(apps.length)} items.`,
        );

        if (modal === null || listEl === null) return;

        this._currentCategory = category;
        this._currentApps = apps;

        this._updateAppModalTitle(category);
        this._populateAppList(listEl, apps, category);

        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Close on overlay click
        const closeOnOverlay = (e: MouseEvent): void => {
            if (e.target === modal) {
                this.closeAppSelection();
                modal.removeEventListener('click', closeOnOverlay);
            }
        };
        modal.addEventListener('click', closeOnOverlay);
    }

    public closeAppSelection(): void {
        const modal = document.getElementById('app-selection-modal');
        if (modal !== null) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
    }

    public refreshCurrentSelection(): void {
        if (this._currentCategory !== null && this._currentApps.length > 0) {
            const modal = document.getElementById('app-selection-modal');
            if (modal !== null && !modal.classList.contains('hidden')) {
                this.openAppSelection(this._currentCategory, this._currentApps);
            }
        }
    }

    // --- Helpers ---

    private _updateAppModalTitle(category: string): void {
        const titleEl = document.getElementById('app-modal-title');
        if (titleEl === null) return;

        const key =
            category === 'ai'
                ? 'ui.launcher.modules.modal.ai_title'
                : 'ui.launcher.modules.modal.services_title';
        const defaultText = category === 'ai' ? 'Select AI Module' : 'Select Service';
        const win = globalThis as TGlobalWin;

        titleEl.textContent = typeof win.t === 'function' ? win.t(key, defaultText) : defaultText;
    }

    private _populateAppList(listEl: HTMLElement, apps: IApp[], category: string): void {
        listEl.innerHTML = '';
        const sorted = this._getSortedApps(apps);

        sorted.forEach((app) => {
            const card = this._cardRenderer.createCard(app, category, (e, a) =>
                this._onAppInteraction(e, a, category),
            );
            listEl.appendChild(card);
        });
    }

    private _getSortedApps(apps: IApp[]): IApp[] {
        const priority = ['axelate', 'gpt', 'gemini'];
        return [...apps].sort((a, b) => {
            const nameA = (a.name ?? '').toLowerCase();
            const nameB = (b.name ?? '').toLowerCase();
            const getP = (n: string): number => {
                const idx = priority.findIndex((p) => n.includes(p));
                return idx === -1 ? 999 : idx;
            };
            const priorityDiff = getP(nameA) - getP(nameB);
            if (priorityDiff !== 0) return priorityDiff;
            return nameA.localeCompare(nameB);
        });
    }
}
