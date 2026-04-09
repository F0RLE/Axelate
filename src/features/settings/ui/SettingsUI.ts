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

        let attempts = 0;
        let container = document.getElementById('settings-grid');
        while (container === null && attempts < 50) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            container = document.getElementById('settings-grid');
            attempts++;
        }

        if (container === null) {
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
        this._generalRenderer.destroy();
        tracer.info('[SettingsUI] Destroyed.');
    }
}
