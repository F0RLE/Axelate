/**
 * @module shared/utils/globalAccessor
 * @description Typed accessor for the global window object.
 * Replaces 50+ scattered `globalThis as TGlobalWin` casts with a single function.
 */

import type { TGlobalWin } from '@/shared/types/global_bridge_types';

/**
 * Returns a typed reference to globalThis.
 * Use this instead of `globalThis as TGlobalWin` throughout the codebase.
 */
export function getGlobalWin(): TGlobalWin {
    return globalThis as TGlobalWin;
}
