import '@/styles/app.css';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { createCoreAssembly, type CoreAssembly } from './CoreAssembly';
import { bindCoreEntry } from './CoreEntry';

export class Core {
    private readonly _assembly: CoreAssembly;
    private _isDestroyed = false;
    private _isInitialized = false;
    private _initPromise: Promise<void> | null = null;
    private readonly _boundGlobalShortcutKeydown = (e: KeyboardEvent) => {
        const forbiddenKeys = ['F3', 'F7', 'F1'];
        if (forbiddenKeys.includes(e.key)) {
            e.preventDefault();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && ['f', 'p', 's'].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }
    };

    constructor() {
        tracer.init();

        this._assembly = createCoreAssembly({
            core: this,
            tracer,
            state: {
                isDestroyed: () => this._isDestroyed,
            },
            globalShortcutKeydown: this._boundGlobalShortcutKeydown,
        });
    }

    /**
     * Executes the core initialization sequence with hardened survival logic.
     */
    public async init(): Promise<void> {
        if (this._isInitialized) return;
        if (this._initPromise !== null) {
            await this._initPromise;
            return;
        }

        const initPromise = this._runInit();
        this._initPromise = initPromise;
        try {
            await initPromise;
            if (this._initPromise === initPromise && !this._isDestroyed) {
                this._isInitialized = true;
            }
        } finally {
            if (this._initPromise === initPromise) {
                this._initPromise = null;
            }
        }
    }

    private async _runInit(): Promise<void> {
        await this._assembly.lifecycleController.runInit();
    }

    public async destroy(): Promise<void> {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;
        this._initPromise = null;
        await this._assembly.lifecycleController.destroy();
    }
}
bindCoreEntry(() => new Core(), tracer);
