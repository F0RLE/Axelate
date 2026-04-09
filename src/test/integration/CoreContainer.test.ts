/**
 * @module test/integration/CoreContainer.test.ts
 * @description Integration tests for CoreContainer — verifies service registration,
 * backward compat with globalThis, and container lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { container, getContainer } from '@/app/CoreContainer';
import type { CoreServices, CoreUI, CoreInfrastructure } from '@/app/CoreContainer';

describe('CoreContainer', () => {
    beforeEach(() => {
        container.reset();
    });

    afterEach(() => {
        container.reset();
    });

    it('should register services and make them accessible', () => {
        const mockServices = {
            tracer: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
                getLogs: vi.fn(),
            },
            catalog: { getCatalog: vi.fn().mockReturnValue({ ai: [], services: [] }) },
        } as unknown as CoreServices;

        container.registerServices(mockServices);

        expect(container.services.tracer).toBe(mockServices.tracer);
        expect(container.services.catalog).toBe(mockServices.catalog);
    });

    it('should register UI components', () => {
        const mockUI = {
            appUI: { showToast: vi.fn() },
        } as unknown as CoreUI;

        container.registerUI(mockUI);

        expect(container.ui.appUI).toBe(mockUI.appUI);
    });

    it('should register infrastructure', () => {
        const mockInfra = {
            templateLoader: { init: vi.fn() },
            eventBus: { on: vi.fn(), emit: vi.fn(), clear: vi.fn() },
            errorHandler: { init: vi.fn(), destroy: vi.fn() },
        } as unknown as CoreInfrastructure;

        container.registerInfra(mockInfra);

        expect(container.infra.templateLoader).toBe(mockInfra.templateLoader);
        expect(container.infra.eventBus).toBe(mockInfra.eventBus);
    });

    it('should lock container and prevent further registration', () => {
        container.registerServices({} as CoreServices);
        container.lock();

        expect(container.isLocked).toBe(true);

        // Should silently ignore further registration
        const newServices = { tracer: {} } as unknown as CoreServices;
        container.registerServices(newServices);

        // Container should still be empty (not updated)
        expect(container.services.tracer).toBeUndefined();
    });

    it('should reset container to empty state', () => {
        container.registerServices({ tracer: { info: vi.fn() } } as unknown as CoreServices);
        container.lock();

        container.reset();

        expect(container.isLocked).toBe(false);
        expect(container.services.tracer).toBeUndefined();
    });

    it('should resolve catalog categories via container', () => {
        const mockCatalog = {
            ai: [{ id: 'gpt', name: 'GPT' }],
            services: [{ id: 'bot', name: 'Bot' }],
        };
        const mockServices = {
            catalog: { getCatalog: vi.fn().mockReturnValue(mockCatalog) },
        } as unknown as CoreServices;

        container.registerServices(mockServices);

        expect(container.getCatalogCategory('ai')).toEqual(mockCatalog.ai);
        expect(container.getCatalogCategory('ai_text')).toEqual(mockCatalog.ai);
        expect(container.getCatalogCategory('ai_image')).toEqual(mockCatalog.ai);
        expect(container.getCatalogCategory('services')).toEqual(mockCatalog.services);
        expect(container.getCatalogCategory('unknown')).toEqual([]);
    });

    it('should handle empty catalog gracefully', () => {
        const mockServices = {
            catalog: { getCatalog: vi.fn().mockReturnValue({ ai: [], services: [] }) },
        } as unknown as CoreServices;

        container.registerServices(mockServices);

        expect(container.getCatalogCategory('ai')).toEqual([]);
        expect(container.getCatalogCategory('services')).toEqual([]);
    });

    it('should handle null catalog gracefully', () => {
        const mockServices = {
            catalog: { getCatalog: vi.fn().mockReturnValue(null) },
        } as unknown as CoreServices;

        container.registerServices(mockServices);

        expect(container.getCatalogCategory('ai')).toEqual([]);
    });

    it('getContainer() should return same singleton instance', () => {
        expect(getContainer()).toBe(container);
    });
});
