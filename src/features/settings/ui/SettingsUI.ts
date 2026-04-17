/**
 * @module settings/ui/SettingsUI
 * @description UI controller for the Settings page itself (launcher/taskbar + monitoring visibility).
 */

import { tracer } from '@/infrastructure/logging/LoggerService';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { GeneralSettingsRenderer } from './GeneralSettingsRenderer';
import type { IAppSettingsUIContext } from './SettingsContext';
import type { SettingsService } from '../services/SettingsService';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';

export class SettingsUI {
    private readonly _generalRenderer: GeneralSettingsRenderer;
    private _context!: IAppSettingsUIContext;
    private _isInitialized = false;
    private _isDestroyed = false;
    private _initAbortController: AbortController | null = null;

    public constructor(
        _service: SettingsService,
        uiSettings: UISettingsService,
        _aiSettings: AISettingsService,
        private readonly _i18nUI: I18nUI,
        _tauri: TauriProvider,
        _navigation: NavigationService,
    ) {
        this._generalRenderer = new GeneralSettingsRenderer(uiSettings);
    }

    public async init(): Promise<void> {
        if (this._isInitialized || this._isDestroyed) return;
        this._isInitialized = true;
        this._initAbortController = new AbortController();

        const win = getGlobalWin();
        this._context = {
            t: win.t ?? ((_: string, d?: string) => d ?? ''),
            showToast:
                win.showToast ??
                ((message: string) => {
                    tracer.info(message);
                }),
            toggleNavItem: (id: string, enabled: boolean) => {
                this._generalRenderer.toggleNavItem(id, enabled);
            },
            toggleMonitorItem: (id: string, enabled: boolean) => {
                this._generalRenderer.toggleMonitorItem(id, enabled);
            },
            i18nUI: this._i18nUI,
        };

        const container = await this._waitForContainer(
            'settings-grid',
            5000,
            this._initAbortController.signal,
        );

        if (container === null) {
            if (this._isDestroyed || this._initAbortController.signal.aborted) {
                return;
            }
            tracer.error(
                '[SettingsUI] Settings container "settings-grid" not found after 5s. Rendering failed.',
            );
            return;
        }

        tracer.info('[SettingsUI] Settings container found. Initializing renderers.');
        this._generalRenderer.init(this._context);
    }

    public close(): void {
        // App settings page has no modal lifecycle to close.
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;
        this._initAbortController?.abort();
        this._initAbortController = null;
        this._generalRenderer.destroy();
        tracer.info('[SettingsUI] Destroyed.');
    }

    private async _waitForContainer(
        id: string,
        timeoutMs: number,
        signal: AbortSignal,
    ): Promise<HTMLElement | null> {
        const existing = document.getElementById(id);
        if (existing instanceof HTMLElement) {
            return existing;
        }

        return await new Promise<HTMLElement | null>((resolve) => {
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            let observer: MutationObserver | null = null;

            const cleanup = () => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                observer?.disconnect();
                observer = null;
                signal.removeEventListener('abort', handleAbort);
            };

            const finish = (element: HTMLElement | null) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve(element);
            };

            const handleAbort = () => {
                finish(null);
            };

            const handleMutations = () => {
                const container = document.getElementById(id);
                if (container instanceof HTMLElement) {
                    finish(container);
                }
            };

            if (signal.aborted) {
                finish(null);
                return;
            }

            signal.addEventListener('abort', handleAbort, { once: true });
            timeoutId = setTimeout(() => {
                finish(null);
            }, timeoutMs);

            observer = new MutationObserver(handleMutations);
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        });
    }
}
