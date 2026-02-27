import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { templateLoader } from './TemplateLoader';

describe('TemplateLoader', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="test-container"></div>';
        templateLoader.clearCache();
        (templateLoader as unknown as { _initialized: boolean })._initialized = false;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    describe('init', () => {
        it('should initialize only once', () => {
            templateLoader.init();
            expect((templateLoader as unknown as { _initialized: boolean })._initialized).toBe(
                true,
            );
            templateLoader.init();
            expect((templateLoader as unknown as { _initialized: boolean })._initialized).toBe(
                true,
            );
        });
    });

    describe('loadTemplate', () => {
        it('should return cached template on second call', async () => {
            const fetchSpy = vi
                .spyOn(globalThis, 'fetch')
                .mockResolvedValue(new Response('<p>Hello</p>', { status: 200 }));
            const html1 = await templateLoader.loadTemplate('test');
            const html2 = await templateLoader.loadTemplate('test');
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(html1).toBe(html2);
        });

        it('should return empty string on fetch error', async () => {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));
            const html = await templateLoader.loadTemplate('missing');
            expect(html).toBe('');
        });

        it('should return empty string on non-ok response', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response('Not Found', { status: 404 }),
            );
            const html = await templateLoader.loadTemplate('notfound');
            expect(html).toBe('');
        });
    });

    describe('injectTemplate', () => {
        it('should inject sanitized HTML into container', () => {
            const result = templateLoader.injectTemplate('test-container', '<p>Test</p>');
            expect(result).toBe(true);
            expect(document.getElementById('test-container')?.innerHTML).toContain('Test');
        });

        it('should return false for missing container', () => {
            expect(templateLoader.injectTemplate('nonexistent', '<p>x</p>')).toBe(false);
        });
    });

    describe('loadAndInject', () => {
        it('should load and inject in one step', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response('<p>Loaded</p>', { status: 200 }),
            );
            const result = await templateLoader.loadAndInject('tpl', 'test-container');
            expect(result).toBe(true);
        });

        it('should return false if container missing', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response('<p>x</p>', { status: 200 }),
            );
            const result = await templateLoader.loadAndInject('tpl', 'nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('appendTemplate', () => {
        it('should append HTML to existing content', () => {
            templateLoader.injectTemplate('test-container', '<p>First</p>');
            const result = templateLoader.appendTemplate('test-container', '<p>Second</p>');
            expect(result).toBe(true);
            expect(document.getElementById('test-container')?.children).toHaveLength(2);
        });

        it('should return false for missing container', () => {
            expect(templateLoader.appendTemplate('nonexistent', '<p>x</p>')).toBe(false);
        });
    });

    describe('preloadTemplates', () => {
        it('should preload multiple templates', async () => {
            const fetchSpy = vi
                .spyOn(globalThis, 'fetch')
                .mockResolvedValue(new Response('<p>ok</p>', { status: 200 }));
            await templateLoader.preloadTemplates(['a', 'b', 'c']);
            expect(fetchSpy).toHaveBeenCalledTimes(3);
        });
    });

    describe('clearCache', () => {
        it('should clear the cache', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response('<p>cached</p>', { status: 200 }),
            );
            await templateLoader.loadTemplate('cached');
            templateLoader.clearCache();
            await templateLoader.loadTemplate('cached');
            expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        });
    });
});
