import { vi } from 'vitest';
import type { IModule } from '@/shared/types/coreTypes';
import type { AppConfig } from '@/shared/types/bindings';

export function createMockAppConfig(overrides?: unknown): AppConfig {
    return {
        catalog: { ai: [], services: [] },
        apiProviders: [],
        autoStartModules: [],
        ...(overrides as Record<string, unknown>),
    } as unknown as AppConfig;
}

export function setupBridgeMocks(
    bridge: { isTauri: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> },
    config: AppConfig | null,
    modules: IModule[] = [],
    engineDefinitions: unknown[] = [],
): void {
    bridge.isTauri.mockReturnValue(true);
    bridge.invoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_config') return Promise.resolve(config);
        if (cmd === 'get_modules') return Promise.resolve(modules);
        if (cmd === 'get_engine_definitions') return Promise.resolve(engineDefinitions);
        return Promise.resolve(undefined);
    });
}

export function setupFetchMock(webConfig: AppConfig, moduleOk: boolean, moduleJson: unknown[]) {
    return vi.fn().mockImplementation((url: string) => {
        if (url === '/api/config') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(webConfig),
            });
        }

        return Promise.resolve({
            ok: moduleOk,
            json: () => Promise.resolve(moduleJson),
        });
    }) as unknown as typeof fetch;
}
