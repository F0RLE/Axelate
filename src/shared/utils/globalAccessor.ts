/**
 * @module shared/utils/globalAccessor
 * @description Typed accessor for the global window object.
 * Replaces 50+ scattered `globalThis as TGlobalWin` casts with a single function.
 * Also provides container access for DI-based patterns.
 */

import type { TGlobalWin } from '@/shared/types/global_bridge_types';
import type { CoreContainer } from '@/app/CoreContainer';
import { container } from '@/app/CoreContainer';

/**
 * Returns a typed reference to globalThis.
 * Use this instead of `globalThis as TGlobalWin` throughout the codebase.
 */
export function getGlobalWin(): TGlobalWin {
    return globalThis as TGlobalWin;
}

/**
 * Returns the DI container.
 * Prefer this over getGlobalWin() when accessing services.
 */
export function getContainer(): CoreContainer {
    return container;
}
