import { vi } from 'vitest';
import { CatalogService } from '@/shared/services/CatalogService';
import type { IModule } from '@/shared/types/coreTypes';
import type { AppConfig } from '@/shared/types/bindings';
import type { IBridge } from '@/shared/types/IBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { createMockBridge } from '@/test/mocks/mockBridge';

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

export type MockCatalogBridge = {
    isTauri: ReturnType<typeof vi.fn>;
    invoke: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
};

export function createCatalogHarness(): {
    mockBridge: MockCatalogBridge;
    service: CatalogService;
} {
    globalThis.dispatchEvent = vi.fn();

    const mockBridge = createMockBridge() as unknown as MockCatalogBridge;
    const tracer: Pick<LoggerService, 'info' | 'warn' | 'error'> = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const service = new CatalogService(mockBridge as unknown as IBridge, tracer);

    return { mockBridge, service };
}
