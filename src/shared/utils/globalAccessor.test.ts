import { describe, it, expect } from 'vitest';
import { getGlobalWin } from './globalAccessor';

describe('globalAccessor', () => {
    it('getGlobalWin should return globalThis', () => {
        const win = getGlobalWin();
        expect(win).toBe(globalThis);
    });
});
