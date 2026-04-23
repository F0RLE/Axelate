import { invoke } from '@tauri-apps/api/core';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
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

type ModuleSettingsCustomUiControllerDeps = {
    service: SettingsServiceLike;
    translate: TranslateFn;
    registerCleanup: (cleanup: () => void) => void;
    tracer: ModuleSettingsCustomUiLogger;
};

type WebviewBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type ActiveWebviewSession = {
    webview: Webview;
    frameShell: HTMLElement;
    zoom: number;
    appliedZoom: number | null;
    disposed: boolean;
    syncScheduled: boolean;
    cleanup: Array<() => void>;
};

export class ModuleSettingsCustomUiController {
    private _activeSession: ActiveWebviewSession | null = null;

    public constructor(private readonly _deps: ModuleSettingsCustomUiControllerDeps) {}

    public async render(container: HTMLElement, app: IApp): Promise<void> {
        await this._disposeActiveSession();

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
        status.className = 'module-settings-webui-status hidden';

        frameShell.append(status);
        shell.appendChild(frameShell);
        container.appendChild(shell);

        if (!this._canUseNativeWebview()) {
            this._showFailure(status, new Error('Tauri runtime is unavailable'));
            return;
        }

        const lifecycle = { disposed: false };
        let session: ActiveWebviewSession | null = null;
        this._deps.registerCleanup(() => {
            lifecycle.disposed = true;
            if (session !== null) {
                void this._disposeSession(session);
            }
        });

        try {
            session = await this._createSession(frameShell, app);
            if (lifecycle.disposed) {
                await this._disposeSession(session);
                return;
            }

            this._activeSession = session;
            status.classList.add('hidden');
        } catch (error) {
            this._showFailure(status, error);
        }
    }

    private _canUseNativeWebview(): boolean {
        const runtime = globalThis as Record<string, unknown>;
        return '__TAURI_INTERNALS__' in runtime || '__TAURI__' in runtime;
    }

    private async _createSession(
        frameShell: HTMLElement,
        app: IApp,
    ): Promise<ActiveWebviewSession> {
        await this._waitForNextFrame();
        await this._waitForModalLayout(frameShell);

        const zoom = await this._readCurrentZoom();
        const bounds = await this._measureReadyBounds(frameShell, zoom);
        const label = this._buildWebviewLabel(app.id);
        const webview = await this._createWebview(label, this._buildWebviewUrl(app), bounds);

        const session: ActiveWebviewSession = {
            webview,
            frameShell,
            zoom,
            appliedZoom: null,
            disposed: false,
            syncScheduled: false,
            cleanup: [],
        };

        const scheduleLayoutSync = () => {
            this._scheduleLayoutSync(session);
        };

        if (typeof ResizeObserver === 'function') {
            const resizeObserver = new ResizeObserver(() => {
                scheduleLayoutSync();
            });
            resizeObserver.observe(frameShell);
            session.cleanup.push(() => {
                resizeObserver.disconnect();
            });
        }

        const handleWindowResize = () => {
            scheduleLayoutSync();
        };
        globalThis.addEventListener('resize', handleWindowResize);
        session.cleanup.push(() => {
            globalThis.removeEventListener('resize', handleWindowResize);
        });

        const handleZoomChange = (event: Event) => {
            const nextZoom = this._readZoomFromEvent(event);
            if (nextZoom === null) {
                return;
            }

            session.zoom = nextZoom;
            scheduleLayoutSync();
        };
        globalThis.addEventListener('axelate:zoom-changed', handleZoomChange as EventListener);
        session.cleanup.push(() => {
            globalThis.removeEventListener(
                'axelate:zoom-changed',
                handleZoomChange as EventListener,
            );
        });

        try {
            await this._applySessionLayout(session);
            return session;
        } catch (error) {
            await this._disposeSession(session);
            throw error;
        }
    }

    private async _createWebview(
        label: string,
        url: string,
        bounds: WebviewBounds,
    ): Promise<Webview> {
        const webview = new Webview(getCurrentWindow(), label, {
            url,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            backgroundColor: '#080b12',
            focus: true,
            incognito: true,
            zoomHotkeysEnabled: false,
        });

        await this._waitForWebviewCreation(webview);
        return webview;
    }

    private async _waitForWebviewCreation(webview: Webview): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const timer = globalThis.setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve();
            }, 1200);

            const finish = (handler: () => void) => {
                if (settled) {
                    return;
                }

                settled = true;
                globalThis.clearTimeout(timer);
                handler();
            };

            void webview.once('tauri://created', () => {
                finish(resolve);
            });
            void webview.once('tauri://error', (event) => {
                finish(() => {
                    reject(new Error(this._stringifyError(event.payload)));
                });
            });
        });
    }

    private async _readCurrentZoom(): Promise<number> {
        try {
            const zoom = await invoke<number>('get_webview_zoom');
            return typeof zoom === 'number' && zoom > 0 ? zoom : 1;
        } catch {
            return 1;
        }
    }

    private async _waitForModalLayout(frameShell: HTMLElement): Promise<void> {
        // Child webview bounds are captured once at creation time, so wait until
        // the modal shell finishes its open animation instead of keeping modal listeners alive.
        const targets = this._collectMotionTargets(frameShell);
        const maxMotionMs = targets.reduce((currentMax, target) => {
            return Math.max(currentMax, this._readMotionDuration(target));
        }, 0);

        if (maxMotionMs <= 0) {
            await this._waitForNextFrame();
            return;
        }

        await new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, Math.ceil(maxMotionMs) + 16);
        });
    }

    private _collectMotionTargets(frameShell: HTMLElement): HTMLElement[] {
        const targets = new Set<HTMLElement>();

        const modal = frameShell.closest('#module-settings-modal');
        const modalShell = frameShell.closest('.app-modal');
        const modalMain = frameShell.closest('.app-modal-main');

        if (modal instanceof HTMLElement) {
            targets.add(modal);
        }
        if (modalShell instanceof HTMLElement) {
            targets.add(modalShell);
        }
        if (modalMain instanceof HTMLElement) {
            targets.add(modalMain);
        }

        return [...targets];
    }

    private _readMotionDuration(element: HTMLElement): number {
        const styles = globalThis.getComputedStyle(element);
        return Math.max(
            this._readCssTiming(styles.transitionDuration, styles.transitionDelay),
            this._readCssTiming(styles.animationDuration, styles.animationDelay),
        );
    }

    private _readCssTiming(durationList: string, delayList: string): number {
        const durations = this._parseCssTimeList(durationList);
        const delays = this._parseCssTimeList(delayList);
        const count = Math.max(durations.length, delays.length);

        if (count === 0) {
            return 0;
        }

        let maxDuration = 0;
        for (let index = 0; index < count; index += 1) {
            const duration = durations[index % durations.length] ?? 0;
            const delay = delays[index % delays.length] ?? 0;
            maxDuration = Math.max(maxDuration, duration + delay);
        }

        return maxDuration;
    }

    private _parseCssTimeList(value: string): number[] {
        return value
            .split(',')
            .map((item) => this._parseCssTime(item.trim()))
            .filter((time) => time > 0);
    }

    private _parseCssTime(value: string): number {
        if (value.endsWith('ms')) {
            return Number.parseFloat(value);
        }

        if (value.endsWith('s')) {
            return Number.parseFloat(value) * 1000;
        }

        return 0;
    }

    private _readZoomFromEvent(event: Event): number | null {
        if (!(event instanceof CustomEvent)) {
            return null;
        }

        const detail = event.detail as { zoom?: unknown };
        return typeof detail.zoom === 'number' && detail.zoom > 0 ? detail.zoom : null;
    }

    private async _measureReadyBounds(
        frameShell: HTMLElement,
        zoom: number,
    ): Promise<WebviewBounds> {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const bounds = this._measureBounds(frameShell, zoom);
            if (bounds !== null) {
                return bounds;
            }

            await this._waitForNextFrame();
        }

        throw new Error('Custom settings container is not ready for webview placement');
    }

    private _measureBounds(frameShell: HTMLElement, zoom: number): WebviewBounds | null {
        const rect = frameShell.getBoundingClientRect();
        const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
        const width = Math.round(rect.width * scale);
        const height = Math.round(rect.height * scale);

        if (width < 2 || height < 2) {
            return null;
        }

        // Child webviews are placed in window logical pixels. When the parent webview
        // uses native zoom, DOMRect stays in CSS pixels, so we must scale by zoom.
        return {
            x: Math.max(0, Math.round(rect.left * scale)),
            y: Math.max(0, Math.round(rect.top * scale)),
            width,
            height,
        };
    }

    private _scheduleLayoutSync(session: ActiveWebviewSession): void {
        if (session.disposed || session.syncScheduled) {
            return;
        }

        session.syncScheduled = true;
        globalThis.requestAnimationFrame(() => {
            session.syncScheduled = false;
            if (session.disposed) {
                return;
            }

            void this._applySessionLayout(session).catch((error: unknown) => {
                if (!session.disposed) {
                    this._deps.tracer.error(
                        `[ModuleSettingsCustomUiController] Failed to sync module settings webview: ${this._stringifyError(error)}`,
                    );
                }
            });
        });
    }

    private async _applySessionLayout(session: ActiveWebviewSession): Promise<void> {
        const bounds = this._measureBounds(session.frameShell, session.zoom);
        if (bounds === null || session.disposed) {
            return;
        }

        await session.webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
        await session.webview.setSize(new LogicalSize(bounds.width, bounds.height));

        if (session.appliedZoom !== session.zoom) {
            await session.webview.setZoom(session.zoom);
            session.appliedZoom = session.zoom;
        }
    }

    private _buildWebviewLabel(moduleId: string): string {
        const safeModuleId = moduleId.replace(/[^a-zA-Z0-9:/_-]/g, '-');
        const nonce =
            typeof globalThis.crypto.randomUUID === 'function'
                ? globalThis.crypto.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

        return `module-settings:${safeModuleId}:${nonce}`;
    }

    private _buildWebviewUrl(app: IApp): string {
        const settings = this._deps.service.getSettings() as SettingsSnapshot;
        const searchParams = new URLSearchParams({
            moduleId: app.id,
            name: app.name ?? app.id,
            category: app.category ?? '',
            type: app.type ?? '',
            settingsUi: app.settingsUi ?? '',
            language: settings.language ?? 'en',
            theme: settings.theme ?? 'dark',
        });

        return `module-settings://localhost/host/index.html?${searchParams.toString()}`;
    }

    private async _disposeActiveSession(): Promise<void> {
        if (this._activeSession === null) {
            return;
        }

        await this._disposeSession(this._activeSession);
        this._activeSession = null;
    }

    private async _disposeSession(session: ActiveWebviewSession): Promise<void> {
        if (session.disposed) {
            return;
        }

        session.disposed = true;
        session.syncScheduled = false;
        session.cleanup.splice(0).forEach((cleanup) => {
            cleanup();
        });

        try {
            await session.webview.close();
        } catch {
            // The child webview may already be gone if the modal closed first.
        }

        if (this._activeSession === session) {
            this._activeSession = null;
        }
    }

    private async _waitForNextFrame(): Promise<void> {
        await new Promise<void>((resolve) => {
            globalThis.requestAnimationFrame(() => {
                resolve();
            });
        });
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
