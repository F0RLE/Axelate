import { describe, expect, it } from 'vitest';
import { ModuleSettingsEngineFieldCatalog } from './ModuleSettingsEngineFieldCatalog';

describe('ModuleSettingsEngineFieldCatalog', () => {
    const catalog = new ModuleSettingsEngineFieldCatalog();
    const t = (key: string, fallback?: string) => `${key}:${fallback ?? ''}`;

    it('should build core, text and image field definitions', () => {
        expect(catalog.buildCoreModelField(t, 'model.gguf', false)).toMatchObject({
            key: 'model_path',
            type: 'text',
            isEngineConfig: true,
            fullWidth: true,
        });

        expect(catalog.buildTextEngineFields(t).map((field) => field.key)).toEqual([
            'gpu_layers',
            'context_size',
        ]);

        const imageGroups = catalog.buildImageEngineGroups(t, 'sdcpp');
        expect(imageGroups.promptFields.map((field) => field.key)).toEqual([
            'sdcpp_positive_prompt',
            'sdcpp_negative_prompt',
        ]);
        expect(imageGroups.samplingFields.some((field) => field.key === 'sdcpp_sampler')).toBe(
            true,
        );
        expect(catalog.buildImageExtraArgsField(t)).toMatchObject({
            key: 'extra_args',
            showInfoButton: true,
            fullWidth: true,
        });
        expect(catalog.buildImageCompanionFields(t, 'sdcpp')).toEqual([]);
    });
});
