/**
 * TemplateLoader Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { templateLoader } from '../modules/core/services/TemplateLoader';

describe('TemplateLoader', () => {
    beforeEach(() => {
        templateLoader.clearCache();
        // Reset fetch mock
        vi.restoreAllMocks();
    });

    afterEach(() => {
        templateLoader.clearCache();
    });

    describe('loadTemplate', () => {
        it('should fetch and return template content', async () => {
            const mockHtml = '<div>Test Template</div>';
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(mockHtml),
            });

            const result = await templateLoader.loadTemplate('pages/test');
            
            expect(result).toBe(mockHtml);
            expect(fetch).toHaveBeenCalledWith('/templates/pages/test.html');
        });

        it('should cache templates', async () => {
            const mockHtml = '<div>Cached</div>';
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(mockHtml),
            });

            await templateLoader.loadTemplate('pages/cached');
            await templateLoader.loadTemplate('pages/cached');

            // Fetch should only be called once due to caching
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should return empty string on fetch error', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404
            });

            const result = await templateLoader.loadTemplate('pages/notfound');
            
            expect(result).toBe('');
        });
    });

    describe('injectTemplate', () => {
        it('should inject HTML into container', () => {
            document.body.innerHTML = '<div id="container"></div>';
            
            const result = templateLoader.injectTemplate('container', '<span>Injected</span>');
            
            expect(result).toBe(true);
            expect(document.getElementById('container')?.innerHTML).toBe('<span>Injected</span>');
        });

        it('should return false if container not found', () => {
            document.body.innerHTML = '';
            
            const result = templateLoader.injectTemplate('nonexistent', '<span>Test</span>');
            
            expect(result).toBe(false);
        });
    });

    describe('appendTemplate', () => {
        it('should append HTML to container', () => {
            document.body.innerHTML = '<div id="container"><span>Existing</span></div>';
            
            templateLoader.appendTemplate('container', '<span>Appended</span>');
            
            const container = document.getElementById('container');
            expect(container?.children.length).toBe(2);
        });
    });
});
