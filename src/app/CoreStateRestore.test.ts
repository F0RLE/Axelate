import { describe, expect, it, vi } from 'vitest';

import {
    restoreSelectedAiProvider,
    restoreSelectedModules,
    type RestoredSelections,
} from './CoreStateRestore';
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

    it('should restore the text provider first when both AI slots are selected', () => {
        const startProvider = vi.fn().mockResolvedValue(true);

        restoreSelectedAiProvider({
            tracer: {
                warn: vi.fn(),
            },
            aiBridge: {
                startProvider,
            } as never,
            restoredSelections: {
                aiText: { id: 'gpt' } as never,
                aiImage: { id: 'comfyui' } as never,
                services: [],
            },
        });

        expect(startProvider).toHaveBeenCalledWith('gpt');
    });

    it('should restore custom AI providers that only exist in the frontend catalog augmentation', () => {
        const updateModuleCard = vi.fn();

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
                getAppById: () => undefined,
                getCatalog: () => ({
                    ai: [{ id: 'gpt', name: 'GPT', type: 'api', capability: 'text' }],
                    services: [],
                }),
            } as never,
            appUI: {
                updateModuleCard,
            } as never,
        });

        expect(updateModuleCard).toHaveBeenCalledWith(
            'ai_text',
            expect.objectContaining({ id: CUSTOM_TEXT_PROVIDER_ID }),
        );
    });
});
