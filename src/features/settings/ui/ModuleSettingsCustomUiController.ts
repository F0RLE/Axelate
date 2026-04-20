import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IApp } from '@/shared/types/coreTypes';
import { convertFileSrc } from '@tauri-apps/api/core';

type TranslateFn = (key: string, defaultValue?: string) => string;
type ShowToastFn = (
    message: string,
    type?: string,
    duration?: number,
    title?: string | null,
) => void;

type ModuleSettingsMessageMethod =
    | 'getContext'
    | 'getSettings'
    | 'saveSettings'
    | 'markDirty'
    | 'notify';

type ModuleSettingsBridgeRequest = {
    channel: 'axelate:module-settings';
    requestId: string;
    method: ModuleSettingsMessageMethod;
    payload?: unknown;
};

type ModuleSettingsBridgeResponse = {
    channel: 'axelate:module-settings';
    requestId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
};

type ModuleSettingsHostReadyMessage = {
    channel: 'axelate:module-settings';
    type: 'host-ready';
    context: Record<string, unknown>;
    settings: Record<string, unknown>;
};

type ModuleSettingsClientReadyMessage = {
    channel: 'axelate:module-settings';
    type: 'module-ready';
};

type SettingsSnapshot = Partial<{
    language: string;
    theme: string;
}>;

type SettingsServiceLike = {
    getSettings(): unknown;
    getModuleSettings(moduleId: string): Promise<Record<string, unknown>>;
    saveModuleSettings(moduleId: string, settings: Record<string, unknown>): Promise<void>;
    getModuleSettingsUiEntryPath(moduleId: string): Promise<string>;
};
type ModuleSettingsCustomUiLogger = Pick<LoggerService, 'error'>;

type ModuleSettingsCustomUiControllerDeps = {
    service: SettingsServiceLike;
    translate: TranslateFn;
    registerCleanup: (cleanup: () => void) => void;
    showDirtyIndicator: () => void;
    showSavedIndicator: () => void;
    hideSavedIndicator: () => void;
    showToast: ShowToastFn;
    tracer: ModuleSettingsCustomUiLogger;
};

export class ModuleSettingsCustomUiController {
    public constructor(private readonly _deps: ModuleSettingsCustomUiControllerDeps) {}

    public async render(container: HTMLElement, app: IApp): Promise<void> {
        container.innerHTML = '';
        container.classList.add('module-settings-custom-ui-active');
        container
            .closest('.module-settings-content')
            ?.classList.add('module-settings-content-custom-ui');

        const shell = document.createElement('div');
        shell.className = 'module-settings-webui-shell';

        const frameShell = document.createElement('div');
        frameShell.className = 'module-settings-webui-frame-shell';

        const status = document.createElement('div');
        status.className = 'module-settings-webui-status';
        status.textContent = this._deps.translate(
            'ui.settings.custom_ui_loading',
            'Loading module settings UI...',
        );

        const iframe = document.createElement('iframe');
        iframe.className = 'module-settings-webui-frame';
        iframe.title = `${app.name ?? app.id} settings`;
        iframe.setAttribute(
            'sandbox',
            'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads',
        );
        iframe.setAttribute('referrerpolicy', 'no-referrer');

        frameShell.append(status, iframe);
        shell.appendChild(frameShell);
        container.appendChild(shell);

        try {
            const [entryPath, settings] = await Promise.all([
                this._deps.service.getModuleSettingsUiEntryPath(app.id),
                this._deps.service.getModuleSettings(app.id),
            ]);
            const frameUrl = new URL(convertFileSrc(entryPath));
            const expectedOrigin = frameUrl.origin;
            const context = this._buildContext(app);

            const handleLoad = () => {
                status.classList.add('hidden');
                this._postHostReady(iframe, expectedOrigin, context, settings);
            };

            const handleError = () => {
                status.dataset['state'] = 'error';
                status.classList.remove('hidden');
                status.textContent = this._deps.translate(
                    'ui.settings.custom_ui_failed',
                    'Failed to load module settings UI.',
                );
            };

            const handleMessage = (event: MessageEvent<unknown>) => {
                void this._handleMessage(event, iframe, expectedOrigin, app, context);
            };

            iframe.addEventListener('load', handleLoad);
            iframe.addEventListener('error', handleError);
            globalThis.addEventListener('message', handleMessage);

            this._deps.registerCleanup(() => {
                iframe.removeEventListener('load', handleLoad);
                iframe.removeEventListener('error', handleError);
                globalThis.removeEventListener('message', handleMessage);
                iframe.src = 'about:blank';
            });

            iframe.src = frameUrl.toString();
        } catch (error) {
            this._deps.tracer.error(
                '[ModuleSettingsCustomUiController] Failed to prepare custom settings UI:',
                error,
            );
            status.dataset['state'] = 'error';
            status.textContent = this._deps.translate(
                'ui.settings.custom_ui_failed',
                'Failed to load module settings UI.',
            );
        }
    }

    private _buildContext(app: IApp): Record<string, unknown> {
        const settings = this._deps.service.getSettings() as SettingsSnapshot;
        return {
            bridgeVersion: 1,
            module: {
                id: app.id,
                name: app.name ?? app.id,
                category: app.category ?? '',
                type: app.type ?? '',
                settingsUi: app.settingsUi ?? null,
            },
            launcher: {
                language: settings.language ?? 'en',
                theme: settings.theme ?? 'dark',
            },
        };
    }

    private _postHostReady(
        iframe: HTMLIFrameElement,
        targetOrigin: string,
        context: Record<string, unknown>,
        settings: Record<string, unknown>,
    ): void {
        iframe.contentWindow?.postMessage(
            {
                channel: 'axelate:module-settings',
                type: 'host-ready',
                context,
                settings,
            } satisfies ModuleSettingsHostReadyMessage,
            targetOrigin,
        );
    }

    private async _handleMessage(
        event: MessageEvent<unknown>,
        iframe: HTMLIFrameElement,
        expectedOrigin: string,
        app: IApp,
        context: Record<string, unknown>,
    ): Promise<void> {
        if (event.source !== iframe.contentWindow || event.origin !== expectedOrigin) {
            return;
        }

        if (this._isClientReady(event.data)) {
            const settings = await this._deps.service.getModuleSettings(app.id);
            this._postHostReady(iframe, expectedOrigin, context, settings);
            return;
        }

        if (!this._isRequest(event.data)) {
            return;
        }

        const responseWindow = iframe.contentWindow;
        if (responseWindow === null) {
            return;
        }

        try {
            const result = await this._processRequest(event.data, app, context);
            responseWindow.postMessage(
                {
                    channel: 'axelate:module-settings',
                    requestId: event.data.requestId,
                    ok: true,
                    result,
                } satisfies ModuleSettingsBridgeResponse,
                expectedOrigin,
            );
        } catch (error) {
            this._deps.tracer.error(
                '[ModuleSettingsCustomUiController] Custom settings bridge failed:',
                error,
            );
            responseWindow.postMessage(
                {
                    channel: 'axelate:module-settings',
                    requestId: event.data.requestId,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                } satisfies ModuleSettingsBridgeResponse,
                expectedOrigin,
            );
        }
    }

    private _isRequest(data: unknown): data is ModuleSettingsBridgeRequest {
        if (typeof data !== 'object' || data === null) {
            return false;
        }

        const candidate = data as Partial<ModuleSettingsBridgeRequest>;
        return (
            candidate.channel === 'axelate:module-settings' &&
            typeof candidate.requestId === 'string' &&
            typeof candidate.method === 'string'
        );
    }

    private _isClientReady(data: unknown): data is ModuleSettingsClientReadyMessage {
        if (typeof data !== 'object' || data === null) {
            return false;
        }

        const candidate = data as Partial<ModuleSettingsClientReadyMessage>;
        return candidate.channel === 'axelate:module-settings' && candidate.type === 'module-ready';
    }

    private async _processRequest(
        request: ModuleSettingsBridgeRequest,
        app: IApp,
        context: Record<string, unknown>,
    ): Promise<unknown> {
        switch (request.method) {
            case 'getContext':
                return context;
            case 'getSettings':
                return await this._deps.service.getModuleSettings(app.id);
            case 'saveSettings': {
                const settings = this._normalizeSettingsPayload(request.payload);
                await this._deps.service.saveModuleSettings(app.id, settings);
                this._deps.showSavedIndicator();
                globalThis.setTimeout(() => {
                    this._deps.hideSavedIndicator();
                }, 1200);
                return settings;
            }
            case 'markDirty':
                this._deps.showDirtyIndicator();
                return { dirty: true };
            case 'notify':
                this._showNotification(request.payload);
                return { shown: true };
            default:
                throw new Error('Unsupported custom settings method');
        }
    }

    private _normalizeSettingsPayload(payload: unknown): Record<string, unknown> {
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
            throw new Error('saveSettings expects a plain object payload');
        }

        return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    }

    private _showNotification(payload: unknown): void {
        if (typeof payload !== 'object' || payload === null) {
            return;
        }

        const data = payload as {
            message?: unknown;
            kind?: unknown;
        };

        if (typeof data.message !== 'string' || data.message.trim() === '') {
            return;
        }

        this._deps.showToast(data.message, typeof data.kind === 'string' ? data.kind : 'info');
    }
}
