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
    type EngineExtraArgsControl,
} from './ModuleSettingsEngineExtraArgsField';
import {
    renderEnginePerformanceModeField,
    syncEnginePromptTextareaHeights,
} from './ModuleSettingsEngineLayoutHelpers';
import { formatEngineFieldSaveValue } from './ModuleSettingsEngineFieldState';
import { ModuleSettingsEngineHtmlBuilder } from './ModuleSettingsEngineHtmlBuilder';
import { ModuleSettingsEngineInputFactory } from './ModuleSettingsEngineInputFactory';
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
    placeholder?: string;
    min?: number;
    max?: number;
    options?: string[];
};
type EngineFieldControlResult = {
    input: HTMLElement;
    engineInput: EngineInputElement;
    customSelect: CustomSelectControl | null;
    extraArgsControl: ExtraArgsControl | null;
};
type ModelFileFilter = { name: string; extensions: string[] };

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
    showSaveIndicator: () => void;
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
                this._deps.service.getSettings() as Record<string, string | number | undefined>,
            setConfig: (config) => {
                void this._deps.engineConfigService.setConfig(config);
            },
            debouncedSave: (key, value) => {
                this._deps.debouncedSave(key, value);
            },
            showSaveIndicator: () => {
                this._deps.showSaveIndicator();
            },
            translate: (key, fallback) => this._translate(key, fallback),
            getModelFileName: (modelPath) => this._getModelFileName(modelPath),
            getModelFileFilters: (isImage) => this._getModelFileFilters(isImage),
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
            addFileBrowseButton: (container, input, isImage) => {
                this._addFileBrowseButton(container, input, isImage);
            },
            getExtraArgsInfoText: () =>
                this._translate('ui.settings.engine.extra_args.info', 'Extra arguments info'),
            toggleInfoPopover: (anchor, appId) => {
                this._toggleEngineInfoPopover(anchor, appId);
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
            renderPerformanceModeFieldRow: (container, appId) => {
                this._renderPerformanceModeFieldRow(container, appId);
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

    public _escapeHtml(value: string): string {
        return this._htmlBuilder.escapeHtml(value);
    }

    private _getModelFileName(modelPath: string): string {
        if (modelPath.trim() === '') {
            return this._context.t('ui.settings.engine.model_not_selected', 'Model not selected');
        }
        const normalized = modelPath.replaceAll('\\', '/');
        return normalized.split('/').pop() ?? modelPath;
    }

    public _getEngineConfigHtml(app: IApp, config: EngineConfig | null): string {
        return this._htmlBuilder.buildEngineConfigHtml(app, config);
    }

    private _createEngineFieldControl(
        options: EngineFieldControlOptions,
    ): EngineFieldControlResult {
        if (options.type === 'select') {
            return this._createSelectFieldControl(options);
        }

        if (options.isEngineConfig && options.key === 'extra_args') {
            return this._createExtraArgsFieldControl(options.appId);
        }

        if (options.type === 'textarea') {
            const input = this._createTextAreaField(options);
            return this._createPlainFieldControl(input);
        }

        const input = this._createTextInputField(options);
        return this._createPlainFieldControl(input);
    }

    private _createSelectFieldControl(
        options: EngineFieldControlOptions,
    ): EngineFieldControlResult {
        const customSelect = this._createCustomSelectField(options);
        return {
            input: customSelect.root,
            engineInput: customSelect.input,
            customSelect,
            extraArgsControl: null,
        };
    }

    private _createExtraArgsFieldControl(appId: string): EngineFieldControlResult {
        const extraArgsControl = this._createExtraArgsField();
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

    public _renderEngineFieldRow(
        container: HTMLElement,
        options: {
            label: string;
            key: string;
            type: EngineFieldType;
            isEngineConfig: boolean;
            placeholder?: string;
            defaultValue?: number | string;
            options?: string[];
            min?: number;
            max?: number;
            isFile?: boolean;
            isImage?: boolean;
            description?: string;
            fullWidth?: boolean;
            showInfoButton?: boolean;
            appId: string;
            config: EngineConfig | null;
        },
    ): void {
        this._fieldRowRenderer.render(container, options);
    }

    private _renderPerformanceModeFieldRow(container: HTMLElement, appId: string): void {
        renderEnginePerformanceModeField(
            container,
            appId,
            this._deps.service.getSettings() as Record<string, string | boolean | undefined>,
            (key, fallback) => this._translate(key, fallback),
            (key, value) => this._deps.debouncedSave(key, value),
        );
    }

    private _createExtraArgsField(): ExtraArgsControl {
        return createEngineExtraArgsField((key, fallback) => this._translate(key, fallback));
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

    private _toggleEngineInfoPopover(anchor: HTMLButtonElement, appId: string): void {
        if (this._activeEngineInfoPopover !== null) {
            if (this._activeEngineInfoPopover.popover.dataset['appId'] === appId) {
                this._closeEngineInfoPopover();
                return;
            }
            this._closeEngineInfoPopover();
        }

        this._openEngineInfoPopover(anchor, appId);
    }

    private _openEngineInfoPopover(anchor: HTMLButtonElement, appId: string): void {
        this._activeEngineInfoPopover = createEngineInfoPopover({
            anchor,
            appId,
            runtime: this._runtime,
            translate: (key, fallback) => this._translate(key, fallback),
            appendExtraArgs: (targetAppId, groups) => this._appendExtraArgs(targetAppId, groups),
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

    private _createCustomSelectField(options: { options?: string[] }): CustomSelectControl {
        return createEngineCustomSelectField(this._runtime, options);
    }

    private _createTextAreaField(options: { placeholder?: string }): HTMLTextAreaElement {
        return this._inputFactory.createTextAreaField(options);
    }

    private _createTextInputField(options: {
        type: EngineFieldType;
        placeholder?: string;
        min?: number;
        max?: number;
    }): HTMLInputElement {
        return this._inputFactory.createTextInputField(options);
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

    private _addFileBrowseButton(
        container: HTMLElement,
        input: HTMLInputElement,
        isImage: boolean,
    ): void {
        this._fieldController.addFileBrowseButton(container, input, isImage);
    }

    private _getModelFileFilters(isImage: boolean): ModelFileFilter[] {
        if (isImage) {
            return [
                { name: 'SD Models', extensions: ['gguf', 'safetensors'] },
                { name: 'GGUF Models', extensions: ['gguf'] },
                { name: 'SafeTensors', extensions: ['safetensors'] },
            ];
        }

        return [{ name: 'GGUF Models', extensions: ['gguf'] }];
    }

    public _parseEngineFieldValue(
        raw: string,
        options: {
            type: EngineFieldType;
            min?: number;
            max?: number;
            defaultValue?: number | string;
        },
    ): { value: string | number | null; displayValue: string } {
        return this._fieldController.parseValue(raw, options);
    }

    public _formatEngineFieldSaveValue(
        key: string,
        value: string | number | null,
    ): string | number | string[] | null {
        return formatEngineFieldSaveValue(key, value);
    }

    public _handleEngineFieldSave(
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
            appId?: string;
        },
    ): void {
        this._fieldController.handleSave(input, options);
    }
}
