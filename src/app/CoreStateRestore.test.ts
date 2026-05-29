import { describe, expect, it, vi } from 'vitest';

import { restoreSelectedModules, type RestoredSelections } from './CoreStateRestore';
import { CUSTOM_TEXT_PROVIDER_ID } from '@/shared/utils/customProviderSupport';

describe('CoreStateRestore', () => {
    it('should keep ai_text visible after restoring both AI slots', () => {
        const textApp = { id: 'gpt', name: 'GPT' };
        const imageApp = { id: 'comfyui', name: 'ComfyUI' };
        const serviceApp = { id: 'sample', name: 'Sample' };
        const updateModuleCard = vi.fn();

        const restoredSelections = restoreSelectedModules({
            tracer: {
                warn: vi.fn(),
            },
            moduleSettings: {
                getSelectedModules: () => ({
                    ai_text: { id: 'gpt' },
                    ai_image: { id: 'comfyui' },
                    services: { id: 'sample' },
                }),
            } as never,
            catalog: {
                getAppById: (appId: string) =>
                    ({
                        gpt: textApp,
                        comfyui: imageApp,
                        sample: serviceApp,
                    })[appId] ?? null,
            } as never,
            appUI: {
                updateModuleCard,
            } as never,
        });

        expect(restoredSelections).toEqual<RestoredSelections>({
            aiText: textApp,
            aiImage: imageApp,
            services: [serviceApp],
        });
        expect(updateModuleCard).toHaveBeenNthCalledWith(1, 'services', serviceApp);
        expect(updateModuleCard).toHaveBeenNthCalledWith(2, 'ai_text', textApp);
        expect(updateModuleCard).toHaveBeenNthCalledWith(3, 'ai_image', imageApp);
        expect(updateModuleCard).toHaveBeenNthCalledWith(4, 'ai_text', textApp);
    });

    it('should restore custom AI providers from the backend catalog snapshot', () => {
        const updateModuleCard = vi.fn();
        const customTextApp = {
            id: CUSTOM_TEXT_PROVIDER_ID,
            name: 'Custom',
            type: 'api',
            capability: 'text',
        };

        restoreSelectedModules({
            tracer: {
                warn: vi.fn(),
            },
            moduleSettings: {
                getSelectedModules: () => ({
                    ai_text: { id: CUSTOM_TEXT_PROVIDER_ID },
                }),
            } as never,
            catalog: {
                getAppById: (appId: string) =>
                    appId === CUSTOM_TEXT_PROVIDER_ID ? customTextApp : undefined,
            } as never,
            appUI: {
                updateModuleCard,
            } as never,
        });

        expect(updateModuleCard).toHaveBeenCalledWith('ai_text', customTextApp);
    });

    it('should preserve persisted AI selections that are not in the catalog snapshot', () => {
        const updateModuleCard = vi.fn();
        const selectedTextApp = {
            id: 'external-ai-provider',
            name: 'External Provider',
            type: 'api',
            capability: 'text',
        };

        restoreSelectedModules({
            tracer: {
                warn: vi.fn(),
            },
            moduleSettings: {
                getSelectedModules: () => ({
                    ai_text: selectedTextApp,
                }),
            } as never,
            catalog: {
                getAppById: () => undefined,
            } as never,
            appUI: {
                updateModuleCard,
            } as never,
        });

        expect(updateModuleCard).toHaveBeenCalledWith('ai_text', selectedTextApp);
    });
});
