/**
 * @module core/services/EventBus
 * @description Centralized, type-safe event emitter for decoupled component communication
 */

/**
 * Global application event map and payloads.
 */
export interface IEventBusEvents {
    // Navigation
    /** Emitted when an application page changes. */
    'page:change': { pageId: string; previousPageId?: string };
    /** Emitted when a page is fully loaded and ready for interaction. */
    'page:ready': { pageId: string };

    // Modules
    /** Emitted when a module download begins. */
    'module:download:start': { moduleId: string; url: string };
    /** Emitted with progress updates for an active download. */
    'module:download:progress': { moduleId: string; percent: number };
    /** Emitted when a module has been successfully downloaded and extracted. */
    'module:download:complete': { moduleId: string };
    /** Emitted if a module download or extraction fails. */
    'module:download:error': { moduleId: string; error: string };
    /** Emitted when a module's operational status changes. */
    'module:status:change': { moduleId: string; status: string };

    // Window
    /** Emitted when the application window is minimized. */
    'window:minimize': undefined;
    /** Emitted when the application window is maximized. */
    'window:maximize': undefined;
    /** Emitted when the application window is closing. */
    'window:close': undefined;
    /** Emitted when the application window receives focus. */
    'window:focus': undefined;
    /** Emitted when the application window loses focus. */
    'window:blur': undefined;

    // I18n
    /** Emitted when the active language changed. */
    'i18n:language:change': { lang: string; previousLang: string };
    /** Emitted when translations for a specific language are loaded. */
    'i18n:translations:loaded': { lang: string };

    // Errors
    /** Emitted when a global uncaught error is captured. */
    'error:global': { error: Error; context?: string };
    /** Emitted when a network request fails specifically in a way that needs UI feedback. */
    'error:network': { url: string; status: number; message: string };

    // System
    /** Emitted with system monitor updates (polling). */
    'system:stats:update': unknown;

    // App Selection
    /** Emitted when the app selection modal is opened for a category. */
    'app:selection:open': { category: string };
    /** Emitted when the app selection modal is closed. */
    'app:selection:close': undefined;
    /** Emitted when an app is selected from the gallery. */
    'app:selection:select': { category: string; appId: string };

    /** Generic fallback for dynamic or custom events. */
    [key: string]: unknown;
}

/** Function signature for event handlers. */
export type EventHandler<T = unknown> = (_data: T) => void;

/**
 * Implementation of the global event bus.
 * Provides type-safe subscription and publication of events.
 */
class EventBus {
    private readonly _listeners = new Map<string, Set<EventHandler>>();
    private readonly _onceListeners = new Map<string, Set<EventHandler>>();

    /**
     * Subscribes to an event.
     * @returns Unsubscribe function
     */
    public on<K extends keyof IEventBusEvents>(
        event: K,
        handler: EventHandler<IEventBusEvents[K]>,
    ): () => void {
        const eventKey = event as string;
        let handlers = this._listeners.get(eventKey);
        if (!handlers) {
            handlers = new Set();
            this._listeners.set(eventKey, handlers);
        }
        handlers.add(handler as EventHandler);

        return () => {
            this.off(event, handler);
        };
    }

    /**
     * Subscribes to an event once (automatically unbinds after execution).
     * @returns Unsubscribe function
     */
    public once<K extends keyof IEventBusEvents>(
        event: K,
        handler: EventHandler<IEventBusEvents[K]>,
    ): () => void {
        const eventKey = event as string;
        let handlers = this._onceListeners.get(eventKey);
        if (!handlers) {
            handlers = new Set();
            this._onceListeners.set(eventKey, handlers);
        }
        handlers.add(handler as EventHandler);

        return () => {
            this._onceListeners.get(eventKey)?.delete(handler as EventHandler);
        };
    }

    /**
     * Emits an event with optional data to all subscribers.
     */
    public emit<K extends keyof IEventBusEvents>(event: K, data?: IEventBusEvents[K]): void {
        const eventKey = event as string;

        // Regular listeners
        const handlers = this._listeners.get(eventKey);
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`[EventBus] Error in handler for "${eventKey}":`, error);
                }
            });
        }

        // Once listeners
        const onceHandlers = this._onceListeners.get(eventKey);
        if (onceHandlers) {
            onceHandlers.forEach((handler) => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`[EventBus] Error in once-handler for "${eventKey}":`, error);
                }
            });
            this._onceListeners.delete(eventKey);
        }
    }

    /**
     * Unsubscribes a specific handler from an event.
     */
    public off<K extends keyof IEventBusEvents>(
        event: K,
        handler: EventHandler<IEventBusEvents[K]>,
    ): void {
        const eventKey = event as string;
        this._listeners.get(eventKey)?.delete(handler as EventHandler);
        this._onceListeners.get(eventKey)?.delete(handler as EventHandler);
    }

    /**
     * Removes all listeners for a specific event or all events if no key is provided.
     */
    public clear(event?: keyof IEventBusEvents): void {
        if (event) {
            const eventKey = event as string;
            this._listeners.delete(eventKey);
            this._onceListeners.delete(eventKey);
        } else {
            this._listeners.clear();
            this._onceListeners.clear();
        }
    }

    /**
     * Returns the number of active listeners for an event.
     */
    public listenerCount(event: keyof IEventBusEvents): number {
        const eventKey = event as string;
        return (
            (this._listeners.get(eventKey)?.size || 0) +
            (this._onceListeners.get(eventKey)?.size || 0)
        );
    }
}

/**
 * Global singleton instance of the EventBus.
 */
export const eventBus = new EventBus();
