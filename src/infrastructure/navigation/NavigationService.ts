/**
 * @module core/services/NavigationService
 * @description Manages application navigation and history
 */

import type { TGlobalWin } from '@/shared/types/global_bridge_types';

import { type StateService } from '@/shared/services/StateService';

import { logger } from '@/infrastructure/logging/LoggerService';

export class NavigationService {
    private readonly _historyStack: string[] = [];
    private _currentIndex = -1;
    private static _instance: NavigationService | undefined;
    private _stateService: StateService | null = null;

    private constructor() {
        if (NavigationService._instance !== undefined) {
            logger.warn('[NavigationService] Instance already exists!');
        }
        NavigationService._instance = this;
    }

    public setStateService(stateService: StateService): void {
        this._stateService = stateService;
    }

    /**
     * Refresh current page from loaded uiState.
     * Called after uiState.load() completes.
     */
    public refreshFromUiState(): void {
        const win = globalThis as TGlobalWin;
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition
        if (win.uiState && typeof win.uiState.last_page === 'string') {
            const lastPage = win.uiState.last_page;
            if (lastPage !== '') {
                this._historyStack.push(lastPage);
                this._currentIndex = this._historyStack.length - 1;
                logger.info(`[NavigationService] Restored last page: ${lastPage}`);
            }
        }
    }

    /**
     * Set the current page.
     */
    public setCurrentPage(pageId: string): void {
        this.navigate(pageId);
    }

    /**
     * Navigates to a specific page.
     */
    public navigate(pageId: string): void {
        logger.info(`[NavigationService] Navigating to: ${pageId}`);
        if (this._currentIndex < this._historyStack.length - 1) {
            this._historyStack.splice(this._currentIndex + 1); // Clear forward history
        }
        this._historyStack.push(pageId);
        this._currentIndex = this._historyStack.length - 1;

        if (this._stateService !== null) {
            this._stateService.setLastPage(pageId);
        }
    }

    /**
     * Returns the singleton instance of NavigationService.
     */
    public static getInstance(): NavigationService {
        NavigationService._instance ??= new NavigationService();
        return NavigationService._instance;
    }

    /**
     * Navigates back in history.
     */
    public goBack(): void {
        if (this._currentIndex > 0) {
            this._currentIndex--;
            logger.info(
                `[NavigationService] Navigating back to: ${String(this._historyStack[this._currentIndex])}`,
            );
        }
    }

    /**
     * Navigates forward in history.
     */
    public goForward(): void {
        if (this._currentIndex < this._historyStack.length - 1) {
            this._currentIndex++;
            logger.info(
                `[NavigationService] Navigating forward to: ${String(this._historyStack[this._currentIndex])}`,
            );
        }
    }

    /**
     * Returns the current page ID.
     */
    public getCurrentPage(): string | undefined {
        if (this._currentIndex >= 0 && this._currentIndex < this._historyStack.length) {
            return this._historyStack[this._currentIndex];
        }
        return undefined;
    }
}
