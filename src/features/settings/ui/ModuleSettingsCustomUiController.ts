import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { IApp } from '@/shared/types/coreTypes';

type TranslateFn = (key: string, defaultValue?: string) => string;

type SettingsSnapshot = Partial<{
    language: string;
    theme: string;
}>;

type SettingsServiceLike = {
    getSettings(): unknown;
};

type ModuleSettingsCustomUiLogger = Pick<LoggerService, 'error'>;
type ModuleSettingsCustomUiTauri = Pick<TauriProvider, 'invoke' | 'isTauri'>;

type ModuleSettingsCustomUiControllerDeps = {
    service: SettingsServiceLike;
    tauri: ModuleSettingsCustomUiTauri;
    translate: TranslateFn;
    registerCleanup: (cleanup: () => void) => void;
    tracer: ModuleSettingsCustomUiLogger;
};

type ActiveIframeSession = {
    frame: HTMLIFrameElement;
    disposed: boolean;
    hostShellLoaded: boolean;
    cleanup: Array<() => void>;
};

const HOST_CHANNEL = 'axelate:module-settings-host';
const HOST_FRAME_LOAD_TIMEOUT_MS = 8_000;
const WINDOWS_MODULE_SETTINGS_ORIGIN = 'http://module-settings.localhost';
const DEFAULT_MODULE_SETTINGS_ORIGIN = 'module-settings://localhost';
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

export class ModuleSettingsCustomUiController {
    private _activeSession: ActiveIframeSession | null = null;

    public constructor(private readonly _deps: ModuleSettingsCustomUiControllerDeps) {}

    public async render(container: HTMLElement, app: IApp): Promise<void> {
        this._disposeActiveSession();

        container.innerHTML = '';
        container.classList.add('module-settings-custom-ui-active');
        container
            .closest('.module-settings-content')
            ?.classList.add('module-settings-content-custom-ui');
        container
            .closest('#module-settings-modal')
            ?.classList.add('module-settings-modal-custom-ui');

        const shell = document.createElement('div');
        shell.className = 'module-settings-webui-shell';

        const frameShell = document.createElement('div');
        frameShell.className = 'module-settings-webui-frame-shell';

        const status = document.createElement('div');
        status.className = 'module-settings-webui-status';
        status.dataset['state'] = 'loading';
        status.textContent = this._deps.translate(
            'ui.settings.custom_ui_loading',
            'Loading module settings…',
        );

        frameShell.append(status);
        shell.appendChild(frameShell);
        container.appendChild(shell);

        if (!this._deps.tauri.isTauri()) {
            this._showFailure(status, new Error('Tauri runtime is unavailable'));
            return;
        }

        const lifecycle = { disposed: false };
        let session: ActiveIframeSession | null = null;
        this._deps.registerCleanup(() => {
            lifecycle.disposed = true;
            if (session !== null) {
                void this._disposeSession(session);
            }
        });

        try {
            const sessionToken = await this._deps.tauri.invoke<string>(
                'create_module_settings_session',
                {
                    moduleId: app.id,
                },
            );

            if (lifecycle.disposed) {
                return;
            }

            // The embedded host iframe already owns loading and error rendering.
            // Keep the launcher overlay until the host shell itself is ready.
            // Otherwise the user only sees a blank dark iframe while the
            // custom protocol document is still booting.
            session = this._createSession(frameShell, app, sessionToken, status);
            this._activeSession = session;
        } catch (error) {
            this._showFailure(status, error);
        }
    }

    private _createSession(
        frameShell: HTMLElement,
        app: IApp,
        sessionToken: string,
        status: HTMLElement,
    ): ActiveIframeSession {
        const frame = document.createElement('iframe');
        frame.className = 'module-settings-webui-frame';
        frame.title = `${app.name ?? app.id} settings`;
        frame.referrerPolicy = 'no-referrer';

        const session: ActiveIframeSession = {
            frame,
            disposed: false,
            hostShellLoaded: false,
            cleanup: [],
        };

        const clearBootTimeout = (() => {
            const timeoutId = globalThis.setTimeout(() => {
                if (session.disposed) {
                    return;
                }

                this._showFailure(
                    status,
                    new Error('Module settings host timed out while loading'),
                );
            }, HOST_FRAME_LOAD_TIMEOUT_MS);

            return () => {
                globalThis.clearTimeout(timeoutId);
            };
        })();

        const markHostReady = () => {
            if (session.disposed) {
                return;
            }

            clearBootTimeout();
            session.hostShellLoaded = true;
            status.classList.add('hidden');
        };

        const markHostFailed = (error: Error) => {
            if (session.disposed) {
                return;
            }

            clearBootTimeout();

            // Once the host shell has loaded, the iframe owns all loading and
            // failure rendering. Keeping the launcher overlay visible would
            // duplicate the host error state on top of the iframe.
            if (session.hostShellLoaded) {
                this._deps.tracer.error(
                    `[ModuleSettingsCustomUiController] Host reported custom settings UI failure after shell load: ${this._stringifyError(error)}`,
                );
                status.classList.add('hidden');
                return;
            }

            this._showFailure(status, error);
        };

        const allowedOrigin = this._resolveModuleSettingsOrigin();
        const handleMessage = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow) {
                return;
            }

            if (event.origin !== allowedOrigin) {
                return;
            }

            if (!this._isHostPayload(event.data)) {
                return;
            }

            if (event.data.type === 'host-ready' || event.data.type === 'module-rendered') {
                markHostReady();
                return;
            }

            if (event.data.type === 'host-error') {
                markHostFailed(new Error(event.data.message ?? 'Module settings host failed'));
            }
        };

        const handleLoad = () => {
            markHostReady();
        };

        const handleError = () => {
            markHostFailed(new Error('Failed to load module settings host'));
        };

        globalThis.addEventListener('message', handleMessage);
        frame.addEventListener('load', handleLoad);
        frame.addEventListener('error', handleError);
        session.cleanup.push(() => {
            clearBootTimeout();
            globalThis.removeEventListener('message', handleMessage);
            frame.removeEventListener('load', handleLoad);
            frame.removeEventListener('error', handleError);
        });

        frame.src = this._buildHostUrl(app, sessionToken);
        frameShell.prepend(frame);
        return session;
    }

    private _isHostPayload(
        payload: unknown,
    ): payload is { channel: typeof HOST_CHANNEL; type: string; message?: string } {
        return (
            typeof payload === 'object' &&
            payload !== null &&
            (payload as { channel?: unknown }).channel === HOST_CHANNEL &&
            typeof (payload as { type?: unknown }).type === 'string'
        );
    }

    private _buildHostUrl(app: IApp, sessionToken: string): string {
        const safeSessionToken = this._validateSessionToken(sessionToken);
        const settings = this._deps.service.getSettings() as SettingsSnapshot;
        const hostUrl = new URL(
            `/session/${safeSessionToken}/host/index.html`,
            this._resolveModuleSettingsOrigin(),
        );
        hostUrl.searchParams.set('moduleId', app.id);
        hostUrl.searchParams.set('name', app.name ?? app.id);
        hostUrl.searchParams.set('category', app.category ?? '');
        hostUrl.searchParams.set('type', app.type ?? '');
        hostUrl.searchParams.set('settingsUi', app.settingsUi ?? '');
        hostUrl.searchParams.set('language', settings.language ?? 'en');
        hostUrl.searchParams.set('theme', settings.theme ?? 'dark');

        return hostUrl.href;
    }

    private _resolveModuleSettingsOrigin(): string {
        return navigator.userAgent.includes('Windows')
            ? WINDOWS_MODULE_SETTINGS_ORIGIN
            : DEFAULT_MODULE_SETTINGS_ORIGIN;
    }

    private _validateSessionToken(sessionToken: string): string {
        if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
            throw new Error('Invalid module settings session token');
        }

        return sessionToken;
    }

    private _disposeActiveSession(): void {
        if (this._activeSession === null) {
            return;
        }

        this._disposeSession(this._activeSession);
        this._activeSession = null;
    }

    private _disposeSession(session: ActiveIframeSession): void {
        if (session.disposed) {
            return;
        }

        session.disposed = true;
        session.cleanup.splice(0).forEach((cleanup) => {
            cleanup();
        });

        session.frame.src = 'about:blank';
        session.frame.remove();

        if (this._activeSession === session) {
            this._activeSession = null;
        }
    }

    private _showFailure(status: HTMLElement, error: unknown): void {
        this._deps.tracer.error(
            `[ModuleSettingsCustomUiController] Failed to prepare custom settings UI: ${this._stringifyError(error)}`,
        );
        status.dataset['state'] = 'error';
        status.classList.remove('hidden');
        status.textContent = this._deps.translate(
            'ui.settings.custom_ui_failed',
            'Failed to load module settings UI.',
        );
    }

    private _stringifyError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    }
}
