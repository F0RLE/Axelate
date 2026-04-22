import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalBridge, type ICoreBridge } from './bridge';
import type { IApp } from '@/shared/types/coreTypes';

function createCoreBridgeMock(): ICoreBridge {
    return {
        aiBridge: {
            startProvider: vi.fn().mockResolvedValue(true),
        } as never,
        tracer: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        } as never,
        moduleService: {
            control: vi.fn().mockResolvedValue(undefined),
        } as never,
        tauriProvider: {
            isTauri: vi.fn().mockReturnValue(true),
            invoke: vi.fn(),
        } as never,
    };
}

describe('GlobalBridge', () => {
    let core: ICoreBridge;

    beforeEach(() => {
        core = createCoreBridgeMock();
    });

    it('starts the selected AI provider directly from the selected slot', async () => {
        const bridge = new GlobalBridge(core);
        const app = { id: 'gpt', name: 'GPT', type: 'api' } as IApp;

        await bridge.launchApp('ai_text', app);

        expect(core.aiBridge.startProvider).toHaveBeenCalledWith('gpt');
        expect(core.moduleService.control).not.toHaveBeenCalled();
    });

    it('starts local service modules through control_module without launch heuristics', async () => {
        const bridge = new GlobalBridge(core);
        const app = { id: 'service-x', name: 'Service X', type: 'local' } as IApp;

        await bridge.launchApp('services', app);

        expect(core.moduleService.control).toHaveBeenCalledWith('service-x', 'start');
    });

    it('skips local launches in web mode', async () => {
        core.tauriProvider.isTauri = vi.fn().mockReturnValue(false);
        const bridge = new GlobalBridge(core);
        const app = { id: 'service-x', name: 'Service X', type: 'local' } as IApp;

        await bridge.launchApp('services', app);

        expect(core.moduleService.control).not.toHaveBeenCalled();
    });
});
