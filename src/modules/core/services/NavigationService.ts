/**
 * @module core/services/NavigationService
 * @description Manages application navigation and history
 */

declare global {
    var navigationService: NavigationService;
    var navigate: (pageId: string) => void;
}

// Local types for global access
interface INavigationGlobal {
    navigationService: NavigationService;
    navigate: (pageId: string) => void;
}

export class NavigationService {
    private readonly _historyStack: string[] = [];
    private _currentIndex: number = -1;
    private static _instance: NavigationService;

    private constructor() {
        if (NavigationService._instance) {
             console.warn('[NavigationService] Instance already exists!');
        }
        NavigationService._instance = this;
    }

    /**
     * Refresh current page from loaded uiState
     * Called after uiState.load() completes
     */
    /**
     * Refresh current page from loaded uiState
     * Called after uiState.load() completes
     */
    public refreshFromUiState(): void {
        const win = globalThis as unknown as Window & { uiState?: { getLastPage: () => string } };
        if (win.uiState && typeof win.uiState.getLastPage === 'function') {
            const lastPage = win.uiState.getLastPage();
            if (lastPage) {
                this._historyStack.push(lastPage);
                this._currentIndex = this._historyStack.length - 1;
                console.log(`[NavigationService] Restored last page: ${lastPage}`);
            }
        }
    }

    /**
     * Set the current page.
     */
    public setCurrentPage(pageId: string): void {
        const win = globalThis as unknown as INavigationGlobal;
        win.navigationService = this;
        win.navigate = this.navigate.bind(this);
        this.navigate(pageId);
    }

    /**
     * Navigates to a specific page.
     */
    public navigate(pageId: string): void {
        console.log(`Navigating to: ${pageId}`);
        if (this._currentIndex < this._historyStack.length - 1) {
            this._historyStack.splice(this._currentIndex + 1); // Clear forward history
        }
        this._historyStack.push(pageId);
        this._currentIndex = this._historyStack.length - 1;
    }

    /**
     * Returns the singleton instance of NavigationService.
     */
    public static getInstance(): NavigationService {
        if (!NavigationService._instance) {
            NavigationService._instance = new NavigationService();
        }
        return NavigationService._instance;
    }

    /**
     * Navigates back in history.
     */
    public goBack(): void {
        if (this._currentIndex > 0) {
            this._currentIndex--;
            console.log(`Navigating back to: ${this._historyStack[this._currentIndex]}`);
        }
    }

    /**
     * Navigates forward in history.
     */
    public goForward(): void {
        if (this._currentIndex < this._historyStack.length - 1) {
            this._currentIndex++;
            console.log(`Navigating forward to: ${this._historyStack[this._currentIndex]}`);
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
