import type { IApp } from '@/shared/types/coreTypes';
import type { EngineConfig } from '@/features/ai/services/EngineConfigService';

import type { EngineFieldDefinition } from './ModuleSettingsEngineFieldCatalog';

type TranslateFn = (key: string, fallback?: string) => string;

type ModuleSettingsEngineRenderFlowDeps = {
    renderFieldDefinitions: (
        container: HTMLElement,
        definitions: EngineFieldDefinition[],
        appId: string,
        config: EngineConfig | null,
    ) => void;
    renderModelProfiles: (
        container: HTMLElement,
        appId: string,
        config: EngineConfig | null,
    ) => void;
    renderFieldRow: (
        container: HTMLElement,
        options: EngineFieldDefinition & {
            isFile?: boolean;
            isImage?: boolean;
            appId: string;
            config: EngineConfig | null;
        },
    ) => void;
    syncPromptTextareaHeights: (container: HTMLElement) => void;
};

type ModuleSettingsEngineRenderOptions = {
    container: HTMLElement;
    app: IApp;
    config: EngineConfig | null;
    html: string;
    sanitizeHtml: (html: string) => string;
    translate: TranslateFn;
    getImageGroups: (
        translate: TranslateFn,
        appId: string,
    ) => {
        promptFields: EngineFieldDefinition[];
        sizeFields: EngineFieldDefinition[];
        samplingFields: EngineFieldDefinition[];
        batchFields: EngineFieldDefinition[];
    };
    getTextFields: (translate: TranslateFn) => EngineFieldDefinition[];
    getCoreModelField: (
        translate: TranslateFn,
        modelPlaceholder: string,
        isImage: boolean,
    ) => EngineFieldDefinition;
    getComputeModeField: (translate: TranslateFn) => EngineFieldDefinition;
    getImageExtraArgsField: (translate: TranslateFn) => EngineFieldDefinition;
};

export class ModuleSettingsEngineRenderFlow {
    public constructor(private readonly _deps: ModuleSettingsEngineRenderFlowDeps) {}

    public render(options: ModuleSettingsEngineRenderOptions): void {
        const { app, config, container, html } = options;
        const isImage = app.capability === 'image';
        const modelPlaceholder = isImage
            ? String.raw`e.g. C:\Models\model.gguf or model.safetensors`
            : String.raw`e.g. C:\Models\model.gguf`;

        container.innerHTML = options.sanitizeHtml(html);

        const corePrimary = container.querySelector(`#local-engine-core-primary-${app.id}`);
        if (!(corePrimary instanceof HTMLElement)) {
            return;
        }

        this._renderCoreFields({
            container: corePrimary,
            appId: app.id,
            config,
            isImage,
            modelPlaceholder,
            translate: options.translate,
            getCoreModelField: options.getCoreModelField,
            getComputeModeField: options.getComputeModeField,
            getImageExtraArgsField: options.getImageExtraArgsField,
            getTextFields: options.getTextFields,
        });

        if (isImage) {
            this._renderImageFields({
                container,
                appId: app.id,
                config,
                translate: options.translate,
                getImageGroups: options.getImageGroups,
            });
            return;
        }

        this._deps.syncPromptTextareaHeights(corePrimary);
    }

    private _renderCoreFields(options: {
        container: HTMLElement;
        appId: string;
        config: EngineConfig | null;
        isImage: boolean;
        modelPlaceholder: string;
        translate: TranslateFn;
        getCoreModelField: ModuleSettingsEngineRenderOptions['getCoreModelField'];
        getComputeModeField: ModuleSettingsEngineRenderOptions['getComputeModeField'];
        getImageExtraArgsField: ModuleSettingsEngineRenderOptions['getImageExtraArgsField'];
        getTextFields: ModuleSettingsEngineRenderOptions['getTextFields'];
    }): void {
        const coreField = options.getCoreModelField(
            options.translate,
            options.modelPlaceholder,
            options.isImage,
        );
        const computeField = options.getComputeModeField(options.translate);

        this._deps.renderFieldRow(options.container, {
            ...coreField,
            isFile: true,
            isImage: options.isImage,
            appId: options.appId,
            config: options.config,
        });

        this._deps.renderFieldRow(options.container, {
            ...computeField,
            appId: options.appId,
            config: options.config,
        });

        if (options.isImage) {
            this._deps.renderModelProfiles(options.container, options.appId, options.config);

            this._deps.renderFieldRow(options.container, {
                ...options.getImageExtraArgsField(options.translate),
                appId: options.appId,
                config: options.config,
            });
            return;
        }

        options.getTextFields(options.translate).forEach((field) => {
            this._deps.renderFieldRow(options.container, {
                ...field,
                appId: options.appId,
                config: options.config,
            });
        });
    }

    private _renderImageFields(options: {
        container: HTMLElement;
        appId: string;
        config: EngineConfig | null;
        translate: TranslateFn;
        getImageGroups: ModuleSettingsEngineRenderOptions['getImageGroups'];
    }): void {
        const promptsGroup = options.container.querySelector(
            `#local-engine-prompts-${options.appId}`,
        );
        const sizeGroup = options.container.querySelector(`#local-engine-size-${options.appId}`);
        const samplingGroup = options.container.querySelector(
            `#local-engine-sampling-${options.appId}`,
        );
        const batchGroup = options.container.querySelector(`#local-engine-batch-${options.appId}`);
        if (
            !(promptsGroup instanceof HTMLElement) ||
            !(sizeGroup instanceof HTMLElement) ||
            !(samplingGroup instanceof HTMLElement) ||
            !(batchGroup instanceof HTMLElement)
        ) {
            return;
        }

        const imageGroups = options.getImageGroups(options.translate, options.appId);
        this._deps.renderFieldDefinitions(
            promptsGroup,
            imageGroups.promptFields,
            options.appId,
            options.config,
        );
        this._deps.syncPromptTextareaHeights(promptsGroup);
        this._deps.renderFieldDefinitions(
            sizeGroup,
            imageGroups.sizeFields,
            options.appId,
            options.config,
        );
        this._deps.renderFieldDefinitions(
            samplingGroup,
            imageGroups.samplingFields,
            options.appId,
            options.config,
        );
        this._deps.renderFieldDefinitions(
            batchGroup,
            imageGroups.batchFields,
            options.appId,
            options.config,
        );
    }
}
