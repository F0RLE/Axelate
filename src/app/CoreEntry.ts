import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type CoreRuntime = {
    init: () => Promise<void>;
    destroy: () => void;
};

type CoreFactory = () => CoreRuntime;
type EntryLogger = Pick<LoggerService, 'warn' | 'error'>;

let activeCoreInstance: CoreRuntime | null = null;
let coreInitializationInFlight = false;
let coreBootBound = false;
let coreBeforeUnloadBound = false;
let bootHandler: (() => void) | null = null;
let beforeUnloadHandler: (() => void) | null = null;

function clearBootState(): void {
    activeCoreInstance = null;
    coreInitializationInFlight = false;
}

function destroyActiveCoreInstance(): void {
    activeCoreInstance?.destroy();
    clearBootState();
}

function bootCoreOnce(createCore: CoreFactory, tracer: EntryLogger): void {
    if (activeCoreInstance !== null) {
        tracer.warn('[Core] Double init blocked (global singleton already active).');
        return;
    }

    if (coreInitializationInFlight) {
        tracer.warn('[Core] Double init blocked (initialization already in flight).');
        return;
    }

    coreInitializationInFlight = true;

    try {
        const coreInstance = createCore();
        activeCoreInstance = coreInstance;
        coreInitializationInFlight = false;

        coreInstance.init().catch((error: unknown) => {
            if (activeCoreInstance === coreInstance) {
                clearBootState();
            }
            coreInstance.destroy();
            tracer.error(`[Core] Boot failed: ${String(error)}`);
        });
    } catch (error: unknown) {
        clearBootState();
        tracer.error(`[Core] Constructor boot failed: ${String(error)}`);
        throw error;
    }
}

export function bindCoreEntry(createCore: CoreFactory, tracer: EntryLogger): void {
    if (document.readyState === 'loading') {
        if (!coreBootBound) {
            coreBootBound = true;
            bootHandler = () => {
                bootHandler = null;
                bootCoreOnce(createCore, tracer);
            };
            document.addEventListener('DOMContentLoaded', bootHandler, { once: true });
        }
    } else {
        bootCoreOnce(createCore, tracer);
    }

    if (!coreBeforeUnloadBound) {
        coreBeforeUnloadBound = true;
        beforeUnloadHandler = () => {
            destroyActiveCoreInstance();
        };
        globalThis.addEventListener('beforeunload', beforeUnloadHandler);
    }

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            destroyActiveCoreInstance();
            if (bootHandler !== null) {
                document.removeEventListener('DOMContentLoaded', bootHandler);
                bootHandler = null;
            }
            if (beforeUnloadHandler !== null) {
                globalThis.removeEventListener('beforeunload', beforeUnloadHandler);
                beforeUnloadHandler = null;
            }
            coreBootBound = false;
            coreBeforeUnloadBound = false;
        });
    }
}
