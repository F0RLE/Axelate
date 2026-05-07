import { describe, it, expect } from 'vitest';

describe('Testing Setup', () => {
    it('should have access to JSDOM globalThis', () => {
        expect(globalThis).toBeDefined();
        document.body.innerHTML = '<div id="test">Hello</div>';
        expect(document.getElementById('test')?.textContent).toBe('Hello');
    });

    it('should have mocked Tauri invoke', () => {
        const win = globalThis as unknown as Record<string, unknown>;
        expect(typeof (win['__TAURI_INTERNALS__'] as { invoke: unknown }).invoke).toBe('function');
    });

    it('should expose the default translator helper', () => {
        const translate = (
            globalThis as unknown as { t: (key: string, fallback?: string) => string }
        ).t;

        expect(translate('ui.test', 'Fallback')).toBe('Fallback');
        expect(translate('ui.test')).toBe('ui.test');
    });
});
