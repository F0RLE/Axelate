import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOST_SCRIPT = readFileSync(
    resolve(process.cwd(), '../src-tauri/resources/module_settings_host/host.js'),
    'utf8',
);
const HOST_HTML = readFileSync(
    resolve(process.cwd(), '../src-tauri/resources/module_settings_host/index.html'),
    'utf8',
);

function renderHostShell(): HTMLIFrameElement {
    document.body.innerHTML = `
        <main class="host-shell">
            <div class="host-shell__stage">
                <iframe id="module-frame"></iframe>
                <div id="overlay" data-state="loading">
                    <p id="overlay-message"></p>
                </div>
            </div>
        </main>
    `;

    const frame = document.getElementById('module-frame');
    if (!(frame instanceof HTMLIFrameElement)) {
        throw new Error('Module frame was not created');
    }

    Object.defineProperty(frame, 'contentWindow', {
        configurable: true,
        value: window,
    });
    Object.defineProperty(window, 'postMessage', {
        configurable: true,
        value: vi.fn(),
    });

    return frame;
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function executeHostScript(): void {
    // eslint-disable-next-line no-eval -- static host fixture must run inside the jsdom window.
    window.eval(HOST_SCRIPT);
}

describe('module settings host', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve('{}'),
                }),
            ),
        );
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps the module iframe same-origin inside the host shell', () => {
        document.body.innerHTML = HOST_HTML;

        const frame = document.getElementById('module-frame');
        expect(frame).toBeInstanceOf(HTMLIFrameElement);
        expect((frame as HTMLIFrameElement).getAttribute('sandbox')).toContain('allow-same-origin');
    });

    it('reveals the module after frame load and module-ready without waiting for module-rendered', async () => {
        const frame = renderHostShell();

        executeHostScript();
        await flushMicrotasks();

        window.dispatchEvent(
            new MessageEvent('message', {
                origin: window.location.origin,
                source: frame.contentWindow,
                data: {
                    channel: 'axelate:module-settings',
                    type: 'module-ready',
                },
            }),
        );
        frame.dispatchEvent(new Event('load'));
        await flushMicrotasks();

        const overlay = document.getElementById('overlay');
        expect(overlay).toBeInstanceOf(HTMLElement);
        expect((overlay as HTMLElement).hidden).toBe(true);

        await vi.advanceTimersByTimeAsync(5000);
        expect((overlay as HTMLElement).hidden).toBe(true);
    });

    it('shows the timeout error when the module never announces readiness', async () => {
        renderHostShell();

        executeHostScript();
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(5000);

        const overlay = document.getElementById('overlay');
        const overlayMessage = document.getElementById('overlay-message');

        expect(overlay).toBeInstanceOf(HTMLElement);
        expect((overlay as HTMLElement).hidden).toBe(false);
        expect((overlay as HTMLElement).dataset['state']).toBe('error');
        expect(overlayMessage?.textContent).toContain('did not finish loading');
    });
});
