import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';

import { ModuleSettingsEngineRenderer } from './ModuleSettingsEngineRenderer';
import { ModuleSettingsEngineFieldController } from './ModuleSettingsEngineFieldController';
import {
    createEngineExtraArgsField,
    getEngineModelFileFilters,
    getEngineModelFileName,
    formatEngineFieldSaveValue,
    ModuleSettingsEngineInputFactory,
    parseEngineFieldValue,
    renderEnginePerformanceModeField,
    setupInitialEngineFieldValue,
} from './ModuleSettingsEngineFieldSupport';
import { ModuleSettingsEngineHtmlBuilder } from './ModuleSettingsEngineHtmlBuilder';
import { createEngineCustomSelectField } from './ModuleSettingsEngineSelectField';
import type { IModuleSettingsUIContext } from './SettingsContext';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

type ExtraArgsControl = {
    root: HTMLDivElement;
    input: HTMLInputElement;
    syncTokens: () => void;
    getGroups: () => string[];
    setGroups: (groups: string[]) => void;
};

type RendererPrivate = {
    _extraArgsControls: Map<string, ExtraArgsControl>;
    _fieldRowRenderer: {
        render: (container: HTMLElement, options: Record<string, unknown>) => void;
    };
    _appendExtraArgs: (appId: string, groups: string[]) => number;
    _toggleEngineInfoPopover: (
        anchor: HTMLButtonElement,
        appId: string,
        config?: Record<string, unknown> | null,
    ) => void;
};

function createRendererHarness(options?: {
    settings?: Record<string, unknown>;
    isTauri?: boolean;
}) {
    const cleanupHandlers: Array<() => void> = [];
    const showToast = vi.fn();
    const debouncedSave = vi.fn();
    const notifySettingsChanged = vi.fn();
    const showSaveIndicator = vi.fn();
    const setConfig = vi.fn().mockResolvedValue(undefined);
    let animationTime = 0;
    const runtime = {
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
            animationTime += 120;
            callback(animationTime);
            return animationTime;
        }),
        getViewportSize: vi.fn(() => ({ width: 1440, height: 900 })),
        addWindowListener: vi.fn(),
        removeWindowListener: vi.fn(),
    };
    const context: IModuleSettingsUIContext = {
        t: (key: string, defaultValue?: string) => `t:${key}:${defaultValue ?? ''}`,
        showToast,
        i18nUI: { applyTranslations: vi.fn() } as never,
    };

    const renderer = new ModuleSettingsEngineRenderer({
        service: {
            getSettings: vi.fn().mockReturnValue(options?.settings ?? {}),
        } as never,
        tauri: {
            isTauri: vi.fn().mockReturnValue(options?.isTauri ?? false),
        } as never,
        engineConfigService: {
            setConfig,
        } as never,
        getContext: () => context,
        registerCleanup: (cleanup) => {
            cleanupHandlers.push(cleanup);
        },
        debouncedSave,
        notifySettingsChanged,
        showSaveIndicator,
        tracer: {
            error: vi.fn(),
        },
    });
    (renderer as unknown as { _runtime: typeof runtime })._runtime = runtime;

    return {
        renderer: renderer as unknown as RendererPrivate,
        cleanupHandlers,
        context,
        showToast,
        debouncedSave,
        notifySettingsChanged,
        showSaveIndicator,
        setConfig,
        runtime,
    };
}

function createFieldControllerHarness() {
    const setConfig = vi.fn();
    const debouncedSave = vi.fn();
    const showSaveIndicator = vi.fn();
    const error = vi.fn();
    const fieldController = new ModuleSettingsEngineFieldController({
        getSettings: () => ({}),
        setConfig,
        debouncedSave,
        showSaveIndicator,
        translate: (key, fallback) => `t:${key}:${fallback}`,
        getModelFileName: (modelPath) =>
            getEngineModelFileName(
                modelPath,
                't:ui.settings.engine.model_not_selected:Model not selected',
            ),
        getModelFileFilters: getEngineModelFileFilters,
        tracer: { error },
    });

    return { fieldController, setConfig, debouncedSave, showSaveIndicator, error };
}

describe('ModuleSettingsEngineRenderer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('should escape HTML, resolve model file names and build engine config html', () => {
        const htmlBuilder = new ModuleSettingsEngineHtmlBuilder(
            (key, fallback) => `t:${key}:${fallback}`,
        );

        expect(htmlBuilder.escapeHtml(`<tag attr="x">'&`)).toBe(
            '&lt;tag attr=&quot;x&quot;&gt;&#39;&amp;',
        );
        expect(
            getEngineModelFileName(
                'C:\\models\\llama.gguf',
                't:ui.settings.engine.model_not_selected:Model not selected',
            ),
        ).toBe('llama.gguf');
        expect(
            getEngineModelFileName(
                '',
                't:ui.settings.engine.model_not_selected:Model not selected',
            ),
        ).toBe('t:ui.settings.engine.model_not_selected:Model not selected');

        const imageHtml = htmlBuilder.buildEngineConfigHtml(
            { id: 'sdcpp', capability: 'image' },
            null,
        );
        const textHtml = htmlBuilder.buildEngineConfigHtml(
            { id: 'llamacpp', capability: 'text' },
            {} as never,
        );

        expect(imageHtml).toContain('t:ui.settings.engine.generation_presets:Generation Presets');
        expect(imageHtml).not.toContain('Auto download package');
        expect(imageHtml).toContain(
            't:ui.settings.engine.config_unavailable:Engine config unavailable (Tauri not connected)',
        );
        expect(textHtml).toContain('t:ui.settings.engine.core_config:Core Config');
    });

    it('should close stale custom select overlays when another select opens', () => {
        const { runtime } = createRendererHarness();
        const firstSelect = createEngineCustomSelectField(runtime, { options: ['one', 'two'] });
        const secondSelect = createEngineCustomSelectField(runtime, {
            options: ['alpha', 'beta'],
        });

        document.body.append(firstSelect.root, secondSelect.root);

        const firstTrigger = firstSelect.root.querySelector(
            '.local-engine-select-trigger',
        ) as HTMLButtonElement;
        const secondTrigger = secondSelect.root.querySelector(
            '.local-engine-select-trigger',
        ) as HTMLButtonElement;
        const menus = Array.from(
            document.querySelectorAll<HTMLDivElement>('.local-engine-select-menu'),
        );

        firstTrigger.click();
        expect(menus[0]?.classList.contains('open')).toBe(true);

        secondTrigger.click();

        expect(menus[0]?.classList.contains('open')).toBe(false);
        expect(menus[1]?.classList.contains('open')).toBe(true);
    });

    it('should cleanup select overlays when registered cleanup runs', () => {
        const { renderer, cleanupHandlers } = createRendererHarness();
        const container = document.createElement('div');

        renderer._fieldRowRenderer.render(container, {
            label: 'Sampler',
            key: 'sampler',
            type: 'select',
            isEngineConfig: false,
            options: ['Euler', 'DDIM'],
            appId: 'stable-diffusion',
            config: null,
        });

        expect(document.querySelectorAll('.local-engine-select-menu')).toHaveLength(1);

        cleanupHandlers.forEach((cleanup) => {
            cleanup();
        });

        expect(document.querySelectorAll('.local-engine-select-menu')).toHaveLength(0);
    });

    it('should render compute mode as a segmented control without a dropdown overlay', () => {
        const { renderer } = createRendererHarness();
        const container = document.createElement('div');
        const config = {
            engine_id: 'llamacpp',
            compute_mode: 'gpu',
            context_size: 4096,
            model_path: null,
            extra_args: [],
        };

        renderer._fieldRowRenderer.render(container, {
            label: 'Compute Device',
            key: 'compute_mode',
            type: 'select',
            isEngineConfig: true,
            options: ['gpu', 'cpu'],
            optionLabels: { gpu: 'GPU', cpu: 'CPU' },
            defaultValue: 'gpu',
            appId: 'llamacpp',
            config,
        });

        expect(container.querySelector('.local-engine-segmented-control')).toBeInstanceOf(
            HTMLDivElement,
        );
        expect(document.querySelector('.local-engine-select-menu')).toBeNull();

        const cpuButton = container.querySelector(
            '.local-engine-segmented-option[data-value="cpu"]',
        ) as HTMLButtonElement;
        cpuButton.click();

        expect(config.compute_mode).toBe('cpu');
        expect(cpuButton.classList.contains('is-selected')).toBe(true);
    });

    it('should localize extra args field labels and actions', () => {
        const control = createEngineExtraArgsField((key, fallback) => `t:${key}:${fallback}`);

        const hiddenInput = control.root.querySelector('.local-engine-tags-value');
        expect(hiddenInput).toBeInstanceOf(HTMLInputElement);

        control.setGroups(['--ctx-size 4096']);

        const chip = control.root.querySelector('.local-engine-tag-chip');
        expect(chip).toBeInstanceOf(HTMLButtonElement);
        expect((chip as HTMLButtonElement).title).toBe(
            't:ui.settings.engine.extra_args.remove:Remove',
        );
    });

    it('should append unique extra args and manage engine info popovers', async () => {
        const { renderer, showToast } = createRendererHarness();
        const control = createEngineExtraArgsField((key, fallback) => `t:${key}:${fallback}`);
        document.body.appendChild(control.root);
        renderer._extraArgsControls.set('llamacpp', control);

        expect(renderer._appendExtraArgs('llamacpp', ['--flash-attn', '--flash-attn'])).toBe(1);

        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWrite },
        });

        renderer._toggleEngineInfoPopover(anchor, 'llamacpp');
        const popover = document.querySelector('.local-engine-args-popover') as HTMLElement;
        expect(popover.textContent).toContain('Manual llama.cpp flags');

        (popover.querySelector('.local-engine-args-copy-all') as HTMLButtonElement).click();
        expect(showToast).toHaveBeenCalled();

        const firstItem = popover.querySelector('.local-engine-args-item') as HTMLElement;
        firstItem.click();
        await Promise.resolve();
        expect(showToast).toHaveBeenCalled();

        renderer._toggleEngineInfoPopover(anchor, 'llamacpp');
        expect(document.querySelector('.local-engine-args-popover.closing')).toBeInstanceOf(
            HTMLElement,
        );
        await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
        expect(document.querySelector('.local-engine-args-popover')).toBeNull();
    });

    it('should add recommended sd.cpp image arguments for large GPU generations', () => {
        const { renderer } = createRendererHarness({
            settings: {
                sdcpp_width: 896,
                sdcpp_height: 1152,
            },
        });
        const control = createEngineExtraArgsField((key, fallback) => `t:${key}:${fallback}`);
        document.body.appendChild(control.root);
        renderer._extraArgsControls.set('sdcpp', control);

        const anchor = document.createElement('button');
        document.body.appendChild(anchor);

        renderer._toggleEngineInfoPopover(anchor, 'sdcpp', {
            engine_id: 'sdcpp',
            compute_mode: 'gpu',
            context_size: 4096,
            model_path: null,
            extra_args: [],
        });

        const popover = document.querySelector('.local-engine-args-popover') as HTMLElement;
        (popover.querySelector('.local-engine-args-recommended') as HTMLButtonElement).click();

        expect(control.getGroups()).toEqual(['--diffusion-fa', '--fa', '--mmap', '--vae-tiling']);
    });

    it('should create text fields and parse values correctly', () => {
        const { runtime } = createRendererHarness();
        const inputFactory = new ModuleSettingsEngineInputFactory({
            requestAnimationFrame: runtime.requestAnimationFrame,
        });

        const textArea = inputFactory.createTextAreaField({ placeholder: 'Prompt' });
        const textInput = inputFactory.createTextInputField({
            type: 'number',
            placeholder: '4096',
            min: 1,
            max: 10,
        });

        expect(textArea.placeholder).toBe('Prompt');
        expect(textInput.inputMode).toBe('numeric');
        expect(textInput.min).toBe('1');
        expect(textInput.max).toBe('10');

        expect(() => {
            textArea.value = 'A prompt';
        }).not.toThrow();
        expect(runtime.requestAnimationFrame).toHaveBeenCalled();

        expect(parseEngineFieldValue('99', { type: 'number', min: 1, max: 10 })).toEqual({
            value: 10,
            displayValue: '10',
        });
        expect(parseEngineFieldValue('oops', { type: 'number', defaultValue: 7 })).toEqual({
            value: 7,
            displayValue: '7',
        });
        expect(parseEngineFieldValue('', { type: 'select', defaultValue: 'auto' })).toEqual({
            value: 'auto',
            displayValue: 'auto',
        });
        expect(formatEngineFieldSaveValue('extra_args', '--ctx 4096 --threads 8')).toEqual([
            '--ctx',
            '4096',
            '--threads',
            '8',
        ]);
    });

    it('should hydrate initial values from config aliases and defaults', () => {
        const settings = {
            sdcpp_positive_prompt: 'current positive',
        };
        const input = document.createElement('input');
        const textarea = document.createElement('textarea');

        setupInitialEngineFieldValue(input, {
            key: 'extra_args',
            isEngineConfig: true,
            config: { extra_args: ['--flash-attn', '--threads', '8'] },
            settings,
        });
        expect(input.value).toBe('--flash-attn --threads 8');
        expect(input.title).toBe('--flash-attn --threads 8');

        setupInitialEngineFieldValue(textarea, {
            key: 'sdcpp_positive_prompt',
            isEngineConfig: false,
            config: null,
            settings,
        });
        expect(textarea.value).toBe('current positive');

        setupInitialEngineFieldValue(input, {
            key: 'missing',
            isEngineConfig: false,
            defaultValue: 512,
            config: null,
            settings,
        });
        expect(input.value).toBe('512');
    });

    it('should save engine field values', () => {
        const setConfig = vi.fn();
        const showSaveIndicator = vi.fn();
        const fieldController = new ModuleSettingsEngineFieldController({
            getSettings: () => ({}),
            setConfig,
            debouncedSave: vi.fn(),
            showSaveIndicator,
            translate: (_key, fallback) => fallback,
            getModelFileName: (modelPath) => modelPath,
            getModelFileFilters: getEngineModelFileFilters,
            tracer: {
                error: vi.fn(),
            },
        });

        const engineInput = document.createElement('input');
        engineInput.value = '--ctx 4096';
        const config = { extra_args: [] as string[] };
        fieldController.handleSave(engineInput, {
            key: 'extra_args',
            type: 'text',
            isEngineConfig: true,
            config: config as never,
        });

        expect(config.extra_args).toEqual(['--ctx', '4096']);
        expect(setConfig).toHaveBeenCalledWith(config);
        expect(showSaveIndicator).toHaveBeenCalled();
    });

    it('should localize info button and browse button labels', () => {
        const { renderer } = createRendererHarness();
        const container = document.createElement('div');

        renderer._fieldRowRenderer.render(container, {
            label: 'Args',
            key: 'extra_args',
            type: 'text',
            isEngineConfig: false,
            appId: 'llamacpp',
            config: null,
            showInfoButton: true,
        });

        const infoBtn = container.querySelector('.local-engine-info-btn');
        expect(infoBtn).toBeInstanceOf(HTMLButtonElement);
        expect((infoBtn as HTMLButtonElement).title).toBe(
            't:ui.settings.engine.extra_args.info:Extra arguments info',
        );
        expect((infoBtn as HTMLButtonElement).getAttribute('aria-label')).toBe(
            't:ui.settings.engine.extra_args.info:Extra arguments info',
        );

        const { fieldController } = createFieldControllerHarness();
        const browseContainer = document.createElement('div');
        const input = document.createElement('input');
        fieldController.addFileBrowseButton(browseContainer, input, false, 'model');

        const browseBtn = browseContainer.querySelector('.local-engine-browse-btn');
        expect(browseBtn).toBeInstanceOf(HTMLButtonElement);
        expect((browseBtn as HTMLButtonElement).textContent).toBe(
            't:ui.settings.engine.browse:Browse',
        );
    });

    it('should localize performance mode title and state', () => {
        const debouncedSave = vi.fn();
        const container = document.createElement('div');

        renderEnginePerformanceModeField(
            container,
            'sdcpp',
            {},
            (key, fallback) => `t:${key}:${fallback}`,
            debouncedSave,
        );

        const label = container.querySelector('.local-engine-field-label');
        const status = container.querySelector('.local-engine-perf-status');
        const checkbox = container.querySelector(
            'input[type="checkbox"]',
        ) as HTMLInputElement | null;

        expect(label?.textContent).toBe('t:ui.settings.engine.performance_mode:Performance Mode');
        expect(status?.textContent).toBe('t:ui.common.disabled:Disabled');

        checkbox?.click();
        expect(status?.textContent).toBe('t:ui.common.enabled:Enabled');
        expect(debouncedSave).toHaveBeenCalledWith('sdcpp_performance_mode', true);
    });

    it('should allow both gguf and safetensors for image engines', async () => {
        vi.mocked(open).mockResolvedValue('C:\\Models\\sd.gguf');
        const { fieldController } = createFieldControllerHarness();
        const container = document.createElement('div');
        const input = document.createElement('input');

        fieldController.addFileBrowseButton(container, input, true, 'model');
        const button = container.querySelector('button');
        expect(button).toBeInstanceOf(HTMLButtonElement);

        (button as HTMLButtonElement).click();
        await vi.waitFor(() => {
            expect(open).toHaveBeenCalled();
        });

        expect(open).toHaveBeenCalledWith(
            expect.objectContaining({
                filters: [
                    { name: 'SD Models', extensions: ['gguf', 'safetensors'] },
                    { name: 'GGUF Models', extensions: ['gguf'] },
                    { name: 'SafeTensors', extensions: ['safetensors'] },
                ],
            }),
        );
        expect(input.dataset['fullPath']).toBe('C:\\Models\\sd.gguf');
        expect(input.value).toBe('sd.gguf');
    });
});
