import DOMPurify from 'dompurify';

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IApp } from '@/shared/types/coreTypes';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { SettingsService } from '../services/SettingsService';
import type { EngineConfigService, EngineConfig } from '@/features/ai/services/EngineConfigService';
import type { IModuleSettingsUIContext } from './SettingsContext';
import {
    ModuleSettingsEngineFieldCatalog,
    type EngineFieldDefinition,
} from './ModuleSettingsEngineFieldCatalog';
import {
    createEngineInfoPopover,
    type EngineInfoPopoverHandle,
    type EngineInfoPopoverRuntime,
} from './ModuleSettingsEngineInfoPopover';
import { ModuleSettingsEngineFieldController } from './ModuleSettingsEngineFieldController';
import {
    createEngineCustomSelectField,
    type EngineCustomSelectControl,
} from './ModuleSettingsEngineSelectField';
import {
    createEngineExtraArgsField,
    getEngineModelFileFilters,
    getEngineModelFileName,
    ModuleSettingsEngineInputFactory,
    syncEnginePromptTextareaHeights,
    type EngineExtraArgsControl,
} from './ModuleSettingsEngineFieldSupport';
import { ModuleSettingsEngineHtmlBuilder } from './ModuleSettingsEngineHtmlBuilder';
import { ModuleSettingsEngineRenderFlow } from './ModuleSettingsEngineRenderFlow';
import { ModuleSettingsEngineFieldRowRenderer } from './ModuleSettingsEngineFieldRowRenderer';

type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';
type EngineInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type CustomSelectControl = EngineCustomSelectControl;
type ExtraArgsControl = EngineExtraArgsControl;
type EngineFieldControlOptions = {
    type: EngineFieldType;
    key: string;
    isEngineConfig: boolean;
    appId: string;
    fileKind?: 'model';
    placeholder?: string;
    defaultValue?: number | string;
    min?: number;
    max?: number;
    options?: string[];
    optionLabels?: Record<string, string>;
};
type EngineFieldControlResult = {
    input: HTMLElement;
    engineInput: EngineInputElement;
    customSelect: CustomSelectControl | null;
    extraArgsControl: ExtraArgsControl | null;
};

type LocalEngineModelProfile = {
    id: string;
    name: string;
    modelPath: string;
    extraArgs: string[];
    generationSettings?: Record<string, string | number | null>;
};

const IMAGE_GENERATION_PRESET_SETTING_SUFFIXES = [
    'positive_prompt',
    'negative_prompt',
    'width',
    'height',
    'steps',
    'cfg_scale',
    'denoising_strength',
    'sampler',
    'scheduler',
    'seed',
    'clip_skip',
    'batch_size',
] as const;

const ENGINE_HTML_SANITIZE_OPTIONS: Parameters<typeof DOMPurify.sanitize>[1] = {
    ALLOW_DATA_ATTR: true,
    ALLOWED_TAGS: [
        'div',
        'section',
        'h3',
        'h4',
        'span',
        'p',
        'input',
        'button',
        'label',
        'ul',
        'li',
        'strong',
    ],
    ALLOWED_ATTR: [
        'class',
        'id',
        'data-provider-id',
        'data-i18n',
        'data-status',
        'style',
        'aria-labelledby',
        'type',
        'placeholder',
        'value',
        'min',
        'max',
        'step',
    ],
};

type ModuleSettingsEngineRendererDeps = {
    service: SettingsService;
    tauri: TauriProvider;
    engineConfigService: EngineConfigService;
    getContext: () => IModuleSettingsUIContext;
    registerCleanup: (cleanup: () => void) => void;
    debouncedSave: (key: string, value: string | number | boolean | null) => void;
    notifySettingsChanged: () => void;
    showSaveIndicator: () => void;
    showSaveErrorIndicator: () => void;
    tracer: Pick<LoggerService, 'error'>;
};

function createEngineInfoPopoverRuntime(): EngineInfoPopoverRuntime {
    return {
        requestAnimationFrame: (callback) => globalThis.requestAnimationFrame(callback),
        getViewportSize: () => ({
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
        }),
        addWindowListener: (type, listener, options) => {
            globalThis.addEventListener(type, listener, options);
        },
        removeWindowListener: (type, listener, options) => {
            globalThis.removeEventListener(type, listener, options);
        },
    };
}

export class ModuleSettingsEngineRenderer {
    private readonly _extraArgsControls = new Map<string, ExtraArgsControl>();
    private readonly _customSelectControls = new Map<string, CustomSelectControl>();
    private readonly _fieldCatalog = new ModuleSettingsEngineFieldCatalog();
    private readonly _fieldController: ModuleSettingsEngineFieldController;
    private readonly _fieldRowRenderer: ModuleSettingsEngineFieldRowRenderer;
    private readonly _htmlBuilder: ModuleSettingsEngineHtmlBuilder;
    private readonly _inputFactory: ModuleSettingsEngineInputFactory;
    private readonly _renderFlow: ModuleSettingsEngineRenderFlow;
    private _activeEngineInfoPopover: EngineInfoPopoverHandle | null = null;
    private readonly _runtime: EngineInfoPopoverRuntime;

    constructor(private readonly _deps: ModuleSettingsEngineRendererDeps) {
        this._runtime = createEngineInfoPopoverRuntime();
        this._fieldController = new ModuleSettingsEngineFieldController(
            this._createFieldControllerDeps(),
        );
        this._htmlBuilder = new ModuleSettingsEngineHtmlBuilder((key, fallback) =>
            this._translate(key, fallback),
        );
        this._inputFactory = new ModuleSettingsEngineInputFactory({
            requestAnimationFrame: (callback) => this._runtime.requestAnimationFrame(callback),
        });
        this._fieldRowRenderer = new ModuleSettingsEngineFieldRowRenderer(
            this._createFieldRowRendererDeps(),
        );
        this._renderFlow = new ModuleSettingsEngineRenderFlow(this._createRenderFlowDeps());
    }

    private get _context(): IModuleSettingsUIContext {
        return this._deps.getContext();
    }

    private _createFieldControllerDeps(): ConstructorParameters<
        typeof ModuleSettingsEngineFieldController
    >[0] {
        return {
            getSettings: () =>
                this._deps.service.getSettings() as Record<
                    string,
                    string | number | null | undefined
                >,
            setConfig: async (config) => {
                try {
                    await this._deps.engineConfigService.setConfig(config);
                    this._deps.notifySettingsChanged();
                } catch (error) {
                    this._deps.tracer.error(
                        '[ModuleSettingsEngineRenderer] setConfig failed:',
                        error,
                    );
                    throw error;
                }
            },
            debouncedSave: (key, value) => {
                this._deps.debouncedSave(key, value);
            },
            showSaveIndicator: () => {
                this._deps.showSaveIndicator();
            },
            showSaveErrorIndicator: () => {
                this._deps.showSaveErrorIndicator();
            },
            translate: (key, fallback) => this._translate(key, fallback),
            getModelFileName: (modelPath) => this._getModelFileName(modelPath),
            getModelFileFilters: (fileKind, isImage) =>
                getEngineModelFileFilters(fileKind, isImage),
            tracer: this._deps.tracer,
        };
    }

    private _createFieldRowRendererDeps(): ConstructorParameters<
        typeof ModuleSettingsEngineFieldRowRenderer
    >[0] {
        return {
            createControl: (options) => this._createEngineFieldControl(options),
            setupInitialValue: (input, options) =>
                this._setupEngineFieldInitialValue(input, options),
            setupEvents: (input, options) => this._setupEngineFieldEvents(input, options),
            registerCleanup: (cleanup) => {
                this._deps.registerCleanup(cleanup);
            },
            getModelFileName: (path) => this._getModelFileName(path),
            isTauri: () => this._deps.tauri.isTauri(),
            addFileBrowseButton: (container, input, isImage, fileKind) => {
                this._fieldController.addFileBrowseButton(container, input, isImage, fileKind);
            },
            getExtraArgsInfoText: () =>
                this._translate('ui.settings.engine.extra_args.info', 'Extra arguments info'),
            toggleInfoPopover: (anchor, appId, config) => {
                this._toggleEngineInfoPopover(anchor, appId, config);
            },
        };
    }

    private _createRenderFlowDeps(): ConstructorParameters<
        typeof ModuleSettingsEngineRenderFlow
    >[0] {
        return {
            renderFieldDefinitions: (container, definitions, appId, config) => {
                this._renderFieldDefinitions(container, definitions, appId, config);
            },
            renderModelProfiles: (container, appId, config) => {
                this._renderModelProfiles(container, appId, config);
            },
            renderFieldRow: (container, options) => {
                this._fieldRowRenderer.render(container, options);
            },
            syncPromptTextareaHeights: (container) => {
                this._syncPromptTextareaHeights(container);
            },
        };
    }

    private _translate(key: string, fallback?: string): string {
        return this._context.t(key, fallback);
    }

    public reset(): void {
        this._closeEngineInfoPopover();
        this._extraArgsControls.clear();
        this._customSelectControls.clear();
    }

    public async render(container: HTMLElement, app: IApp): Promise<void> {
        const payload = await this._deps.engineConfigService.getSettingsPayload(app.id);
        const config = payload?.config ?? null;
        const rawHtml = this._htmlBuilder.buildEngineConfigHtml(app, config);
        container.innerHTML = '';
        this._renderFlow.render({
            container,
            app,
            config,
            html: rawHtml,
            sanitizeHtml: (html) => this._sanitizeEngineHtml(html),
            translate: (key, fallback) => this._translate(key, fallback),
            getImageGroups: (translate, appId) =>
                this._fieldCatalog.buildImageEngineGroups(translate, appId),
            getTextFields: (translate) => this._fieldCatalog.buildTextEngineFields(translate),
            getCoreModelField: (translate, modelPlaceholder, isImage) =>
                this._fieldCatalog.buildCoreModelField(translate, modelPlaceholder, isImage),
            getComputeModeField: (translate) => this._fieldCatalog.buildComputeModeField(translate),
            getImageExtraArgsField: (translate) =>
                this._fieldCatalog.buildImageExtraArgsField(translate),
        });
    }

    private _renderFieldDefinitions(
        container: HTMLElement,
        definitions: EngineFieldDefinition[],
        appId: string,
        config: EngineConfig | null,
    ): void {
        definitions.forEach((definition) => {
            this._fieldRowRenderer.render(container, {
                ...definition,
                appId,
                config,
            });
        });
    }

    private _syncPromptTextareaHeights(container: HTMLElement): void {
        syncEnginePromptTextareaHeights(
            container,
            (callback) => this._runtime.requestAnimationFrame(callback),
            (cleanup) => {
                this._deps.registerCleanup(cleanup);
            },
        );
    }

    private _sanitizeEngineHtml(rawHtml: string): string {
        return DOMPurify.sanitize(rawHtml, ENGINE_HTML_SANITIZE_OPTIONS);
    }

    private _getModelFileName(modelPath: string): string {
        return getEngineModelFileName(
            modelPath,
            this._context.t('ui.settings.engine.model_not_selected', 'Model not selected'),
        );
    }

    private _createEngineFieldControl(
        options: EngineFieldControlOptions,
    ): EngineFieldControlResult {
        if (options.type === 'select' && options.isEngineConfig && options.key === 'compute_mode') {
            return this._createComputeModeControl(options);
        }

        if (options.type === 'select') {
            return this._createSelectFieldControl(options);
        }

        if (options.isEngineConfig && options.key === 'extra_args') {
            return this._createExtraArgsFieldControl(options.appId);
        }

        if (options.type === 'textarea') {
            const input = this._inputFactory.createTextAreaField(options);
            return this._createPlainFieldControl(input);
        }

        const input = this._inputFactory.createTextInputField(options);
        return this._createPlainFieldControl(input);
    }

    private _createSelectFieldControl(
        options: EngineFieldControlOptions,
    ): EngineFieldControlResult {
        const customSelect = createEngineCustomSelectField(this._runtime, options);
        this._customSelectControls.set(
            this._getFieldControlKey(options.appId, options.key),
            customSelect,
        );
        return {
            input: customSelect.root,
            engineInput: customSelect.input,
            customSelect,
            extraArgsControl: null,
        };
    }

    private _createComputeModeControl(
        options: EngineFieldControlOptions,
    ): EngineFieldControlResult {
        const root = document.createElement('div');
        root.className = 'local-engine-compute-toggle';

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.className = 'local-engine-compute-value';

        const buttons = new Map<string, HTMLButtonElement>();
        const syncDisplay = () => {
            const currentValue =
                hiddenInput.value === ''
                    ? String(options.defaultValue ?? 'gpu')
                    : hiddenInput.value;
            buttons.forEach((button, value) => {
                const selected = value === currentValue;
                button.classList.toggle('selected', selected);
                button.setAttribute('aria-pressed', String(selected));
            });
        };

        options.options?.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'thinking-option-card local-engine-compute-option';
            button.dataset['value'] = option;
            button.setAttribute('aria-pressed', 'false');

            const title = document.createElement('span');
            title.className = 'thinking-option-title';
            title.textContent = options.optionLabels?.[option] ?? option;

            button.append(title);
            button.addEventListener('click', () => {
                hiddenInput.value = option;
                syncDisplay();
                hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
            });

            buttons.set(option, button);
            root.appendChild(button);
        });

        root.prepend(hiddenInput);

        return {
            input: root,
            engineInput: hiddenInput,
            customSelect: {
                input: hiddenInput,
                root,
                syncDisplay,
                destroy: () => {
                    return;
                },
            },
            extraArgsControl: null,
        };
    }

    private _getFieldControlKey(appId: string, key: string): string {
        return `${appId}:${key}`;
    }

    private _createExtraArgsFieldControl(appId: string): EngineFieldControlResult {
        const extraArgsControl = createEngineExtraArgsField((key, fallback) =>
            this._translate(key, fallback),
        );
        this._extraArgsControls.set(appId, extraArgsControl);
        return {
            input: extraArgsControl.root,
            engineInput: extraArgsControl.input,
            customSelect: null,
            extraArgsControl,
        };
    }

    private _createPlainFieldControl(input: EngineInputElement): EngineFieldControlResult {
        return { input, engineInput: input, customSelect: null, extraArgsControl: null };
    }

    private _renderModelProfiles(
        container: HTMLElement,
        appId: string,
        config: EngineConfig | null,
    ): void {
        const section = document.createElement('div');
        section.className = 'local-engine-model-profiles';

        const header = document.createElement('div');
        header.className = 'settings-card-header-center local-engine-section-header';
        const title = document.createElement('h3');
        title.textContent = this._translate(
            'ui.settings.engine.generation_presets',
            'Generation Presets',
        );
        header.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'ai-models-grid local-engine-profile-grid';

        const profiles = this._getModelProfiles(appId);
        profiles.forEach((profile) => {
            grid.appendChild(this._createModelProfileCard(appId, profile, config));
        });
        grid.appendChild(this._createSaveModelProfileCard(appId, config));

        section.append(header, grid);
        container.appendChild(section);
    }

    private _createModelProfileCard(
        appId: string,
        profile: LocalEngineModelProfile,
        config: EngineConfig | null,
    ): HTMLDivElement {
        const card = document.createElement('div');
        const selected = config?.model_path === profile.modelPath;
        card.className = `ai-model-card ai-model-card--custom local-engine-profile-card${selected ? ' selected' : ''}`;
        card.tabIndex = 0;
        card.role = 'option';
        card.setAttribute('aria-selected', String(selected));

        const copy = document.createElement('div');
        copy.className = 'ai-model-card-copy';

        const name = document.createElement('div');
        name.className = 'model-name';
        name.textContent = this._getModelProfileDisplayName(profile);
        name.title = profile.modelPath;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ai-model-card-remove ai-model-card-action';
        remove.textContent = this._translate('ui.settings.custom_model_remove_button', 'Delete');
        remove.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._deleteModelProfile(appId, profile.id);
            card.remove();
        });

        const apply = () => this._applyModelProfile(appId, profile, config, card);
        card.addEventListener('click', apply);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                apply();
            }
        });

        copy.append(name);
        card.append(copy, remove);
        return card;
    }

    private _getModelProfileDisplayName(profile: LocalEngineModelProfile): string {
        return (profile.name.trim() || this._getModelFileName(profile.modelPath)).replace(
            /\.(?:gguf|safetensors)$/iu,
            '',
        );
    }

    private _createSaveModelProfileCard(
        appId: string,
        config: EngineConfig | null,
    ): HTMLDivElement {
        const card = document.createElement('div');
        card.className = 'ai-model-card ai-model-card--composer local-engine-profile-card';
        card.role = 'button';
        card.tabIndex = 0;

        const name = document.createElement('div');
        name.className = 'model-name';
        name.textContent = this._translate('ui.settings.engine.profile_save', 'Save Current');

        const desc = document.createElement('div');
        desc.className = 'model-desc';
        desc.textContent = this._translate(
            'ui.settings.engine.profile_save_desc',
            'Store model, generation settings, and startup flags.',
        );

        const body = document.createElement('div');
        body.className = 'model-pricing ai-custom-model-composer-body';

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'ai-check-btn ai-custom-model-save-btn';
        saveButton.textContent = this._translate('ui.settings.engine.profile_save_button', 'Save');

        const save = () => this._saveCurrentModelProfile(appId, config, card);
        saveButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            save();
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                save();
            }
        });

        body.append(saveButton);
        card.append(name, desc, body);
        return card;
    }

    private _getModelProfiles(appId: string): LocalEngineModelProfile[] {
        const raw = this._deps.service.getSettings()[`${appId}_model_profiles`];
        if (typeof raw !== 'string' || raw.trim() === '') {
            return [];
        }

        try {
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .filter((item): item is LocalEngineModelProfile => {
                    if (typeof item !== 'object' || item === null) return false;
                    const candidate = item as Record<string, unknown>;
                    return (
                        typeof candidate['id'] === 'string' &&
                        typeof candidate['name'] === 'string' &&
                        typeof candidate['modelPath'] === 'string' &&
                        Array.isArray(candidate['extraArgs']) &&
                        candidate['extraArgs'].every((arg) => typeof arg === 'string') &&
                        (candidate['generationSettings'] === undefined ||
                            (typeof candidate['generationSettings'] === 'object' &&
                                candidate['generationSettings'] !== null))
                    );
                })
                .slice(0, 8);
        } catch {
            return [];
        }
    }

    private _saveModelProfiles(appId: string, profiles: LocalEngineModelProfile[]): void {
        this._deps.debouncedSave(`${appId}_model_profiles`, JSON.stringify(profiles.slice(0, 8)));
        this._deps.notifySettingsChanged();
        this._deps.showSaveIndicator();
    }

    private _saveCurrentModelProfile(
        appId: string,
        config: EngineConfig | null,
        card: HTMLElement,
    ): void {
        const modelPath = config?.model_path?.trim() ?? '';
        if (modelPath === '') {
            this._context.showToast(
                this._translate(
                    'ui.settings.engine.profile_select_model_first',
                    'Select a model first',
                ),
                'info',
            );
            return;
        }

        const profiles = this._getModelProfiles(appId).filter(
            (profile) => profile.modelPath !== modelPath,
        );
        const profile: LocalEngineModelProfile = {
            id: `profile-${Date.now()}`,
            name: this._getModelFileName(modelPath),
            modelPath,
            extraArgs: this._extraArgsControls.get(appId)?.getGroups() ?? config?.extra_args ?? [],
            generationSettings: this._readGenerationPresetSettings(
                appId,
                card.closest<HTMLElement>('.local-engine-config') ?? undefined,
            ),
        };
        profiles.unshift(profile);
        this._saveModelProfiles(appId, profiles);
        const grid = card.closest('.local-engine-profile-grid');
        grid?.insertBefore(this._createModelProfileCard(appId, profile, config), card);
    }

    private _deleteModelProfile(appId: string, profileId: string): void {
        this._saveModelProfiles(
            appId,
            this._getModelProfiles(appId).filter((profile) => profile.id !== profileId),
        );
    }

    private _applyModelProfile(
        appId: string,
        profile: LocalEngineModelProfile,
        config: EngineConfig | null,
        card: HTMLElement,
    ): void {
        if (config === null) {
            return;
        }

        config.model_path = profile.modelPath;
        config.extra_args = [...profile.extraArgs];
        this._applyGenerationPresetSettings(appId, profile.generationSettings ?? {});
        void this._deps.engineConfigService
            .setConfig(config)
            .then(() => {
                this._deps.notifySettingsChanged();
                this._deps.showSaveIndicator();
            })
            .catch((error: unknown) => {
                this._deps.tracer.error('[ModuleSettingsUI] Failed to apply model profile', error);
                this._deps.showSaveErrorIndicator();
            });

        const root = card.closest('.local-engine-config');
        const modelInput = root?.querySelector<HTMLInputElement>(
            '.local-engine-field-row--model-path input',
        );
        if (modelInput !== null && modelInput !== undefined) {
            modelInput.dataset['fullPath'] = profile.modelPath;
            modelInput.value = this._getModelFileName(profile.modelPath);
            modelInput.title = profile.modelPath;
        }
        this._extraArgsControls.get(appId)?.setGroups(profile.extraArgs, { emit: false });

        root?.querySelectorAll('.local-engine-profile-card').forEach((node) => {
            node.classList.toggle('selected', node === card);
            node.setAttribute('aria-selected', String(node === card));
        });
    }

    private _readGenerationPresetSettings(
        appId: string,
        root: HTMLElement | Document = document,
    ): Record<string, string | number | null> {
        const settings = this._deps.service.getSettings();
        return Object.fromEntries(
            IMAGE_GENERATION_PRESET_SETTING_SUFFIXES.map((suffix) => {
                const key = `${appId}_${suffix}`;
                const value = this._readGenerationPresetInputValue(root, key) ?? settings[key];
                return [key, typeof value === 'string' || typeof value === 'number' ? value : null];
            }),
        );
    }

    private _readGenerationPresetInputValue(
        root: HTMLElement | Document,
        key: string,
    ): string | number | null | undefined {
        const keyClass = key.replaceAll('_', '-');
        const input = root.querySelector<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >(
            `.local-engine-field-row--${keyClass} input, .local-engine-field-row--${keyClass} select, .local-engine-field-row--${keyClass} textarea`,
        );
        if (input === null) {
            return undefined;
        }

        const value = input.value.trim();
        if (value === '') {
            return null;
        }
        if (input instanceof HTMLInputElement && input.type === 'number') {
            const numericValue = Number(value);
            return Number.isFinite(numericValue) ? numericValue : value;
        }
        return value;
    }

    private _applyGenerationPresetSettings(
        appId: string,
        generationSettings: Record<string, string | number | null>,
    ): void {
        Object.entries(generationSettings).forEach(([key, value]) => {
            this._deps.debouncedSave(key, value);
            this._syncGenerationSettingInput(appId, key, value);
        });
    }

    private _syncGenerationSettingInput(
        appId: string,
        key: string,
        value: string | number | null,
    ): void {
        const root = document.querySelector<HTMLElement>('.local-engine-config');
        const keyClass = key.replaceAll('_', '-');
        const input = root?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            `.local-engine-field-row--${keyClass} input, .local-engine-field-row--${keyClass} textarea`,
        );
        if (input === null || input === undefined) {
            return;
        }

        input.value = value === null ? '' : String(value);
        this._customSelectControls.get(this._getFieldControlKey(appId, key))?.syncDisplay();
    }

    private _appendExtraArgs(appId: string, groups: string[]): number {
        const control = this._extraArgsControls.get(appId);
        if (control === undefined) return 0;

        const nextGroups = [...control.getGroups()];
        const seen = new Set(nextGroups);
        let added = 0;

        groups.forEach((group) => {
            if (!seen.has(group)) {
                seen.add(group);
                nextGroups.push(group);
                added += 1;
            }
        });

        if (added > 0) {
            control.setGroups(nextGroups);
        }

        return added;
    }

    private _toggleEngineInfoPopover(
        anchor: HTMLButtonElement,
        appId: string,
        config: EngineConfig | null = null,
    ): void {
        if (this._activeEngineInfoPopover !== null) {
            if (this._activeEngineInfoPopover.popover.dataset['appId'] === appId) {
                this._closeEngineInfoPopover();
                return;
            }
            this._closeEngineInfoPopover();
        }

        this._openEngineInfoPopover(anchor, appId, config);
    }

    private _openEngineInfoPopover(
        anchor: HTMLButtonElement,
        appId: string,
        config: EngineConfig | null,
    ): void {
        this._activeEngineInfoPopover = createEngineInfoPopover({
            anchor,
            appId,
            runtime: this._runtime,
            translate: (key, fallback) => this._translate(key, fallback),
            appendExtraArgs: (targetAppId, groups) => this._appendExtraArgs(targetAppId, groups),
            getCurrentExtraArgs: (targetAppId) =>
                this._extraArgsControls.get(targetAppId)?.getGroups() ?? [],
            getRecommendationContext: () => ({
                config,
                settings: this._deps.service.getSettings() as Record<string, unknown>,
            }),
            showToast: (message, type) => this._context.showToast(message, type),
            onClose: () => {
                if (this._activeEngineInfoPopover?.popover.dataset['appId'] === appId) {
                    this._activeEngineInfoPopover = null;
                }
            },
        });
    }

    private _closeEngineInfoPopover(): void {
        const popover = this._activeEngineInfoPopover;
        this._activeEngineInfoPopover = null;
        popover?.close();
    }

    private _setupEngineFieldInitialValue(
        input: EngineInputElement,
        options: {
            key: string;
            isEngineConfig: boolean;
            defaultValue?: number | string;
            config: EngineConfig | null;
        },
    ): void {
        this._fieldController.setupInitialValue(input, options);
    }

    private _setupEngineFieldEvents(
        input: EngineInputElement,
        options: {
            key: string;
            type: EngineFieldType;
            isEngineConfig: boolean;
            isFile?: boolean;
            config: EngineConfig | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
            appId: string;
        },
    ): void {
        this._fieldController.setupEvents(input, options);
    }
}
