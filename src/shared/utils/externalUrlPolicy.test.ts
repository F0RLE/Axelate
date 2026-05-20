import { describe, expect, it } from 'vitest';
import { assertAllowedExternalUrl, isAllowedExternalUrl } from './externalUrlPolicy';

describe('externalUrlPolicy', () => {
    it('allows normal external URL protocols', () => {
        expect(isAllowedExternalUrl('https://example.com')).toBe(true);
        expect(isAllowedExternalUrl('http://localhost:3000')).toBe(true);
        expect(isAllowedExternalUrl('mailto:support@example.com')).toBe(true);
    });

    it('blocks local file, script, custom protocol, and relative URLs', () => {
        expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
        expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
        expect(isAllowedExternalUrl('ms-settings:privacy-speech')).toBe(false);
        expect(isAllowedExternalUrl('/docs/getting-started')).toBe(false);
    });

    it('throws a readable error for blocked URLs', () => {
        expect(() => assertAllowedExternalUrl('file:///tmp/secret.txt')).toThrow(
            'Blocked external URL with unsupported protocol',
        );
    });
});
