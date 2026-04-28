import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineStatusService } from './EngineStatusService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { EngineStatusContext } from './AIBridgeContext';

describe('EngineStatusService', () => {
    let service: EngineStatusService;
    let listeners: Record<string, (payload: unknown) => void>;
    let core: EngineStatusContext;
    let tracer: Pick<LoggerService, 'info' | 'error'>;

    beforeEach(() => {
        listeners = {};
        document.body.innerHTML = '';
        (globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
            escape: (value: string) => value,
        };

        core = {
            i18n: {
                t: vi.fn((_: string, fallback: string = ''): string => fallback),
            },
            tauriProvider: {
                isTauri: vi.fn().mockReturnValue(true),
                listen: vi
                    .fn()
                    .mockImplementation((event: string, cb: (payload: unknown) => void) => {
                        listeners[event] = cb;
                        return Promise.resolve(vi.fn());
                    }),
            },
        } as unknown as EngineStatusContext;

        tracer = {
            info: vi.fn(),
            error: vi.fn(),
        };
        service = new EngineStatusService(tracer);
        service.setCore(core);
    });

    it('does not initialize outside tauri', () => {
        const webCore = {
            tauriProvider: {
                isTauri: vi.fn().mockReturnValue(false),
                listen: vi.fn(),
            },
        } as unknown as EngineStatusContext;
        service.setCore(webCore);
        service.init();
        expect(webCore.tauriProvider.listen).not.toHaveBeenCalled();
    });

    it('does not register duplicate listeners on repeated init', () => {
        service.init();
        service.init();
        expect(core.tauriProvider.listen).toHaveBeenCalledTimes(4);
    });

    it('tracks starting, ready, swapping and error events on selected cards', () => {
        document.body.innerHTML = `
            <div class="app-card selected" data-app-id="llamacpp">
                <div class="module-selection-card-actions"><button class="modal-btn">Select</button></div>
            </div>
            <div class="app-card" data-app-id="sdcpp">
                <div class="module-selection-card-actions"><button class="modal-btn">Select</button></div>
            </div>
            <div id="ai-module-card" class="module-slot-card selected" data-current-module="llamacpp"></div>
        `;

        service.init();

        listeners['ai:engine:starting']?.({ engine_id: 'llamacpp' });
        const llama = document.querySelector<HTMLElement>('[data-app-id="llamacpp"]');
        if (!(llama instanceof HTMLElement)) {
            throw new Error('llamacpp card not found');
        }
        expect(llama.classList.contains('engine-starting')).toBe(true);
        expect(llama.querySelector('button')?.textContent).toBe('Booting...');

        listeners['ai:engine:ready']?.({
            engine_id: 'llamacpp',
            endpoint: 'http://127.0.0.1:8080',
        });
        expect(service.activeEngineIds).toEqual(['llamacpp']);
        expect(service.getEndpointForEngine('llamacpp')).toBe('http://127.0.0.1:8080');
        expect(service.hasActiveEngines).toBe(true);
        expect(llama.classList.contains('engine-ready')).toBe(true);
        expect(llama.querySelector('button')?.textContent).toBe('Remove');
        const dashboardCard = document.getElementById('ai-module-card');
        expect(dashboardCard?.classList.contains('module-running')).toBe(true);
        expect((dashboardCard as HTMLElement | null)?.dataset['runtimeStatus']).toBe('running');

        listeners['ai:engine:swapping']?.({ from: 'llamacpp', to: 'sdcpp' });
        const sdcpp = document.querySelector<HTMLElement>('[data-app-id="sdcpp"]');
        if (!(sdcpp instanceof HTMLElement)) {
            throw new Error('sdcpp card not found');
        }
        expect(llama.classList.contains('engine-idle')).toBe(true);
        expect(dashboardCard?.classList.contains('module-running')).toBe(false);
        expect((dashboardCard as HTMLElement | null)?.dataset['runtimeStatus']).toBe('idle');
        expect(sdcpp.classList.contains('engine-swapping')).toBe(true);
        expect(service.getEndpointForEngine('llamacpp')).toBeUndefined();

        listeners['ai:engine:error']?.({ engine_id: 'sdcpp', message: 'boom' });
        expect(sdcpp.classList.contains('engine-error')).toBe(true);
    });

    it('allows explicit bridge state updates for dashboard cards', () => {
        document.body.innerHTML = `
            <div id="ai-module-card" class="module-slot-card selected" data-current-module="gemini"></div>
        `;

        service.setEngineState('gemini', 'ready');
        const card = document.getElementById('ai-module-card');
        expect(card?.classList.contains('module-running')).toBe(true);
        expect((card as HTMLElement | null)?.dataset['runtimeStatus']).toBe('running');

        service.setEngineState('gemini', 'idle');
        expect(card?.classList.contains('module-running')).toBe(false);
        expect(card?.classList.contains('module-stopped')).toBe(true);
        expect((card as HTMLElement | null)?.dataset['runtimeStatus']).toBe('idle');
    });

    it('falls back to untranslated labels and handles cards without modal buttons', () => {
        (core as unknown as { i18n: { t: ReturnType<typeof vi.fn> } }).i18n.t.mockImplementation(
            (_: string, fallback: string = ''): string => fallback,
        );
        document.body.innerHTML = `
            <div class="app-card selected engine-ready" data-app-id="llamacpp"></div>
            <div class="app-card selected" data-app-id="sdcpp">
                <div class="module-selection-card-actions"><button class="modal-btn">Select</button></div>
            </div>
        `;

        service.init();
        listeners['ai:engine:starting']?.({ engine_id: 'sdcpp' });
        expect(document.querySelector('[data-app-id="sdcpp"] button')?.textContent).toBe(
            'Booting...',
        );

        listeners['ai:engine:ready']?.({ engine_id: 'sdcpp', endpoint: '/engine' });
        expect(document.querySelector('[data-app-id="sdcpp"] button')?.textContent).toBe('Remove');

        listeners['ai:engine:error']?.({ engine_id: 'sdcpp', message: 'oops' });
        expect(document.querySelector('[data-app-id="sdcpp"] button')?.textContent).toBe('Remove');
    });

    it('cleans active slots and unlisteners on destroy', async () => {
        const unlisten = vi.fn();
        vi.mocked(core.tauriProvider.listen).mockImplementation(
            (event: string, cb: (payload: unknown) => void) => {
                listeners[event] = cb;
                return Promise.resolve(unlisten);
            },
        );
        service.init();

        await Promise.resolve();
        listeners['ai:engine:ready']?.({ engine_id: 'llamacpp', endpoint: '/engine' });
        expect(service.hasActiveEngines).toBe(true);

        service.destroy();
        expect(unlisten).toHaveBeenCalledTimes(4);
        expect(service.activeEngineIds).toEqual([]);
        expect(service.hasActiveEngines).toBe(false);
    });

    it('returns noop unlisten and handles listen promise failure branches', async () => {
        const webCore = {
            tauriProvider: {
                isTauri: vi.fn().mockReturnValue(false),
                listen: vi.fn(),
            },
        } as unknown as EngineStatusContext;
        service.setCore(webCore);
        const noop = (
            service as unknown as {
                _listen: (event: string, handler: (payload: unknown) => void) => () => void;
            }
        )._listen('ai:engine:ready', vi.fn());
        expect(typeof noop).toBe('function');
        noop();

        const deferred: { resolve?: (fn: () => void) => void; reject?: (err: unknown) => void } =
            {};
        service.setCore(core);
        vi.mocked(core.tauriProvider.listen).mockImplementation(
            () =>
                new Promise<() => void>((resolve, reject) => {
                    deferred.resolve = resolve;
                    deferred.reject = reject;
                }),
        );

        const cleanup = (
            service as unknown as {
                _listen: (event: string, handler: (payload: unknown) => void) => () => void;
            }
        )._listen('ai:engine:ready', vi.fn());
        cleanup();
        const unlisten = vi.fn();
        deferred.resolve?.(unlisten);
        await Promise.resolve();
        expect(unlisten).toHaveBeenCalled();

        const failingCleanup = (
            service as unknown as {
                _listen: (event: string, handler: (payload: unknown) => void) => () => void;
            }
        )._listen('ai:engine:error', vi.fn());
        deferred.reject?.(new Error('listen failed'));
        await Promise.resolve();
        failingCleanup();
    });
});
