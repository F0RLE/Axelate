/**
 * @module core/services/TemplateLoader
 * @description Centralized service for dynamic HTML template loading, caching, and secure injection.
 * Implements the Singleton pattern as defined in Axelate Standards Section 16.1.
 *
 * @example
 * ```typescript
 * import { templateLoader } from './TemplateLoader';
 *
 * await templateLoader.loadAndInject('sidebar', 'sidebar-container');
 * ```
 */

import DOMPurify from 'dompurify';
import { logger } from './LoggerService';

/**
 * @class TemplateLoader
 * @description Manages template lifecycle and secure DOM injection.
 */
class TemplateLoader {
    private readonly _cache = new Map<string, string>();
    private _initialized = false;

    constructor() {
        // Registration on globalThis for access from HTML/legacy code (Section 16.3)
        (globalThis as unknown as Record<string, unknown>)['templateLoader'] = this;
    }

    /**
     * Idempotent initialization of the service.
     * Required by Section 16.2 of Axelate Standards.
     */
    public init(): void {
        if (this._initialized) {
            logger.warn('[TemplateLoader] Already initialized');
            return;
        }

        this._initialized = true;
    }

    /**
     * Load a template file and cache it.
     *
     * @param path - The template path (relative to /templates/)
     * @returns The HTML content of the template or an empty string on failure
     * @sideeffect Performs network I/O to fetch template files
     */
    public async loadTemplate(path: string): Promise<string> {
        if (this._cache.has(path)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this._cache.get(path)!;
        }

        try {
            const response = await fetch(`/templates/${path}.html`);
            if (!response.ok) {
                throw new Error(
                    `Failed to load template: ${path} (Status: ${response.status.toString()})`,
                );
            }
            const html = await response.text();
            this._cache.set(path, html);
            return html;
        } catch (error) {
            logger.error(`[TemplateLoader] Error loading template ${path}: ${String(error)}`);
            return '';
        }
    }

    /**
     * Inject template HTML into a container element.
     *
     * @param containerId - ID of the target element
     * @param html - HTML content to inject
     * @returns True if injection was successful
     * @sideeffect Modifies the DOM by injecting sanitized HTML
     */
    public injectTemplate(containerId: string, html: string): boolean {
        const container = document.getElementById(containerId);
        if (container) {
            // Section 4.4: Secure injection with permissive configuration for app logic
            container.innerHTML = DOMPurify.sanitize(html, {
                USE_PROFILES: { html: true, svg: true },
                ADD_TAGS: [
                    'use',
                    'svg',
                    'path',
                    'symbol',
                    'circle',
                    'rect',
                    'title',
                    'desc',
                    'defs',
                    'linearGradient',
                    'stop',
                ],
                ADD_ATTR: [
                    'href',
                    'xlink:href',
                    'viewBox',
                    'd',
                    'fill',
                    'stroke',
                    'data-page',
                    'data-i18n',
                    'data-i18n-placeholder',
                    'data-i18n-params',
                    'data-i18n-title',
                    'data-lang',
                    'data-monitor-id',
                    'aria-label',
                    'aria-hidden',
                    'aria-current',
                    'aria-expanded',
                    'x1',
                    'y1',
                    'x2',
                    'y2',
                    'offset',
                    'stop-color',
                ],
                ALLOW_DATA_ATTR: true,
                SAFE_FOR_TEMPLATES: true,
                KEEP_CONTENT: true,
            });
            logger.debug(`[TemplateLoader] Injected: ${containerId}`);
            return true;
        }
        return false;
    }

    /**
     * Load and inject a template in one atomic step.
     *
     * @param templatePath - Path to the template file
     * @param containerId - ID of the target container
     * @returns True if both loading and injection succeeded
     */
    public async loadAndInject(templatePath: string, containerId: string): Promise<boolean> {
        const html = await this.loadTemplate(templatePath);
        return this.injectTemplate(containerId, html);
    }

    /**
     * Append template HTML to a container (preserves existing content).
     *
     * @param containerId - ID of the target element
     * @param html - HTML content to append
     * @returns True if append was successful
     * @sideeffect Modifies the DOM by appending sanitized HTML
     */
    public appendTemplate(containerId: string, html: string): boolean {
        const container = document.getElementById(containerId);
        if (container) {
            const sanitized = DOMPurify.sanitize(html, {
                USE_PROFILES: { html: true, svg: true },
                ALLOW_DATA_ATTR: true,
                ADD_TAGS: ['use', 'svg', 'path', 'symbol'],
                ADD_ATTR: [
                    'href',
                    'xlink:href',
                    'viewBox',
                    'd',
                    'fill',
                    'stroke',
                    'data-i18n',
                    'data-page',
                ],
            });
            container.insertAdjacentHTML('beforeend', sanitized);
            return true;
        }
        return false;
    }

    /**
     * Clear the internal template cache.
     * Useful for force-reloading templates or clearing memory.
     */
    public clearCache(): void {
        this._cache.clear();
    }

    /**
     * Preload multiple templates for immediate access.
     *
     * @param paths - List of template paths to preload
     */
    public async preloadTemplates(paths: string[]): Promise<void> {
        await Promise.all(paths.map((path) => this.loadTemplate(path)));
    }
}

// Export singleton instance as per Section 16.1
export const templateLoader = new TemplateLoader();
