import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleSettingsUI } from './ModuleSettingsUI';
import type { SettingsService } from '../services/SettingsService';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';

type ModuleSettingsUIPrivate = {
    _context: {
        t: (key: string, defaultValue?: string) => string;
        showToast: ReturnType<typeof vi.fn>;
        i18nUI: { applyTranslations: ReturnType<typeof vi.fn> };
    };
    _escapeHtml: (value: string) => string;
    _getModelFileName: (path: string) => string;
    _getEngineConfigHtml: (
        app: Record<string, unknown>,
        config: Record<string, unknown> | null,
    ) => string;
    _bindEvents: () => void;
    _appendExtraArgs: (appId: string, groups: string[]) => number;
    _toggleEngineInfoPopover: (anchor: HTMLButtonElement, appId: string) => void;
    _closeEngineInfoPopover: () => void;
    _createTextAreaField: (options: { placeholder?: string }) => HTMLTextAreaElement;
    _createTextInputField: (options: {
        type: string;
        placeholder?: string;
        min?: number;
        max?: number;
    }) => HTMLInputElement;
    _setupEngineFieldInitialValue: (
        input: HTMLInputElement | HTMLTextAreaElement,
        options: {
            key: string;
            isEngineConfig: boolean;
            defaultValue?: number | string;
            config: Record<string, unknown> | null;
        },
    ) => void;
    _parseEngineFieldValue: (
        raw: string,
        options: { type: string; min?: number; max?: number; defaultValue?: number | string },
    ) => { value: string | number | null; displayValue: string };
    _formatEngineFieldSaveValue: (key: string, value: string | number | null) => unknown;
    _handleEngineFieldSave: (
        input: HTMLInputElement | HTMLTextAreaElement,
        options: {
            key: string;
            type: string;
            isEngineConfig: boolean;
            isFile?: boolean;
            config: Record<string, unknown> | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
            appId: string;
        },
    ) => void;
    _loadCardWidths: () => void;
    _updateCardLayout: (card: HTMLElement, width: string) => void;
    _showSaveIndicator: () => void;
    _hideSaveIndicator: () => void;
    _debouncedSave: (key: string, value: string | number | boolean | null) => void;
    _createCustomSelectField: (options: { options?: string[] }) => {
        root: HTMLDivElement;
        destroy: () => void;
    };
    _createExtraArgsField: (_options: { placeholder?: string; defaultValue?: number | string }) => {
        root: HTMLDivElement;
        input: HTMLInputElement;
        syncTokens: () => void;
        getGroups: () => string[];
        setGroups: (groups: string[]) => void;
    };
    _addFileBrowseButton: (
        container: HTMLElement,
        input: HTMLInputElement,
        isImage: boolean,
    ) => void;
    _renderEngineFieldRow: (container: HTMLElement, options: Record<string, unknown>) => void;
    _renderPerformanceModeFieldRow: (container: HTMLElement, appId: string) => void;
    _resetDynamicModuleState: () => void;
    destroy: () => void;
};

describe('ModuleSettingsUI lifecycle', () => {
    let settingsUI: ModuleSettingsUI | null = null;

    beforeEach(() => {
        document.body.innerHTML = '<dialog id="module-settings-modal"></dialog>';
        vi.clearAllMocks();
    });

    afterEach(() => {
        settingsUI?.destroy();
        settingsUI = null;
        document.body.innerHTML = '';
    });

    function createSettingsUI(): ModuleSettingsUIPrivate {
        const service = {
            getSettings: vi.fn().mockReturnValue({}),
            saveSetting: vi.fn().mockResolvedValue(true),
        } as unknown as SettingsService;
        const uiSettings = {
            setCardWidth: vi.fn(),
            getCardWidth: vi.fn().mockReturnValue(undefined),
            getCardWidths: vi.fn().mockReturnValue({}),
        } as unknown as UISettingsService;
        const aiSettings = {
            getThinkingLevel: vi
                .fn()
                .mockImplementation((appId: string) => (appId === 'llamacpp' ? 'low' : 'high')),
            setThinkingLevel: vi.fn(),
        } as unknown as AISettingsService;
        const i18nUI = {
            applyTranslations: vi.fn(),
        } as unknown as I18nUI;
        const tauri = {
            isTauri: vi.fn().mockReturnValue(false),
        } as unknown as TauriProvider;
        const navigation = {
            removeBackAction: vi.fn(),
        } as unknown as NavigationService;

        settingsUI = new ModuleSettingsUI(
            service,
            uiSettings,
            aiSettings,
            i18nUI,
            tauri,
            navigation,
        );

        const privateUI = settingsUI as unknown as ModuleSettingsUIPrivate;
        (
            privateUI as unknown as {
                _engineConfigService: { setConfig: ReturnType<typeof vi.fn> };
            }
        )._engineConfigService = {
            setConfig: vi.fn().mockResolvedValue(undefined),
        };
        privateUI._context = {
            t: (key: string, defaultValue?: string) => `t:${key}:${defaultValue ?? ''}`,
            showToast: vi.fn(),
            i18nUI: {
                applyTranslations: vi.fn(),
            },
        };

        return privateUI;
    }

    it('should escape HTML, resolve model file names and build engine config html', () => {
        const ui = createSettingsUI();

        expect(ui._escapeHtml(`<tag attr="x">'&`)).toBe('&lt;tag attr=&quot;x&quot;&gt;&#39;&amp;');
        expect(ui._getModelFileName('C:\\models\\llama.gguf')).toBe('llama.gguf');
        expect(ui._getModelFileName('')).toBe(
            't:ui.settings.engine.model_not_selected:Model not selected',
        );

        const imageHtml = ui._getEngineConfigHtml({ id: 'sdcpp', capability: 'image' }, null);
        const textHtml = ui._getEngineConfigHtml({ id: 'llamacpp', capability: 'text' }, {});

        expect(imageHtml).toContain('t:ui.settings.engine.generation_presets:Generation Presets');
        expect(imageHtml).toContain(
            't:ui.settings.engine.config_unavailable:Engine config unavailable (Tauri not connected)',
        );
        expect(textHtml).toContain('t:ui.settings.engine.core_config:Core Config');
    });

    it('should close stale custom select overlays when another select opens', () => {
        const ui = createSettingsUI();
        const firstSelect = ui._createCustomSelectField({ options: ['one', 'two'] });
        const secondSelect = ui._createCustomSelectField({ options: ['alpha', 'beta'] });

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

    it('should cleanup select overlays registered during module render reset', () => {
        const ui = createSettingsUI();
        const container = document.createElement('div');

        ui._renderEngineFieldRow(container, {
            label: 'Sampler',
            key: 'sampler',
            type: 'select',
            isEngineConfig: false,
            options: ['Euler', 'DDIM'],
            appId: 'stable-diffusion',
            config: null,
        });

        expect(document.querySelectorAll('.local-engine-select-menu')).toHaveLength(1);

        ui._resetDynamicModuleState();

        expect(document.querySelectorAll('.local-engine-select-menu')).toHaveLength(0);
    });

    it('should localize extra args field labels and actions', () => {
        const ui = createSettingsUI();
        const control = ui._createExtraArgsField({});

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
        const ui = createSettingsUI();
        const control = ui._createExtraArgsField({});
        document.body.appendChild(control.root);
        (
            ui as unknown as {
                _extraArgsControls: Map<string, typeof control>;
            }
        )._extraArgsControls.set('llamacpp', control);

        expect(ui._appendExtraArgs('llamacpp', ['--flash-attn', '--flash-attn'])).toBe(1);

        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWrite },
        });

        ui._toggleEngineInfoPopover(anchor, 'llamacpp');
        const popover = document.querySelector('.local-engine-args-popover') as HTMLElement;
        expect(popover.textContent).toContain('Manual llama.cpp flags');

        (popover.querySelector('.local-engine-args-copy-all') as HTMLButtonElement).click();
        expect(ui._context.showToast).toHaveBeenCalled();

        // Click on the first flag item (no more separate Add button — entire card is clickable)
        const firstItem = popover.querySelector('.local-engine-args-item') as HTMLElement;
        expect(firstItem).toBeTruthy();
        firstItem.click();
        await Promise.resolve();
        expect(ui._context.showToast).toHaveBeenCalled();

        ui._toggleEngineInfoPopover(anchor, 'llamacpp');
        expect(document.querySelector('.local-engine-args-popover')).toBeNull();
    });

    it('should create text fields and parse values correctly', () => {
        const ui = createSettingsUI();

        const textArea = ui._createTextAreaField({ placeholder: 'Prompt' });
        const textInput = ui._createTextInputField({
            type: 'number',
            placeholder: '4096',
            min: 1,
            max: 10,
        });

        expect(textArea.placeholder).toBe('Prompt');
        expect(textInput.inputMode).toBe('numeric');
        expect(textInput.min).toBe('1');
        expect(textInput.max).toBe('10');

        expect(ui._parseEngineFieldValue('99', { type: 'number', min: 1, max: 10 })).toEqual({
            value: 10,
            displayValue: '10',
        });
        expect(ui._parseEngineFieldValue('oops', { type: 'number', defaultValue: 7 })).toEqual({
            value: 7,
            displayValue: '7',
        });
        expect(ui._parseEngineFieldValue('', { type: 'select', defaultValue: 'auto' })).toEqual({
            value: 'auto',
            displayValue: 'auto',
        });
        expect(ui._formatEngineFieldSaveValue('extra_args', '--ctx 4096 --threads 8')).toEqual([
            '--ctx',
            '4096',
            '--threads',
            '8',
        ]);
    });

    it('should hydrate initial values from config aliases and defaults', () => {
        const ui = createSettingsUI();
        const input = document.createElement('input');
        const textarea = document.createElement('textarea');
        (
            ui as unknown as {
                _service: { getSettings: ReturnType<typeof vi.fn> };
            }
        )._service.getSettings.mockReturnValue({
            sdcpp_positivePrompt: 'legacy positive',
        });

        ui._setupEngineFieldInitialValue(input, {
            key: 'extra_args',
            isEngineConfig: true,
            config: { extra_args: ['--flash-attn', '--threads', '8'] },
        });
        expect(input.value).toBe('--flash-attn --threads 8');
        expect(input.title).toBe('--flash-attn --threads 8');

        ui._setupEngineFieldInitialValue(textarea, {
            key: 'sdcpp_positive_prompt',
            isEngineConfig: false,
            config: null,
        });
        expect(textarea.value).toBe('legacy positive');

        ui._setupEngineFieldInitialValue(input, {
            key: 'missing',
            isEngineConfig: false,
            defaultValue: 512,
            config: null,
        });
        expect(input.value).toBe('512');
    });

    it('should save engine field values and manage autosave indicators', async () => {
        vi.useFakeTimers();
        const ui = createSettingsUI();
        document.body.innerHTML += '<div id="save-indicator"><span></span></div>';

        const engineInput = document.createElement('input');
        engineInput.value = '--ctx 4096';
        const config = { extra_args: [] as string[] };
        ui._handleEngineFieldSave(engineInput, {
            key: 'extra_args',
            type: 'text',
            isEngineConfig: true,
            config,
            appId: 'llamacpp',
        });

        expect(config.extra_args).toEqual(['--ctx', '4096']);
        expect(
            (
                ui as unknown as {
                    _engineConfigService: { setConfig: ReturnType<typeof vi.fn> };
                }
            )._engineConfigService.setConfig,
        ).toHaveBeenCalledWith(config);

        ui._debouncedSave('download_max_speed', 123);
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        expect(
            (
                ui as unknown as {
                    _service: { saveSetting: ReturnType<typeof vi.fn> };
                }
            )._service.saveSetting,
        ).toHaveBeenCalledWith('download_max_speed', '123');
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(false);
    });

    it('should show save errors and apply stored card widths', async () => {
        vi.useFakeTimers();
        const ui = createSettingsUI();
        document.body.innerHTML += `
            <div id="save-indicator"><span></span></div>
            <div style="grid-template-columns:1fr 1fr">
                <div class="resizable-card" data-card-id="gpu"></div>
            </div>
        `;
        (
            ui as unknown as {
                _service: { saveSetting: ReturnType<typeof vi.fn> };
                _uiSettings: { getCardWidths: ReturnType<typeof vi.fn> };
            }
        )._service.saveSetting.mockRejectedValueOnce(new Error('nope'));
        (
            ui as unknown as {
                _uiSettings: { getCardWidths: ReturnType<typeof vi.fn> };
            }
        )._uiSettings.getCardWidths.mockReturnValue({ gpu: 'full' });

        ui._loadCardWidths();
        const card = document.querySelector('.resizable-card') as HTMLElement;
        expect(card.dataset['cardWidth']).toBe('full');

        ui._updateCardLayout(card, 'half');
        expect((card.parentElement as HTMLElement).style.gridTemplateColumns).toBe('1fr 1fr');

        ui._showSaveIndicator();
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(true);
        ui._hideSaveIndicator();
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(false);

        ui._debouncedSave('theme', 'dark');
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        expect(document.querySelector('#save-indicator span')?.textContent).toBe(
            't:ui.settings.save_failed:Save failed',
        );
    });

    it('should localize info button and browse button labels', () => {
        const ui = createSettingsUI();
        const container = document.createElement('div');

        ui._renderEngineFieldRow(container, {
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

        const browseContainer = document.createElement('div');
        const input = document.createElement('input');
        ui._addFileBrowseButton(browseContainer, input, false);

        const browseBtn = browseContainer.querySelector('.local-engine-browse-btn');
        expect(browseBtn).toBeInstanceOf(HTMLButtonElement);
        expect((browseBtn as HTMLButtonElement).textContent).toBe(
            't:ui.settings.engine.browse:Browse',
        );
    });

    it('should localize performance mode title and state', () => {
        const ui = createSettingsUI();
        const container = document.createElement('div');

        ui._renderPerformanceModeFieldRow(container, 'sdcpp');

        const label = container.querySelector('.local-engine-field-label');
        const status = container.querySelector('.local-engine-perf-status');
        const checkbox = container.querySelector(
            'input[type="checkbox"]',
        ) as HTMLInputElement | null;

        expect(label?.textContent).toBe('t:ui.settings.engine.performance_mode:Performance Mode');
        expect(status?.textContent).toBe('t:ui.common.disabled:Disabled');

        checkbox?.click();
        expect(status?.textContent).toBe('t:ui.common.enabled:Enabled');
    });

    it('should remove dropdown document listener on destroy', () => {
        const ui = createSettingsUI();
        document.body.innerHTML +=
            '<button id="lang-dropdown-btn-home"></button><div id="lang-dropdown-menu-home" class="lang-dropdown-menu show"></div>';
        const dropdown = document.getElementById('lang-dropdown-menu-home') as HTMLDivElement;

        ui._bindEvents();

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(dropdown.classList.contains('show')).toBe(false);

        dropdown.classList.add('show');
        ui.destroy();

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(dropdown.classList.contains('show')).toBe(true);
    });
});
