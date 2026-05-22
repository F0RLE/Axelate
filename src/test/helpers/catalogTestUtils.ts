import { vi } from 'vitest';
import { CatalogService } from '@/shared/services/CatalogService';
import type { CatalogSnapshot } from '@/shared/types/bindings';
import type { IBridge } from '@/shared/types/IBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { createMockBridge } from '@/test/mocks/mockBridge';

export function createMockCatalogSnapshot(overrides?: Partial<CatalogSnapshot>): CatalogSnapshot {
    return {
        ai: [],
        services: [],
        stars: [],
        ...overrides,
    };
}

export function setupBridgeMocks(
    bridge: { isTauri: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> },
    snapshot: CatalogSnapshot | null,
): void {
    bridge.isTauri.mockReturnValue(true);
    bridge.invoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_catalog_snapshot') return Promise.resolve(snapshot);
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
    const tracer: Pick<LoggerService, 'debug' | 'info' | 'warn' | 'error'> = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const service = new CatalogService(mockBridge as unknown as IBridge, tracer);

    return { mockBridge, service };
}
