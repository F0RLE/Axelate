type TranslateFn = (key: string, fallback?: string) => string;

export type EngineFieldDefinition = {
    label: string;
    key: string;
    type: 'number' | 'text' | 'select' | 'password' | 'textarea';
    isEngineConfig: boolean;
    placeholder?: string;
    defaultValue?: number | string;
    options?: string[];
    min?: number;
    max?: number;
    fullWidth?: boolean;
    showInfoButton?: boolean;
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
            label: t('ui.settings.engine.model_path', 'Model Path (*.gguf, *.safetensors)'),
            key: 'model_path',
            type: 'text',
            isEngineConfig: true,
            placeholder: modelPlaceholder,
            fullWidth: !isImage,
        };
    }

    public buildTextEngineFields(t: TranslateFn): EngineFieldDefinition[] {
        return [
            {
                label: t('ui.settings.engine.gpu_layers', 'GPU Layers'),
                key: 'gpu_layers',
                type: 'number',
                isEngineConfig: true,
                placeholder: 'e.g. -1',
                defaultValue: -1,
                min: -1,
                max: 999,
            },
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
        ];
    }

    public buildImageEngineGroups(t: TranslateFn, appId: string): ImageEngineFieldGroups {
        return {
            promptFields: [
                {
                    label: t('ui.settings.engine.sd_positive_prompt', 'Positive Prompt Prefix'),
                    key: `${appId}_positive_prompt`,
                    type: 'textarea',
                    isEngineConfig: false,
                    placeholder: 'e.g. score_9, score_8_up...',
                    defaultValue: '',
                },
                {
                    label: t('ui.settings.engine.sd_negative_prompt', 'Negative Prompt Prefix'),
                    key: `${appId}_negative_prompt`,
                    type: 'textarea',
                    isEngineConfig: false,
                    placeholder: 'e.g. score_4, text, watermark...',
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
                    label: t('ui.settings.engine.sd_sampler', 'Sampler'),
                    key: `${appId}_sampler`,
                    type: 'select',
                    isEngineConfig: false,
                    options: [
                        'dpm++ 2m',
                        'dpm++ 2m v2',
                        'dpm++ 2s a',
                        'euler a',
                        'heun',
                        'dpm2',
                        'euler',
                        'ipndm',
                        'ipndm_v',
                        'dpm2 a',
                        'ddim trailing',
                        'res multistep',
                        'res 2s',
                        'lcm',
                        'tcd',
                    ],
                    defaultValue: 'euler a',
                },
                {
                    label: t('ui.settings.engine.sd_scheduler', 'Scheduler'),
                    key: `${appId}_scheduler`,
                    type: 'select',
                    isEngineConfig: false,
                    options: [
                        'discrete',
                        'karras',
                        'sgm uniform',
                        'exponential',
                        'ays',
                        'gits',
                        'smoothstep',
                        'kl optimal',
                        'simple',
                        'lcm',
                        'bong tangent',
                    ],
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
        };
    }
}
