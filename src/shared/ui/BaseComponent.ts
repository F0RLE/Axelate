import { tracer } from '@/infrastructure/logging/LoggerService';

/**
 * @abstract BaseComponent
 * @description Standardized lifecycle for Vanilla TS components.
 */
export abstract class BaseComponent {
    protected _isInit = false;
    protected readonly _elementCache = new Map<string, HTMLElement | null>();
    protected _abortController: AbortController | null = null;

    /**
     * Initializes the component and its dependencies.
     */
    public async init(..._args: unknown[]): Promise<void> {
        if (this._isInit) return;
        this._isInit = true;
        this._abortController = new AbortController();

        try {
            await this.onInit();
        } catch (err) {
            tracer.error(`[${this.constructor.name}] Init failed:`, err);
        }
    }

    /**
     * Cleans up the component, listeners, and caches.
     */
    public destroy(): void {
        if (!this._isInit) return;

        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }

        try {
            this.onDestroy();
        } catch (err) {
            tracer.error(`[${this.constructor.name}] Destroy failed:`, err);
        }

        this._elementCache.clear();
        this._isInit = false;
    }

    /**
     * Hook called during initialization.
     */
    protected abstract onInit(): void | Promise<void>;

    /**
     * Hook called during destruction.
     */
    protected abstract onDestroy(): void;

    /**
     * Cached element lookup by ID.
     */
    protected getElement<T extends HTMLElement>(id: string): T | null {
        const cached = this._elementCache.get(id);
        if (cached !== undefined) return cached as T | null;

        const el = document.getElementById(id);
        if (el) {
            this._elementCache.set(id, el);
        }
        return el as T | null;
    }

    /**
     * Checks if an element is currently visible in the DOM.
     */
    protected isVisible(id: string): boolean {
        const el = this.getElement(id);
        return el !== null && el.offsetParent !== null;
    }
}
