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
            'context_size',
            'llamacpp_system_prompt',
        ]);

        const imageGroups = catalog.buildImageEngineGroups(t, 'sdcpp');
        expect(imageGroups.promptFields.map((field) => field.key)).toEqual([
            'sdcpp_positive_prompt',
            'sdcpp_negative_prompt',
        ]);
        expect(imageGroups.samplingFields.some((field) => field.key === 'sdcpp_sampler')).toBe(
            true,
        );
        expect(
            imageGroups.samplingFields.find((field) => field.key === 'sdcpp_sampler')?.options,
        ).toEqual([
            'euler',
            'euler_a',
            'heun',
            'dpm2',
            'dpm++2s_a',
            'dpm++2m',
            'dpm++2mv2',
            'ipndm',
            'ipndm_v',
            'lcm',
            'ddim_trailing',
            'tcd',
            'res_multistep',
            'res_2s',
            'er_sde',
        ]);
        expect(
            imageGroups.samplingFields.find((field) => field.key === 'sdcpp_scheduler')?.options,
        ).toEqual([
            'discrete',
            'karras',
            'exponential',
            'ays',
            'gits',
            'sgm_uniform',
            'simple',
            'smoothstep',
            'kl_optimal',
            'lcm',
            'bong_tangent',
        ]);
        expect(catalog.buildImageExtraArgsField(t)).toMatchObject({
            key: 'extra_args',
            showInfoButton: true,
            fullWidth: true,
        });
    });
});
