import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type CoreRuntime = {
    init: () => Promise<void>;
    destroy: () => void;
};

type CoreFactory = () => CoreRuntime;
type EntryLogger = Pick<LoggerService, 'error'>;

type CoreEntryState = {
    activeCoreInstance: CoreRuntime | null;
    coreInitializationInFlight: boolean;
    coreBootBound: boolean;
    coreBeforeUnloadBound: boolean;
    bootHandler: (() => void) | null;
    beforeUnloadHandler: (() => void) | null;
};

const CORE_ENTRY_STATE_KEY = '__AXELATE_CORE_ENTRY_STATE__';

function getCoreEntryState(): CoreEntryState {
    const runtime = globalThis as typeof globalThis & {
        [CORE_ENTRY_STATE_KEY]?: CoreEntryState;
    };

    runtime[CORE_ENTRY_STATE_KEY] ??= {
        activeCoreInstance: null,
        coreInitializationInFlight: false,
        coreBootBound: false,
        coreBeforeUnloadBound: false,
        bootHandler: null,
        beforeUnloadHandler: null,
    };

    return runtime[CORE_ENTRY_STATE_KEY];
}

function clearBootState(): void {
    const state = getCoreEntryState();
    state.activeCoreInstance = null;
    state.coreInitializationInFlight = false;
}

function destroyActiveCoreInstance(): void {
    const state = getCoreEntryState();
    try {
        state.activeCoreInstance?.destroy();
    } finally {
        clearBootState();
    }
}

function bootCoreOnce(createCore: CoreFactory, tracer: EntryLogger): void {
    const state = getCoreEntryState();

    if (state.activeCoreInstance !== null) {
        return;
    }

    if (state.coreInitializationInFlight) {
        return;
    }

    state.coreInitializationInFlight = true;

    try {
        const coreInstance = createCore();
        state.activeCoreInstance = coreInstance;
        state.coreInitializationInFlight = false;

        coreInstance.init().catch((error: unknown) => {
            if (state.activeCoreInstance === coreInstance) {
                clearBootState();
            }
            try {
                coreInstance.destroy();
            } catch (destroyError: unknown) {
                tracer.error(`[Core] Destroy after boot failure failed: ${String(destroyError)}`);
            }
            tracer.error(`[Core] Boot failed: ${String(error)}`);
        });
    } catch (error: unknown) {
        clearBootState();
        tracer.error(`[Core] Constructor boot failed: ${String(error)}`);
        throw error;
    }
}

export function bindCoreEntry(createCore: CoreFactory, tracer: EntryLogger): void {
    const state = getCoreEntryState();

    if (document.readyState === 'loading') {
        if (!state.coreBootBound) {
            state.coreBootBound = true;
            state.bootHandler = () => {
                state.bootHandler = null;
                bootCoreOnce(createCore, tracer);
            };
            document.addEventListener('DOMContentLoaded', state.bootHandler, { once: true });
        }
    } else {
        bootCoreOnce(createCore, tracer);
    }

    if (!state.coreBeforeUnloadBound) {
        state.coreBeforeUnloadBound = true;
        state.beforeUnloadHandler = () => {
            destroyActiveCoreInstance();
        };
        globalThis.addEventListener('beforeunload', state.beforeUnloadHandler);
    }

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            destroyActiveCoreInstance();
            if (state.bootHandler !== null) {
                document.removeEventListener('DOMContentLoaded', state.bootHandler);
                state.bootHandler = null;
            }
            if (state.beforeUnloadHandler !== null) {
                globalThis.removeEventListener('beforeunload', state.beforeUnloadHandler);
                state.beforeUnloadHandler = null;
            }
            state.coreBootBound = false;
            state.coreBeforeUnloadBound = false;
        });
    }
}
