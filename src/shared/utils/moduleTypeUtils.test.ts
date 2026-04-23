import { describe, expect, it } from 'vitest';
import { isApiApp } from './moduleTypeUtils';

describe('moduleTypeUtils', () => {
    it('should return true for apps marked as api type', () => {
        expect(isApiApp({ type: 'api' })).toBe(true);
    });

    it('should return true when provider metadata is present', () => {
        expect(isApiApp({ type: 'local', apiProviderData: { id: 'custom-provider' } })).toBe(true);
    });

    it('should return false for local apps without provider metadata', () => {
        expect(isApiApp({ type: 'local' })).toBe(false);
    });

    it('should return false for nullish input', () => {
        expect(isApiApp(undefined)).toBe(false);
    });
});
