import DOMPurify from 'dompurify';
import { BaseComponent } from '../BaseComponent';

/**
 * @abstract AsyncView
 * @description A base class for components that handle asynchronous data loading.
 */
export abstract class AsyncView<T> extends BaseComponent {
    protected _data: T | null = null;
    protected _error: Error | null = null;
    protected _isLoading = false;

    /**
     * Default initialization triggers a data refresh.
     */
    protected async onInit(): Promise<void> {
        await this.refresh();
    }

    /**
     * Refreshes the data by calling fetchData and updating states.
     */
    public async refresh(): Promise<void> {
        this._isLoading = true;
        this._error = null;
        this.render();

        try {
            this._data = await this.fetchData();
        } catch (err) {
            this._error = err instanceof Error ? err : new Error(String(err));
        } finally {
            this._isLoading = false;
            this.render();
        }
    }

    /**
     * Implementation-specific data fetching.
     */
    protected abstract fetchData(): Promise<T>;

    /**
     * Renders the current state into the container.
     */
    public render(): void {
        const container = this.getContainer();
        if (!container) return;

        if (this._isLoading) {
            container.innerHTML = DOMPurify.sanitize(this.renderLoading());
        } else if (this._error) {
            container.innerHTML = DOMPurify.sanitize(this.renderError(this._error));
        } else if (this._data !== null) {
            container.innerHTML = DOMPurify.sanitize(this.renderReady(this._data));
        }
    }

    /**
     * Cleanup is handled by BaseComponent, we just clear our state.
     */
    protected onDestroy(): void {
        this._data = null;
        this._error = null;
    }

    protected abstract getContainer(): HTMLElement | null;
    protected abstract renderLoading(): string;
    protected abstract renderError(error: Error): string;
    protected abstract renderReady(data: T): string;
}
