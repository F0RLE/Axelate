import { vi } from 'vitest';
import type { IBridge } from '@/shared/types/IBridge';

export function createMockBridge(isTauri = false): IBridge {
    return {
        isTauri: vi.fn(() => isTauri),
        invoke: vi.fn().mockResolvedValue(undefined),
        listen: vi.fn().mockResolvedValue(() => {}),
    };
}
