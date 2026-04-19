import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalBridge, type ICoreBridge } from './bridge';

function createCoreBridgeMock(): ICoreBridge {
    return {
        aiSettings: {
            setLastActiveProvider: vi.fn(),
            getLastActiveProvider: vi.fn().mockReturnValue('gpt'),
            getInternetAccessEnabled: vi.fn().mockReturnValue(true),
            getSelectedAIModel: vi.fn().mockReturnValue('gpt-4'),
        } as never,
        aiBridge: {
            startProvider: vi.fn().mockResolvedValue(true),
        } as never,
        catalog: {
            getCatalog: vi.fn().mockReturnValue({
                ai: [{ id: 'gpt', name: 'GPT' }],
                services: [],
            }),
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

    it('starts AI provider before launching AI app', async () => {
        const bridge = new GlobalBridge(core);
        core.tauriProvider.invoke = vi.fn().mockResolvedValue({ action: 'navigate', provider: 'gpt' });

        await bridge.launchApp('gpt');

        expect(core.aiBridge.startProvider).toHaveBeenCalledWith('gpt');
        expect(core.tauriProvider.invoke).toHaveBeenCalledWith('launch_module', {
            moduleId: 'gpt',
        });
        expect(core.aiSettings.setLastActiveProvider).toHaveBeenCalledWith('gpt');
    });

    it('starts local module when backend requests start_local', async () => {
        const bridge = new GlobalBridge(core);
        core.tauriProvider.invoke = vi.fn().mockResolvedValue({ action: 'start_local' });

        await bridge.launchApp('service-x');

        expect(core.moduleService.control).toHaveBeenCalledWith('service-x', 'start');
    });

    it('stores API provider in web mode without tauri launch', async () => {
        core.tauriProvider.isTauri = vi.fn().mockReturnValue(false);
        const bridge = new GlobalBridge(core);

        await bridge.launchApp('gemini');

        expect(core.aiSettings.setLastActiveProvider).toHaveBeenCalledWith('gemini');
    });
});
