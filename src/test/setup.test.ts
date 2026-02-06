import { describe, it, expect } from 'vitest';

describe('Testing Setup', () => {
    it('should have access to JSDOM globalThis', () => {
        expect(globalThis).toBeDefined();
        document.body.innerHTML = '<div id="test">Hello</div>';
        expect(document.getElementById('test')?.textContent).toBe('Hello');
    });

    it('should have mocked Tauri invoke', () => {
        const win = globalThis as unknown as Record<string, any>;
        expect(win['__TAURI__']).toBeDefined();
        expect(typeof win['__TAURI__']['core']['invoke']).toBe('function');
    });
});
