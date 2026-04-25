import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModuleSettingsCustomUiController } from './ModuleSettingsCustomUiController';

function createHarness(options?: {
    isTauri?: boolean;
    sessionToken?: string;
    invokeError?: Error;
}) {
    const cleanupHandlers: Array<() => void> = [];
    const invoke = vi.fn(() => {
        if (options?.invokeError !== undefined) {
            return Promise.reject(options.invokeError);
        }

        return Promise.resolve(options?.sessionToken ?? 'session-abc123');
    });

    const controller = new ModuleSettingsCustomUiController({
        service: {
            getSettings: () => ({
                language: 'ru',
                theme: 'dark',
            }),
        },
        tauri: {
            isTauri: () => options?.isTauri ?? true,
            invoke: invoke as unknown as <
                T,
                A extends Record<string, unknown> = Record<string, unknown>,
            >(
                cmd: string,
                args?: A,
            ) => Promise<T>,
        },
        translate: (_key, defaultValue) => defaultValue ?? '',
        registerCleanup: (cleanup) => {
            cleanupHandlers.push(cleanup);
        },
        tracer: {
            error: vi.fn(),
        },
    });

    const modal = document.createElement('dialog');
    modal.id = 'module-settings-modal';
    const appModal = document.createElement('div');
    appModal.className = 'app-modal';
    const appModalMain = document.createElement('div');
    appModalMain.className = 'app-modal-main';
    const content = document.createElement('div');
    content.className = 'module-settings-content';
    const container = document.createElement('div');
    container.innerHTML = '';
    content.appendChild(container);
    appModalMain.appendChild(content);
    appModal.appendChild(appModalMain);
    modal.appendChild(appModal);
    document.body.appendChild(modal);

    return {
        controller,
        modal,
        container,
        cleanupHandlers,
        invoke,
        tracer: (
            controller as unknown as { _deps: { tracer: { error: ReturnType<typeof vi.fn> } } }
        )._deps.tracer,
    };
}

describe('ModuleSettingsCustomUiController', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    it('renders a scoped module settings iframe inside the modal content', async () => {
        const harness = createHarness({ sessionToken: 'session-z9x8y' });

        await harness.controller.render(harness.container, {
            id: 'telegram-bot',
            name: 'Parser',
            category: 'automation',
            type: 'local',
            settingsUi: 'settings-ui/index.html',
        });

        expect(harness.invoke).toHaveBeenCalledWith('create_module_settings_session', {
            moduleId: 'telegram-bot',
        });

        const frame = harness.container.querySelector('iframe');
        expect(frame).toBeInstanceOf(HTMLIFrameElement);
        expect(frame?.getAttribute('src')).toContain(
            'module-settings://localhost/session/session-z9x8y/host/index.html?',
        );
        expect(frame?.getAttribute('src')).toContain('moduleId=telegram-bot');
        expect(frame?.getAttribute('src')).toContain('language=ru');
        expect(frame?.getAttribute('src')).toContain('theme=dark');
        expect(harness.modal.classList.contains('module-settings-modal-custom-ui')).toBe(true);

        const status = harness.container.querySelector('.module-settings-webui-status');
        expect(status?.classList.contains('hidden')).toBe(false);

        dispatchHostMessage(frame, 'host-ready');
        expect(status?.classList.contains('hidden')).toBe(true);
    });

    it('shows a failure state when Tauri runtime is unavailable', async () => {
        const harness = createHarness({ isTauri: false });

        await harness.controller.render(harness.container, {
            id: 'telegram-bot',
            name: 'Parser',
            category: 'automation',
            type: 'local',
            settingsUi: 'settings-ui/index.html',
        });

        expect(harness.invoke).not.toHaveBeenCalled();
        expect(harness.container.querySelector('iframe')).toBeNull();
        expect(harness.container.textContent).toContain('Failed to load module settings UI.');
    });

    it('removes the iframe when module cleanup runs', async () => {
        const harness = createHarness();

        await harness.controller.render(harness.container, {
            id: 'telegram-bot',
            name: 'Parser',
            category: 'automation',
            type: 'local',
            settingsUi: 'settings-ui/index.html',
        });

        expect(harness.container.querySelector('iframe')).not.toBeNull();
        harness.cleanupHandlers.forEach((cleanup) => {
            cleanup();
        });
        expect(harness.container.querySelector('iframe')).toBeNull();
    });

    it('shows a failure state when the host iframe fails to load', async () => {
        const harness = createHarness();

        await harness.controller.render(harness.container, {
            id: 'telegram-bot',
            name: 'Parser',
            category: 'automation',
            type: 'local',
            settingsUi: 'settings-ui/index.html',
        });

        const frame = harness.container.querySelector('iframe');
        frame?.dispatchEvent(new Event('error'));

        const status = harness.container.querySelector('.module-settings-webui-status');
        expect(status?.getAttribute('data-state')).toBe('error');
        expect(status?.textContent).toContain('Failed to load module settings UI.');
    });

    it('shows a failure state when the host reports an error', async () => {
        const harness = createHarness();

        await harness.controller.render(harness.container, {
            id: 'telegram-bot',
            name: 'Parser',
            category: 'automation',
            type: 'local',
            settingsUi: 'settings-ui/index.html',
        });

        const frame = harness.container.querySelector('iframe');
        dispatchHostMessage(frame, 'host-ready');
        dispatchHostMessage(frame, 'host-error', 'Module boot failed');

        const status = harness.container.querySelector('.module-settings-webui-status');
        expect(status?.classList.contains('hidden')).toBe(true);
        expect(harness.tracer.error).toHaveBeenCalledWith(
            expect.stringContaining('Host reported custom settings UI failure after shell load'),
        );
    });

    it('shows a failure state when the host iframe boot times out', async () => {
        vi.useFakeTimers();
        const harness = createHarness();

        await harness.controller.render(harness.container, {
            id: 'telegram-bot',
            name: 'Parser',
            category: 'automation',
            type: 'local',
            settingsUi: 'settings-ui/index.html',
        });

        await vi.advanceTimersByTimeAsync(8000);

        const status = harness.container.querySelector('.module-settings-webui-status');
        expect(status?.getAttribute('data-state')).toBe('error');
        expect(status?.textContent).toContain('Failed to load module settings UI.');
    });
});

function dispatchHostMessage(frame: HTMLIFrameElement | null, type: string, message = ''): void {
    globalThis.dispatchEvent(
        new MessageEvent('message', {
            source: frame?.contentWindow ?? null,
            data: {
                channel: 'axelate:module-settings-host',
                type,
                message,
            },
        }),
    );
}
