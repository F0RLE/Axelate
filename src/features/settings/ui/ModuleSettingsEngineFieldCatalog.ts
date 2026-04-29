type TranslateFn = (key: string, fallback?: string) => string;

export type EngineFieldDefinition = {
    label: string;
    key: string;
    type: 'number' | 'text' | 'select' | 'password' | 'textarea';
    isEngineConfig: boolean;
    placeholder?: string;
    defaultValue?: number | string;
    options?: string[];
    optionLabels?: Record<string, string>;
    min?: number;
    max?: number;
    fullWidth?: boolean;
    showInfoButton?: boolean;
    isFile?: boolean;
    fileKind?: 'model';
    description?: string;
};

export type ImageEngineFieldGroups = {
    promptFields: EngineFieldDefinition[];
    sizeFields: EngineFieldDefinition[];
    samplingFields: EngineFieldDefinition[];
    batchFields: EngineFieldDefinition[];
};

export class ModuleSettingsEngineFieldCatalog {
    public buildCoreModelField(
        t: TranslateFn,
        modelPlaceholder: string,
        isImage: boolean,
    ): EngineFieldDefinition {
        return {
            label: t(
                isImage ? 'ui.settings.engine.image_model_path' : 'ui.settings.engine.model_path',
                isImage
                    ? 'Image Model Path (*.gguf, *.safetensors)'
                    : 'Model Path (*.gguf, *.safetensors)',
            ),
            key: 'model_path',
            type: 'text',
            isEngineConfig: true,
            placeholder: modelPlaceholder,
            fullWidth: !isImage,
            isFile: true,
            fileKind: 'model',
            ...(isImage
                ? {
                      description: t(
                          'ui.settings.engine.image_model_path_hint',
                          'Main diffusion model file.',
                      ),
                  }
                : {}),
        };
    }

    public buildTextEngineFields(t: TranslateFn): EngineFieldDefinition[] {
        return [
            {
                label: t('ui.settings.engine.context_size', 'Context Window'),
                key: 'context_size',
                type: 'number',
                isEngineConfig: true,
                placeholder: 'e.g. 4096',
                defaultValue: 4096,
                min: 512,
                max: 128000,
            },
            {
                label: t('ui.settings.engine.system_prompt', 'System Prompt'),
                key: 'llamacpp_system_prompt',
                type: 'textarea',
                isEngineConfig: false,
                placeholder: t(
                    'ui.settings.engine.system_prompt_placeholder',
                    'Optional instructions applied before each local chat.',
                ),
                defaultValue: '',
                fullWidth: true,
            },
        ];
    }

    public buildImageEngineGroups(t: TranslateFn, appId: string): ImageEngineFieldGroups {
        return {
            promptFields: [
                {
                    label: t('ui.settings.engine.sd_positive_prompt', 'Positive Prompt'),
                    key: `${appId}_positive_prompt`,
                    type: 'textarea',
                    isEngineConfig: false,
                    placeholder: t(
                        'ui.settings.engine.sd_positive_prompt_placeholder',
                        'Describe the image style, subject, lighting, and details.',
                    ),
                    defaultValue: '',
                },
                {
                    label: t('ui.settings.engine.sd_negative_prompt', 'Negative Prompt'),
                    key: `${appId}_negative_prompt`,
                    type: 'textarea',
                    isEngineConfig: false,
                    placeholder: t(
                        'ui.settings.engine.sd_negative_prompt_placeholder',
                        'Things to avoid: blurry, low quality, watermark, distortion.',
                    ),
                    defaultValue: '',
                },
            ],
            sizeFields: [
                {
                    label: t('ui.settings.engine.sd_width', 'Width (px)'),
                    key: `${appId}_width`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '512',
                    defaultValue: 512,
                    min: 256,
                    max: 4096,
                },
                {
                    label: t('ui.settings.engine.sd_height', 'Height (px)'),
                    key: `${appId}_height`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '512',
                    defaultValue: 512,
                    min: 256,
                    max: 4096,
                },
            ],
            samplingFields: [
                {
                    label: t('ui.settings.engine.sd_steps', 'Steps'),
                    key: `${appId}_steps`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '20',
                    defaultValue: 20,
                    min: 1,
                    max: 100,
                },
                {
                    label: t('ui.settings.engine.sd_cfg', 'CFG'),
                    key: `${appId}_cfg_scale`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '7.0',
                    defaultValue: 7,
                    min: 1,
                    max: 30,
                },
                {
                    label: t('ui.settings.engine.sd_denoising_strength', 'Denoising strength'),
                    key: `${appId}_denoising_strength`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '0.75',
                    defaultValue: 0.75,
                    min: 0,
                    max: 1,
                },
                {
                    label: t('ui.settings.engine.sd_sampler', 'Sampler'),
                    key: `${appId}_sampler`,
                    type: 'select',
                    isEngineConfig: false,
                    options: [
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
                    ],
                    optionLabels: {
                        euler: 'Euler',
                        euler_a: 'Euler A',
                        heun: 'Heun',
                        dpm2: 'DPM2',
                        'dpm++2s_a': 'DPM++ 2S A',
                        'dpm++2m': 'DPM++ 2M',
                        'dpm++2mv2': 'DPM++ 2M v2',
                        ipndm: 'IPNDM',
                        ipndm_v: 'IPNDM V',
                        lcm: 'LCM',
                        ddim_trailing: 'DDIM trailing',
                        tcd: 'TCD',
                        res_multistep: 'Res multistep',
                        res_2s: 'Res 2S',
                        er_sde: 'ER SDE',
                    },
                    defaultValue: 'euler_a',
                },
                {
                    label: t('ui.settings.engine.sd_scheduler', 'Scheduler'),
                    key: `${appId}_scheduler`,
                    type: 'select',
                    isEngineConfig: false,
                    options: [
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
                    ],
                    optionLabels: {
                        discrete: 'Discrete',
                        karras: 'Karras',
                        exponential: 'Exponential',
                        ays: 'AYS',
                        gits: 'GITS',
                        sgm_uniform: 'SGM uniform',
                        simple: 'Simple',
                        smoothstep: 'Smoothstep',
                        kl_optimal: 'KL optimal',
                        lcm: 'LCM',
                        bong_tangent: 'Bong tangent',
                    },
                    defaultValue: 'discrete',
                },
            ],
            batchFields: [
                {
                    label: t('ui.settings.engine.sd_seed', 'Seed'),
                    key: `${appId}_seed`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '-1',
                    defaultValue: -1,
                    min: -1,
                },
                {
                    label: t('ui.settings.engine.sd_clip_skip', 'Clip Skip'),
                    key: `${appId}_clip_skip`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '-1',
                    defaultValue: -1,
                    min: -1,
                    max: 12,
                },
                {
                    label: t('ui.settings.engine.sd_batch_size', 'Batch Size'),
                    key: `${appId}_batch_size`,
                    type: 'number',
                    isEngineConfig: false,
                    placeholder: '1',
                    defaultValue: 1,
                    min: 1,
                    max: 8,
                },
            ],
        };
    }

    public buildImageExtraArgsField(t: TranslateFn): EngineFieldDefinition {
        return {
            label: t('ui.settings.engine.extra_args', 'Extra Arguments'),
            key: 'extra_args',
            type: 'text',
            isEngineConfig: true,
            placeholder: 'e.g. --vae-tiling --fa --rng cuda',
            defaultValue: '',
            fullWidth: true,
            showInfoButton: true,
            description: t(
                'ui.settings.engine.extra_args_hint',
                'Advanced startup flags appended to sd.cpp.',
            ),
        };
    }
}
