import { describe, it, expect } from 'vitest';

describe('Testing Setup', () => {
    it('should have access to JSDOM globalThis', () => {
        expect(globalThis).toBeDefined();
        document.body.innerHTML = '<div id="test">Hello</div>';
        expect(document.getElementById('test')?.textContent).toBe('Hello');
    });

    it('should have mocked Tauri invoke', () => {
        expect((globalThis as any).__TAURI__).toBeDefined();
        expect(typeof (globalThis as any).__TAURI__.invoke).toBe('function');
    });
});
