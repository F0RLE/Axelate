/**
 * @module core/services/NavigationService
 * @description Manages application navigation and history
 */

import { getGlobalWin } from '@/shared/utils/globalAccessor';

import { type UISettingsService } from '@/shared/services/ui/UISettingsService';

import { logger } from '@/infrastructure/logging/LoggerService';

export class NavigationService {
    private readonly _historyStack: string[] = [];
    private readonly _actionStack: {
        id: string;
        action: () => void;
        forwardAction?: () => void;
    }[] = [];
    private readonly _forwardActionStack: {
        id: string;
        action: () => void;
        forwardAction: () => void;
    }[] = [];
    private _currentIndex = -1;
    private static _instance: NavigationService | undefined;
    private _uiSettingsService: UISettingsService | null = null;

    private constructor() {
        if (NavigationService._instance !== undefined) {
            logger.warn('[NavigationService] Instance already exists!');
        }
        NavigationService._instance = this;
    }

    public setUISettingsService(uiSettingsService: UISettingsService): void {
        this._uiSettingsService = uiSettingsService;
    }

    /**
     * Refresh current page from loaded uiState.
     * Called after uiState.load() completes.
     */
    public refreshFromUiState(): void {
        const win = getGlobalWin();
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
     * @param isHistoryNav - If true, avoids modifying the _historyStack (used primarily by UI to sync state)
     */
    public setCurrentPage(pageId: string, isHistoryNav = false): void {
        if (isHistoryNav) {
            // Still update user preferences even if we're just navigating through history
            if (this._uiSettingsService !== null) {
                this._uiSettingsService.setLastPage(pageId);
            }
            return;
        }

        this.navigate(pageId);
    }

    /**
     * Navigates to a specific page.
     */
    public navigate(pageId: string): void {
        logger.info(`[NavigationService] Navigating to: ${pageId}`);
        this.clearForwardActions();
        if (this._currentIndex < this._historyStack.length - 1) {
            this._historyStack.splice(this._currentIndex + 1); // Clear forward history
        }
        this._historyStack.push(pageId);
        this._currentIndex = this._historyStack.length - 1;

        if (this._uiSettingsService !== null) {
            this._uiSettingsService.setLastPage(pageId);
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
    public goBack(): string | undefined {
        if (this._currentIndex > 0) {
            this._currentIndex--;
            const backPage = this._historyStack[this._currentIndex];
            logger.info(`[NavigationService] Navigating back to: ${String(backPage)}`);
            return backPage;
        }
        return undefined;
    }

    /**
     * Navigates forward in history.
     */
    public goForward(): string | undefined {
        if (this._currentIndex < this._historyStack.length - 1) {
            this._currentIndex++;
            const forwardPage = this._historyStack[this._currentIndex];
            logger.info(`[NavigationService] Navigating forward to: ${String(forwardPage)}`);
            return forwardPage;
        }
        return undefined;
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

    /**
     * Pushes a new action to the back stack.
     * This is useful for modals, dropdowns, etc. that should be closed when the user presses "Back" or "Escape".
     * @param forwardAction Optional callback to restore this state when "Forward" is pressed.
     */
    public pushBackAction(id: string, action: () => void, forwardAction?: () => void): void {
        this.removeBackAction(id);
        const entry: { id: string; action: () => void; forwardAction?: () => void } = {
            id,
            action,
        };
        if (forwardAction) {
            entry.forwardAction = forwardAction;
        }
        this._actionStack.push(entry);
        logger.debug(`[NavigationService] Pushed back action: ${id}`);
    }

    /**
     * Removes an action from the back stack by its ID.
     */
    public removeBackAction(id: string): void {
        const index = this._actionStack.findIndex((a) => a.id === id);
        if (index !== -1) {
            this._actionStack.splice(index, 1);
            logger.debug(`[NavigationService] Removed back action: ${id}`);
        }
    }

    /**
     * Pops the top action from the back stack and executes it.
     * Returns true if an action was executed, false otherwise.
     */
    public popBackAction(): boolean {
        if (this._actionStack.length > 0) {
            const actionInfo = this._actionStack.pop();
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (actionInfo) {
                logger.debug(`[NavigationService] Executing back action: ${actionInfo.id}`);

                if (actionInfo.forwardAction) {
                    // Safe to cast because we checked for forwardAction existence
                    this._forwardActionStack.push(
                        actionInfo as { id: string; action: () => void; forwardAction: () => void },
                    );
                }

                actionInfo.action();
                return true;
            }
        }
        return false;
    }

    /**
     * Pops and executes the top action from the forward stack.
     * Returns true if an action was executed.
     */
    public popForwardAction(): boolean {
        if (this._forwardActionStack.length > 0) {
            const actionInfo = this._forwardActionStack.pop();
            if (actionInfo) {
                logger.debug(`[NavigationService] Executing forward action: ${actionInfo.id}`);
                actionInfo.forwardAction();
                return true;
            }
        }
        return false;
    }

    /**
     * Clears all forward actions. Used when standard navigation destroys forward state.
     */
    public clearForwardActions(): void {
        if (this._forwardActionStack.length > 0) {
            this._forwardActionStack.length = 0;
            logger.debug('[NavigationService] Cleared forward actions stack');
        }
    }
}
