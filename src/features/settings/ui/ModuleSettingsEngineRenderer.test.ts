import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';

import { ModuleSettingsEngineRenderer } from './ModuleSettingsEngineRenderer';
import { ModuleSettingsEngineFieldController } from './ModuleSettingsEngineFieldController';
import {
    createEngineExtraArgsField,
    getEngineExtraArgDocs,
    getEngineModelFileFilters,
    getEngineModelFileName,
    formatEngineFieldSaveValue,
    ModuleSettingsEngineInputFactory,
    parseEngineFieldValue,
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
    const showSaveErrorIndicator = vi.fn();
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
        showSaveErrorIndicator,
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
        showSaveErrorIndicator,
        setConfig,
        runtime,
    };
}

function createFieldControllerHarness() {
    const setConfig = vi.fn();
    const debouncedSave = vi.fn();
    const showSaveIndicator = vi.fn();
    const showSaveErrorIndicator = vi.fn();
    const error = vi.fn();
    const fieldController = new ModuleSettingsEngineFieldController({
        getSettings: () => ({}),
        setConfig,
        debouncedSave,
        showSaveIndicator,
        showSaveErrorIndicator,
        translate: (key, fallback) => `t:${key}:${fallback}`,
        getModelFileName: (modelPath) =>
            getEngineModelFileName(
                modelPath,
                't:ui.settings.engine.model_not_selected:Model not selected',
            ),
        getModelFileFilters: getEngineModelFileFilters,
        tracer: { error },
    });

    return {
        fieldController,
        setConfig,
        debouncedSave,
        showSaveIndicator,
        showSaveErrorIndicator,
        error,
    };
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

        expect(imageHtml).toContain('t:ui.settings.engine.generation_settings:Generation Settings');
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

    it('should localize extra args field labels and actions', () => {
        const control = createEngineExtraArgsField((key, fallback) => `t:${key}:${fallback}`);

        const input = control.root.querySelector('.local-engine-extra-args-input');
        const draft = control.root.querySelector('.local-engine-extra-args-draft');
        expect(input).toBeInstanceOf(HTMLInputElement);
        expect(draft).toBeInstanceOf(HTMLInputElement);
        expect((draft as HTMLInputElement).placeholder).toBe(
            't:ui.settings.engine.extra_args.placeholder:Add startup flags',
        );

        control.setGroups(['--ctx-size 4096']);

        expect((input as HTMLInputElement).value).toBe('--ctx-size 4096');
        expect(control.root.querySelector('.local-engine-extra-arg-chip')?.textContent).toContain(
            '--ctx-size 4096',
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

        (popover.querySelector('.local-engine-args-recommended') as HTMLButtonElement).click();
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

        expect(control.getGroups()).toEqual(['--diffusion-fa', '--mmap', '--vae-tiling']);
    });

    it('should expose official stable-diffusion.cpp startup flag names', () => {
        const docs = getEngineExtraArgDocs('sdcpp');
        const flags = docs.items.map((item) => item.flag);

        expect(flags).toContain('--clip_l path');
        expect(flags).toContain('--clip_g path');
        expect(flags).toContain('--clip_vision path');
        expect(flags).toContain('--init-img path');
        expect(flags).toContain('--pm-style-strength 20');
        expect(flags).toContain('--vae-tile-size 32x32');
        expect(flags).toContain('--vae-tile-overlap 0.5');
        expect(flags).toContain('--vae-relative-tile-size 0.5x0.5');
        expect(flags).toContain('--timestep-shift 250');
        expect(flags).not.toContain('--clip-l path');
        expect(flags).not.toContain('--init-image path');
        expect(flags).not.toContain('--style-ratio 20');
        expect(flags).not.toContain('--schedule-shift 3');
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
        expect(
            formatEngineFieldSaveValue(
                'extra_args',
                String.raw`--clip_l "C:\My Models\clip.safetensors" --vae C:\vae.sft`,
            ),
        ).toEqual([
            '--clip_l',
            String.raw`C:\My Models\clip.safetensors`,
            '--vae',
            String.raw`C:\vae.sft`,
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

    it('should save engine field values', async () => {
        const setConfig = vi.fn();
        const showSaveIndicator = vi.fn();
        const showSaveErrorIndicator = vi.fn();
        const fieldController = new ModuleSettingsEngineFieldController({
            getSettings: () => ({}),
            setConfig,
            debouncedSave: vi.fn(),
            showSaveIndicator,
            showSaveErrorIndicator,
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
        await fieldController.handleSave(engineInput, {
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
