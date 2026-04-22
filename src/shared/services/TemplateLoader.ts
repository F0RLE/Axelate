/**
 * @module core/services/TemplateLoader
 * @description Centralized service for dynamic HTML template loading, caching, and secure injection.
 *
 * @example
 * ```typescript
 * import { TemplateLoader } from './TemplateLoader';
 *
 * const loader = new TemplateLoader();
 * await loader.loadAndInject('sidebar', 'sidebar-container');
 * ```
 */

import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type InsertMode = 'replace' | 'append';
type TemplateLoaderLogger = Pick<LoggerService, 'debug' | 'error'>;

/**
 * @class TemplateLoader
 * @description Manages template lifecycle and secure DOM injection.
 */
export class TemplateLoader {
    private readonly _cache = new Map<string, string>();
    private _initialized = false;

    constructor(private readonly _tracer: TemplateLoaderLogger) {}

    private static readonly _baseSanitizeConfig: DOMPurifyConfig = {
        USE_PROFILES: { html: true, svg: true },
        ALLOW_DATA_ATTR: true,
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
            'data-view',
            'data-level',
            'data-i18n',
            'data-i18n-placeholder',
            'data-i18n-params',
            'data-i18n-title',
            'data-title',
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
    };

    private static readonly _replaceSanitizeConfig: DOMPurifyConfig = {
        ...TemplateLoader._baseSanitizeConfig,
        SAFE_FOR_TEMPLATES: true,
        KEEP_CONTENT: true,
    };

    /**
     * Idempotent initialization of the service.
     * Required by Section 16.2 of Axelate Standards.
     */
    public init(): void {
        if (this._initialized) {
            this._tracer.debug('[TemplateLoader] Already initialized');
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
            const base = import.meta.env.BASE_URL.replace(/\/$/, '') || '.';
            const url = `${base}/templates/${path}.html`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(
                    `Failed to load template: ${path} (Status: ${response.status.toString()})`,
                );
            }

            const html = await response.text();
            this._cache.set(path, html);
            return html;
        } catch (error) {
            this._tracer.error(`[TemplateLoader] Error loading template ${path}: ${String(error)}`);
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
        return this._writeTemplate(containerId, html, 'replace');
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
        return this._writeTemplate(containerId, html, 'append');
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

    private _writeTemplate(containerId: string, html: string, mode: InsertMode): boolean {
        const container = this._getContainer(containerId);
        if (container === null) {
            return false;
        }

        const sanitized = this._sanitizeHtml(html, mode);
        if (mode === 'replace') {
            container.innerHTML = sanitized;
            this._tracer.debug(`[TemplateLoader] Injected: ${containerId}`);
        } else {
            container.insertAdjacentHTML('beforeend', sanitized);
        }

        return true;
    }

    private _getContainer(containerId: string): HTMLElement | null {
        const container = document.getElementById(containerId);
        return container instanceof HTMLElement ? container : null;
    }

    private _sanitizeHtml(html: string, mode: InsertMode): string {
        const config =
            mode === 'replace'
                ? TemplateLoader._replaceSanitizeConfig
                : TemplateLoader._baseSanitizeConfig;
        return DOMPurify.sanitize(html, config);
    }
}
